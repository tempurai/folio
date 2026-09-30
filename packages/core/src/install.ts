import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { adapters } from './adapters/index.js';
import type { HarnessAdapter, McpIntegration } from './adapters/types.js';

/** 注册进各 harness 配置文件的 MCP server 名 */
export const SERVER_NAME = 'folio';

export interface InstallTarget {
  adapterId: string;
  configPath: string;
  /** install：是否写入了配置（恒为 true）；uninstall：是否真正移除了条目 */
  changed: boolean;
  /** 写前备份路径（原配置不存在时为 undefined） */
  backupPath?: string;
  /** install：写入前已存在同名 server（本次为覆盖） */
  alreadyExisted?: boolean;
  /** uninstall：未做移除的原因 */
  reason?: 'config-missing' | 'not-registered';
}

export interface InstallOptions {
  /** 只操作指定适配器；缺省或空数组表示不过滤 */
  adapterIds?: string[];
  /** 面向全部支持 MCP 的适配器，包括当前未检测到安装的 */
  all?: boolean;
  /** 注册用的启动命令，默认 folio；可含空格，如 "node /abs/path/cli.js" */
  command?: string;
}

export interface UninstallOptions {
  adapterIds?: string[];
  all?: boolean;
}

interface Target {
  adapter: HarnessAdapter;
  mcp: McpIntegration;
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** `command` 含空格时拆分：首词为 command，其余追加到 args 末尾再补 serve */
export function buildServerEntry(commandOpt?: string): { command: string; args: string[] } {
  const raw = commandOpt !== undefined && commandOpt.trim() !== '' ? commandOpt.trim() : 'folio';
  const [command, ...rest] = raw.split(/\s+/);
  return { command, args: [...rest, 'serve'] };
}

async function selectTargets(ids: string[], all: boolean): Promise<Target[]> {
  const known = adapters.map((a) => a.id);
  const unknown = ids.filter((id) => !known.includes(id));
  if (unknown.length > 0) {
    throw new Error(`未知适配器：${unknown.join(', ')}（可选：${known.join(', ')}）`);
  }
  let pool = adapters.filter((a) => a.mcp !== undefined);
  if (!all) {
    const detected: HarnessAdapter[] = [];
    for (const adapter of pool) {
      if (await adapter.detect()) detected.push(adapter);
    }
    pool = detected;
  }
  if (ids.length > 0) {
    const allowed = new Set(ids);
    pool = pool.filter((a) => allowed.has(a.id));
  }
  return pool.map((adapter) => ({ adapter, mcp: adapter.mcp as McpIntegration }));
}

export function readMcpConfig(mcp: McpIntegration, file: string): unknown {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8');
  if (mcp.format === 'json') return text.trim() === '' ? {} : JSON.parse(text);
  return parseToml(text);
}

function writeMcpConfig(mcp: McpIntegration, file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  if (mcp.format === 'json') {
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } else {
    writeFileSync(file, stringifyToml(data as Parameters<typeof stringifyToml>[0]), 'utf8');
  }
}

function backup(file: string): string {
  const backupPath = `${file}.bak-${timestamp()}`;
  copyFileSync(file, backupPath);
  return backupPath;
}

export async function installMcpServer(opts: InstallOptions = {}): Promise<InstallTarget[]> {
  const targets = await selectTargets(opts.adapterIds ?? [], opts.all === true);
  if (targets.length === 0) {
    throw new Error('没有可安装的适配器（未检测到安装）；可用 --all 强制面向全部适配器');
  }
  const entry = buildServerEntry(opts.command);
  const results: InstallTarget[] = [];
  for (const { adapter, mcp } of targets) {
    const file = mcp.configPath();
    const backupPath = existsSync(file) ? backup(file) : undefined;
    const parsed = readMcpConfig(mcp, file);
    const alreadyExisted = Object.prototype.hasOwnProperty.call(
      mcp.getServers(parsed),
      SERVER_NAME,
    );
    writeMcpConfig(mcp, file, mcp.withServer(parsed, SERVER_NAME, entry));
    results.push({
      adapterId: adapter.id,
      configPath: file,
      changed: true,
      alreadyExisted,
      ...(backupPath !== undefined ? { backupPath } : {}),
    });
  }
  return results;
}

export async function uninstallMcpServer(opts: UninstallOptions = {}): Promise<InstallTarget[]> {
  const targets = await selectTargets(opts.adapterIds ?? [], opts.all === true);
  if (targets.length === 0) {
    throw new Error('没有可操作的适配器（未检测到安装）；可用 --all 强制面向全部适配器');
  }
  const results: InstallTarget[] = [];
  for (const { adapter, mcp } of targets) {
    const file = mcp.configPath();
    if (!existsSync(file)) {
      results.push({ adapterId: adapter.id, configPath: file, changed: false, reason: 'config-missing' });
      continue;
    }
    const parsed = readMcpConfig(mcp, file);
    if (!Object.prototype.hasOwnProperty.call(mcp.getServers(parsed), SERVER_NAME)) {
      results.push({ adapterId: adapter.id, configPath: file, changed: false, reason: 'not-registered' });
      continue;
    }
    const backupPath = backup(file);
    writeMcpConfig(mcp, file, mcp.withoutServer(parsed, SERVER_NAME));
    results.push({ adapterId: adapter.id, configPath: file, changed: true, backupPath });
  }
  return results;
}
