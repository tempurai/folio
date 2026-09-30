import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServerEntry, installMcpServer, uninstallMcpServer } from '../src/install.js';

const FIXTURE_SRC = fileURLToPath(new URL('./fixtures/adapters', import.meta.url));

const ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'KIMI_CODE_HOME',
  'TEMEMORY_CURSOR_HOME',
  'TEMEMORY_ZCODE_HOME',
  'HOME',
] as const;

// fixture 会被 install/uninstall 写入，每个用例统一复制到临时目录再指向它；
// HOME 指向临时目录，避免 claude-code 的 ~/.claude.json 落到真实用户目录
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let fixtures: string;
let fakeHome: string;
let tempDirs: string[];

function rec(value: unknown): Record<string, any> {
  return value as Record<string, any>;
}

function backupsOf(dir: string, prefix: string): string[] {
  return readdirSync(dir).filter((f) => f.startsWith(`${prefix}.bak-`));
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  fixtures = mkdtempSync(join(tmpdir(), 'tememory-install-fixtures-'));
  cpSync(FIXTURE_SRC, fixtures, { recursive: true });
  fakeHome = mkdtempSync(join(tmpdir(), 'tememory-install-home-'));
  tempDirs = [fixtures, fakeHome];
  process.env.CLAUDE_CONFIG_DIR = join(fixtures, 'claude-code');
  process.env.CODEX_HOME = join(fixtures, 'codex');
  process.env.KIMI_CODE_HOME = join(fixtures, 'kimi-code');
  process.env.TEMEMORY_CURSOR_HOME = join(fixtures, 'cursor');
  process.env.TEMEMORY_ZCODE_HOME = join(fixtures, 'zcode');
  process.env.HOME = fakeHome;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const saved = savedEnv[key];
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('buildServerEntry', () => {
  it('缺省与空白输入都回退到 tememory serve', () => {
    expect(buildServerEntry()).toEqual({ command: 'tememory', args: ['serve'] });
    expect(buildServerEntry('')).toEqual({ command: 'tememory', args: ['serve'] });
    expect(buildServerEntry('   ')).toEqual({ command: 'tememory', args: ['serve'] });
  });

  it('含空格时首词为 command，其余进 args 再补 serve；多余空白被压缩', () => {
    expect(buildServerEntry('node /abs/path/cli.js')).toEqual({
      command: 'node',
      args: ['/abs/path/cli.js', 'serve'],
    });
    expect(buildServerEntry('  node   /x/cli.js  --flag ')).toEqual({
      command: 'node',
      args: ['/x/cli.js', '--flag', 'serve'],
    });
  });
});

describe('installMcpServer', () => {
  it('单适配器安装：写入拆分后的 entry，保留原配置其他键并生成备份', async () => {
    const results = await installMcpServer({
      adapterIds: ['kimi-code'],
      command: 'node /abs/path/cli.js',
    });
    expect(results).toHaveLength(1);
    const target = results[0];
    expect(target.adapterId).toBe('kimi-code');
    expect(target.changed).toBe(true);
    expect(target.alreadyExisted).toBe(false);
    expect(target.configPath).toBe(join(fixtures, 'kimi-code', 'mcp.json'));
    expect(target.backupPath).toMatch(/mcp\.json\.bak-\d{14}$/);

    const parsed = rec(JSON.parse(readFileSync(target.configPath, 'utf8')));
    expect(parsed.mcpServers.tememory).toEqual({
      command: 'node',
      args: ['/abs/path/cli.js', 'serve'],
    });
    expect(parsed.mcpServers.web).toEqual({ command: 'uvx', args: ['web-mcp'] });
    expect(parsed.locale).toBe('zh-CN');

    // 备份内容是写入前的原始配置（不含 tememory）
    const backup = rec(JSON.parse(readFileSync(target.backupPath as string, 'utf8')));
    expect(backup.mcpServers.tememory).toBeUndefined();
    expect(backup.mcpServers.web).toEqual({ command: 'uvx', args: ['web-mcp'] });
  });

  it('--all 写入全部 5 家（JSON/TOML/嵌套路径），新建文件无备份', async () => {
    const results = await installMcpServer({ all: true });
    expect(results.map((t) => t.adapterId)).toEqual([
      'claude-code',
      'codex',
      'cursor',
      'kimi-code',
      'zcode',
    ]);
    for (const t of results) {
      expect(t.changed).toBe(true);
      expect(t.alreadyExisted).toBe(false);
    }

    // claude-code 的配置在 HOME 根的 .claude.json：原本不存在 → 新建，无备份
    const claude = rec(JSON.parse(readFileSync(join(fakeHome, '.claude.json'), 'utf8')));
    expect(claude.mcpServers.tememory).toEqual({ command: 'tememory', args: ['serve'] });
    const claudeTarget = results.find((t) => t.adapterId === 'claude-code');
    expect(claudeTarget?.backupPath).toBeUndefined();
    expect(backupsOf(fakeHome, '.claude.json')).toHaveLength(0);

    const cursor = rec(JSON.parse(readFileSync(join(fixtures, 'cursor', 'mcp.json'), 'utf8')));
    expect(cursor.mcpServers.tememory).toEqual({ command: 'tememory', args: ['serve'] });
    expect(cursor.mcpServers.docs).toEqual({ url: 'https://mcp.example.com/sse' });
    expect(cursor.editor).toEqual({ enabled: true });

    const zcode = rec(
      JSON.parse(readFileSync(join(fixtures, 'zcode', 'cli', 'config.json'), 'utf8')),
    );
    expect(zcode.mcp.servers.tememory).toEqual({ command: 'tememory', args: ['serve'] });
    expect(zcode.mcp.servers.fs).toEqual({ command: 'npx', args: ['-y', 'server-fs'] });
    expect(zcode.mcp.timeoutMs).toBe(5000);
    expect(zcode.theme).toBe('dark');

    const codex = rec(parseToml(readFileSync(join(fixtures, 'codex', 'config.toml'), 'utf8')));
    expect(codex.mcp_servers.tememory).toEqual({ command: 'tememory', args: ['serve'] });
    expect(codex.mcp_servers.fs).toEqual({ command: 'npx', args: ['-y', 'server-fs'] });
    expect(codex.model).toBe('gpt-5-codex');

    // 已存在的 4 家都生成了带时间戳的备份
    for (const t of results.filter((x) => x.adapterId !== 'claude-code')) {
      expect(t.backupPath).toMatch(/\.bak-\d{14}$/);
      expect(existsSync(t.backupPath as string)).toBe(true);
    }
  });

  it('重复安装：alreadyExisted=true，旧 entry 被覆盖', async () => {
    await installMcpServer({ adapterIds: ['kimi-code'], command: 'node /old/cli.js' });
    const results = await installMcpServer({ adapterIds: ['kimi-code'] });
    expect(results[0].alreadyExisted).toBe(true);
    const parsed = rec(JSON.parse(readFileSync(results[0].configPath, 'utf8')));
    expect(parsed.mcpServers.tememory).toEqual({ command: 'tememory', args: ['serve'] });
  });

  it('未知适配器抛错；全部未检测到且未加 all 时抛「没有可安装的适配器」', async () => {
    await expect(installMcpServer({ adapterIds: ['nope'] })).rejects.toThrow('未知适配器：nope');

    for (const key of ENV_KEYS.slice(0, 5)) process.env[key] = join(fixtures, 'does-not-exist');
    await expect(installMcpServer()).rejects.toThrow('没有可安装的适配器');
    // all 强制面向全部适配器，即使未检测到
    const forced = await installMcpServer({ all: true, adapterIds: ['kimi-code'] });
    expect(forced).toHaveLength(1);
    expect(existsSync(join(fixtures, 'does-not-exist', 'mcp.json'))).toBe(true);
  });
});

describe('uninstallMcpServer', () => {
  it('install → uninstall roundtrip：移除注册且保留其他 server，重复执行提示原因', async () => {
    await installMcpServer({ all: true });
    const results = await uninstallMcpServer({ all: true });
    expect(results).toHaveLength(5);
    for (const t of results) {
      expect(t.changed).toBe(true);
      expect(t.reason).toBeUndefined();
      expect(t.backupPath).toMatch(/\.bak-\d{14}$/);
    }

    const kimi = rec(JSON.parse(readFileSync(join(fixtures, 'kimi-code', 'mcp.json'), 'utf8')));
    expect(kimi.mcpServers.tememory).toBeUndefined();
    expect(kimi.mcpServers.web).toEqual({ command: 'uvx', args: ['web-mcp'] });
    expect(kimi.locale).toBe('zh-CN');

    const codex = rec(parseToml(readFileSync(join(fixtures, 'codex', 'config.toml'), 'utf8')));
    expect(codex.mcp_servers.tememory).toBeUndefined();
    expect(codex.mcp_servers.fs).toEqual({ command: 'npx', args: ['-y', 'server-fs'] });
    expect(codex.model).toBe('gpt-5-codex');

    const claude = rec(JSON.parse(readFileSync(join(fakeHome, '.claude.json'), 'utf8')));
    expect(claude.mcpServers.tememory).toBeUndefined();

    // 再次卸载：均未注册
    const again = await uninstallMcpServer({ all: true });
    for (const t of again) {
      expect(t.changed).toBe(false);
      expect(t.backupPath).toBeUndefined();
      expect(t.reason).toBe('not-registered');
    }
  });

  it('配置文件不存在时 reason=config-missing，未注册时 reason=not-registered', async () => {
    const results = await uninstallMcpServer({ all: true });
    const byId = Object.fromEntries(results.map((t) => [t.adapterId, t]));
    // claude-code 的 ~/.claude.json 从未创建
    expect(byId['claude-code'].reason).toBe('config-missing');
    expect(byId['claude-code'].changed).toBe(false);
    // cursor 有配置文件但从未注册
    expect(byId['cursor'].reason).toBe('not-registered');
    // 跳过的都不产生备份
    expect(backupsOf(fakeHome, '.claude.json')).toHaveLength(0);
    expect(backupsOf(join(fixtures, 'cursor'), 'mcp.json')).toHaveLength(0);
  });

  it('未知适配器抛错', async () => {
    await expect(uninstallMcpServer({ adapterIds: ['nope'] })).rejects.toThrow('未知适配器：nope');
  });
});
