import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import { errMsg } from './common.js';
import {
  registerConflicts,
  registerInit,
  registerList,
  registerSearch,
  registerShow,
  registerStats,
} from './commands/basic.js';
import { registerDoctor } from './commands/doctor.js';
import { registerInstall, registerUninstall } from './commands/install.js';
import { registerOrganize } from './commands/organize.js';
import { registerServe } from './commands/serve.js';
import { registerSync, registerWatch } from './commands/sync.js';

function readCliVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, '..', 'package.json'), join(here, 'package.json')]) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: unknown };
      if (typeof pkg.version === 'string') return pkg.version;
    } catch {
      // 尝试下一个候选位置
    }
  }
  return '0.0.0';
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('tememory')
    .description('tememory：跨 AI harness 的个人记忆库（同步 / 检索 / 整理 / MCP 接入）')
    .version(readCliVersion(), '-V, --version', '显示版本号')
    .option('--home <dir>', 'tememory 主目录（优先级高于 TEMEMORY_HOME，默认 ~/.tememory）')
    .option('--json', '以 JSON 格式输出结果（机器可读）')
    .showHelpAfterError('（运行 tememory <命令> --help 查看该命令用法）')
    // 必须在注册子命令之前调用：_exitCallback 只在 .command() 创建子命令时继承
    .exitOverride();

  registerInit(program);
  registerSync(program);
  registerWatch(program);
  registerList(program);
  registerSearch(program);
  registerShow(program);
  registerOrganize(program);
  registerConflicts(program);
  registerServe(program);
  registerInstall(program);
  registerUninstall(program);
  registerDoctor(program);
  registerStats(program);
  return program;
}

async function main(): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      // commander 已打印帮助或用法错误；此处只统一映射退出码：用法错误为 2
      process.exitCode = err.exitCode === 0 ? 0 : 2;
      return;
    }
    console.error(`错误：${errMsg(err)}`);
    process.exitCode = 1;
  }
}

void main();
