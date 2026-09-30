import type { Command } from 'commander';
import { startMcpServer } from '@tememory/mcp-server';
import { globalsOf } from '../common.js';

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('以 stdio 方式启动 MCP server 供各 harness 接入（stdout 为协议通道，不产生额外输出）')
    .action(async (_opts: Record<string, never>, cmd: Command) => {
      const g = globalsOf(cmd);
      // 注意：此命令的 stdout 是 MCP 协议通道，任何日志只能走 stderr
      await startMcpServer(g.home !== undefined ? { home: g.home } : {});
    });
}
