import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { adapters, runSync } from '@folio/core';
import type { SyncEvent, SyncReport } from '@folio/core';
import { errMsg, globalsOf, printJson, renderTable } from '../common.js';

interface SyncCmdOpts {
  adapter: string[];
  projectDir: string[];
  classify?: boolean;
}

function collectValues(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function validateAdapterIds(ids: string[]): void {
  const known = adapters.map((a) => a.id);
  const unknown = ids.filter((id) => !known.includes(id));
  if (unknown.length > 0) {
    throw new Error(`未知适配器：${unknown.join(', ')}（可选：${known.join(', ')}）`);
  }
}

function printProgress(event: SyncEvent): void {
  switch (event.kind) {
    case 'adapter-start':
      console.log(`▸ ${event.adapterId}`);
      break;
    case 'item-added':
      console.log(`  + 新增 ${event.detail ?? ''}`);
      break;
    case 'item-updated':
      console.log(`  ~ 更新 ${event.detail ?? ''}`);
      break;
    case 'item-removed':
      console.log(`  - 源已消失 ${event.detail ?? ''}`);
      break;
    case 'adapter-done':
      console.log(`  完成：${event.detail ?? ''}`);
      break;
    case 'adapter-error':
      console.log(`  失败：${event.detail ?? ''}`);
      break;
    case 'item-skipped':
      // 跳过项可能很多，只在最终汇总里体现
      break;
  }
}

function printSummary(report: SyncReport): void {
  console.log('');
  console.log('同步汇总：');
  console.log(
    renderTable(
      ['适配器', '检测', '新增', '更新', '跳过', '移除', '错误'],
      report.adapters.map((a) => [
        a.id,
        a.detected ? '✓' : '—',
        String(a.added),
        String(a.updated),
        String(a.skipped),
        String(a.removed),
        String(a.errors.length),
      ]),
    ),
  );
  for (const err of report.errors) console.log(`错误：${err}`);
  for (const adapter of report.adapters) {
    for (const err of adapter.errors) console.log(`错误（${adapter.id}）：${err}`);
  }
}

export function registerSync(program: Command): void {
  program
    .command('sync')
    .description('从各 AI harness 收集记忆并同步到本地记忆库')
    .option('--adapter <id>', '只同步指定适配器（可多次指定）', collectValues, [])
    .option('--project-dir <dir>', '额外扫描的项目目录（可多次指定）', collectValues, [])
    .option('--classify', '同步时调用 LLM 为新记忆自动分类（需先配置 API Key）')
    .action(async (opts: SyncCmdOpts, cmd: Command) => {
      const g = globalsOf(cmd);
      validateAdapterIds(opts.adapter);
      const projectDirs = [...new Set([process.cwd(), ...opts.projectDir])];
      const report = await runSync({
        home: g.home,
        projectDirs,
        ...(opts.adapter.length > 0 ? { adapterIds: opts.adapter } : {}),
        classify: opts.classify === true,
        onEvent: g.json ? undefined : printProgress,
      });
      if (g.json) {
        printJson(report);
        return;
      }
      printSummary(report);
    });
}

// 与各 adapter 内部的 home 解析规则保持一致（env 覆盖优先，其次 ~/.<dir>）
const HARNESS_HOME_RESOLVERS: Record<string, () => string> = {
  'claude-code': () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
  codex: () => process.env.CODEX_HOME ?? join(homedir(), '.codex'),
  cursor: () => process.env.FOLIO_CURSOR_HOME ?? join(homedir(), '.cursor'),
  'kimi-code': () => process.env.KIMI_CODE_HOME ?? join(homedir(), '.kimi-code'),
  zcode: () => process.env.FOLIO_ZCODE_HOME ?? join(homedir(), '.zcode'),
};

function timeNow(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function sumBy(report: SyncReport, pick: (a: SyncReport['adapters'][number]) => number): number {
  return report.adapters.reduce((n, a) => n + pick(a), 0);
}

export function registerWatch(program: Command): void {
  program
    .command('watch')
    .description('监听各 harness 的记忆源目录，变化去抖后自动增量同步（前台运行，Ctrl-C 停止）')
    .option('--debounce <ms>', '变化去抖间隔（毫秒），默认 2000', '2000')
    .action(async (opts: { debounce: string }, cmd: Command) => {
      const g = globalsOf(cmd);
      const debounce = Number(opts.debounce);
      if (!Number.isInteger(debounce) || debounce < 0) {
        throw new Error(`--debounce 必须是非负整数毫秒数，收到：${opts.debounce}`);
      }

      const watched: Array<{ id: string; dir: string }> = [];
      for (const adapter of adapters) {
        if (!(await adapter.detect())) continue;
        const resolveHome = HARNESS_HOME_RESOLVERS[adapter.id];
        if (resolveHome) watched.push({ id: adapter.id, dir: resolveHome() });
      }
      if (watched.length === 0) {
        throw new Error('未检测到任何 harness 的记忆源目录，无可监听内容');
      }

      let syncing = false;
      let pending = false;
      let timer: NodeJS.Timeout | null = null;

      const runOnce = async (): Promise<void> => {
        if (syncing) {
          pending = true;
          return;
        }
        syncing = true;
        try {
          const report = await runSync({ home: g.home, projectDirs: [process.cwd()] });
          if (g.json) {
            process.stdout.write(`${JSON.stringify(report)}\n`);
          } else {
            const errors = report.errors.length + sumBy(report, (a) => a.errors.length);
            console.log(
              `[${timeNow()}] 同步完成：新增 ${sumBy(report, (a) => a.added)} · 更新 ${sumBy(report, (a) => a.updated)} · 跳过 ${sumBy(report, (a) => a.skipped)} · 移除 ${sumBy(report, (a) => a.removed)} · 错误 ${errors}`,
            );
          }
        } catch (err) {
          console.error(`同步失败：${errMsg(err)}`);
        } finally {
          syncing = false;
          if (pending) {
            pending = false;
            schedule();
          }
        }
      };

      const schedule = (): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void runOnce();
        }, debounce);
      };

      const { watch } = await import('chokidar');
      const watcher = watch(
        watched.map((w) => w.dir),
        { ignoreInitial: true },
      );
      watcher.on('all', (event, file) => {
        if (!g.json) console.log(`… 检测到 ${event}：${file}`);
        schedule();
      });
      watcher.on('error', (err) => {
        console.error(`监听错误：${errMsg(err)}`);
      });

      await runOnce();
      if (!g.json) {
        console.log('正在监听以下目录：');
        for (const w of watched) console.log(`  • ${w.id}：${w.dir}`);
        console.log('按 Ctrl-C 停止监听。');
      }

      await new Promise<void>((resolve) => {
        const onSigint = (): void => {
          if (timer) clearTimeout(timer);
          void watcher.close().then(() => {
            process.off('SIGINT', onSigint);
            if (!g.json) console.log('已停止监听。');
            resolve();
          });
        };
        process.on('SIGINT', onSigint);
      });
    });
}
