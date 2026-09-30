import type { Command } from 'commander';
import {
  buildServerEntry,
  getAdapter,
  installMcpServer,
  SERVER_NAME,
  uninstallMcpServer,
} from '@tememory/core';
import type { InstallTarget } from '@tememory/core';
import { globalsOf, printJson } from '../common.js';

function collectValues(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/** 人类可读输出需要展示名；core 结果只带 adapterId */
function nameOf(adapterId: string): string {
  return getAdapter(adapterId)?.name ?? adapterId;
}

export function registerInstall(program: Command): void {
  program
    .command('install')
    .description('把 tememory MCP server 注册进各 harness 的配置文件（写前自动备份原配置）')
    .option('--adapter <id>', '只操作指定适配器（可多次指定）', collectValues, [])
    .option('--all', '面向全部支持 MCP 的适配器，包括当前未检测到安装的')
    .option(
      '--command <cmd>',
      '注册用的启动命令，默认 tememory；可含空格，如 "node /abs/path/cli.js"',
    )
    .action(async (opts: { adapter: string[]; all?: boolean; command?: string }, cmd: Command) => {
      const g = globalsOf(cmd);
      const targets = await installMcpServer({
        adapterIds: opts.adapter,
        all: opts.all === true,
        command: opts.command,
      });
      const results = targets.map((t: InstallTarget) => ({
        adapter: t.adapterId,
        configPath: t.configPath,
        backup: t.backupPath ?? null,
        overwritten: t.alreadyExisted === true,
      }));
      if (g.json) {
        printJson(results);
        return;
      }
      for (const t of targets) {
        console.log(
          `${nameOf(t.adapterId)}：已写入 ${t.configPath}${t.alreadyExisted ? '（覆盖了已存在的同名 server）' : ''}`,
        );
        if (t.backupPath !== undefined) console.log(`  原配置已备份：${t.backupPath}`);
      }
      const entry = buildServerEntry(opts.command);
      console.log(
        `完成：注册的 server 条目为 { command: ${JSON.stringify(entry.command)}, args: ${JSON.stringify(entry.args)} }`,
      );
    });
}

export function registerUninstall(program: Command): void {
  program
    .command('uninstall')
    .description('从各 harness 配置中移除 tememory MCP server（写前自动备份原配置）')
    .option('--adapter <id>', '只操作指定适配器（可多次指定）', collectValues, [])
    .option('--all', '面向全部支持 MCP 的适配器，包括当前未检测到安装的')
    .action(async (opts: { adapter: string[]; all?: boolean }, cmd: Command) => {
      const g = globalsOf(cmd);
      const targets = await uninstallMcpServer({
        adapterIds: opts.adapter,
        all: opts.all === true,
      });
      const results = targets.map((t: InstallTarget) => ({
        adapter: t.adapterId,
        configPath: t.configPath,
        removed: t.changed,
        backup: t.backupPath ?? null,
        ...(t.reason !== undefined ? { reason: t.reason } : {}),
      }));
      if (g.json) {
        printJson(results);
        return;
      }
      for (const t of targets) {
        if (t.reason === 'config-missing') {
          console.log(`${nameOf(t.adapterId)}：配置文件不存在（${t.configPath}），跳过`);
          continue;
        }
        if (t.reason === 'not-registered') {
          console.log(`${nameOf(t.adapterId)}：${t.configPath} 中未注册 ${SERVER_NAME}，跳过`);
          continue;
        }
        console.log(`${nameOf(t.adapterId)}：已从 ${t.configPath} 移除 ${SERVER_NAME}`);
        console.log(`  原配置已备份：${t.backupPath as string}`);
      }
    });
}
