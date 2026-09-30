import type { Command } from 'commander';
import { applyOrganize, createLlmClient, loadConfig, planOrganize } from '@folio/core';
import type { OrganizeOp, OrganizePlan } from '@folio/core';
import { globalsOf, openStore, parseCount, printJson } from '../common.js';

interface OrganizeCmdOpts {
  apply?: boolean;
  batchSize?: string;
}

function describeOp(op: OrganizeOp): string {
  switch (op.kind) {
    case 'merge':
      return `合并：保留 ${op.keepId}，吸收 ${op.absorbIds.join('、')} —— ${op.reason}`;
    case 'retype':
      return `改类型：${op.id} → ${op.type} —— ${op.reason}`;
    case 'retag':
      return `改标签：${op.id} → [${op.tags.join(', ')}] —— ${op.reason}`;
    case 'conflict':
      return `冲突：${op.ids.join('、')} —— ${op.reason}（仅标记，不合并）`;
  }
}

function printPlan(plan: OrganizePlan): void {
  console.log(plan.llmUsed ? '整理计划（由 LLM 生成）：' : '整理计划（由本地查重规则生成）：');
  if (plan.ops.length === 0) {
    console.log('  没有需要整理的内容。');
  } else {
    plan.ops.forEach((op, i) => {
      console.log(`  ${i + 1}. ${describeOp(op)}`);
    });
  }
  for (const note of plan.notes) console.log(`  备注：${note}`);
}

export function registerOrganize(program: Command): void {
  program
    .command('organize')
    .description('整理记忆库：合并重复、修正类型/标签、标记冲突（默认 dry-run，只打印计划不改动）')
    .option('--apply', '真正执行整理计划（默认仅预览）')
    .option('--batch-size <n>', 'LLM 分批整理时每批的记忆条数，默认 60')
    .action(async (opts: OrganizeCmdOpts, cmd: Command) => {
      const g = globalsOf(cmd);
      const { paths, store } = openStore(g.home);
      const config = loadConfig(paths);
      const llm = createLlmClient(config);
      if (!llm && !g.json) {
        console.log('提示：LLM 不可用（未配置 API Key 或已在配置中禁用），本次仅使用本地查重规则。');
      }
      const batchSize =
        opts.batchSize !== undefined ? parseCount(opts.batchSize, '--batch-size') : undefined;
      const plan = await planOrganize(store, llm, batchSize !== undefined ? { batchSize } : undefined);

      if (opts.apply !== true) {
        if (g.json) {
          printJson(plan);
          return;
        }
        printPlan(plan);
        if (plan.ops.length > 0) {
          console.log('（dry-run：未做任何修改；确认无误后加 --apply 执行）');
        }
        return;
      }

      const report = await applyOrganize(store, plan);
      if (g.json) {
        printJson({ plan, report });
        return;
      }
      printPlan(plan);
      console.log(
        `执行完成：合并 ${report.merged} 条，改类型 ${report.retyped} 条，改标签 ${report.retagged} 条，标记冲突 ${report.conflictsMarked} 组。`,
      );
      for (const err of report.errors) console.log(`错误：${err}`);
      if (report.merged > 0) {
        console.log('被合并的记忆已移入归档目录，可用 folio list --archived 查看。');
      }
    });
}
