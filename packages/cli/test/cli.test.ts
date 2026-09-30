import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const FIXTURE_SRC = fileURLToPath(
  new URL('../../core/test/fixtures/adapters', import.meta.url),
);

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

// fixture 会被 install/uninstall 写入，统一复制到临时目录再指向它；
// HOME 也指向临时目录，避免 claude-code 的 ~/.claude.json 落到真实用户目录
let home: string;
let fakeHome: string;
let workDir: string;
let fixtures: string;
let baseEnv: NodeJS.ProcessEnv;

function run(args: string[], extraEnv?: NodeJS.ProcessEnv): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: workDir,
    env: { ...baseEnv, ...extraEnv },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30_000,
  });
  if (res.error) {
    throw new Error(
      `spawn 失败（${args.join(' ')}）：${res.error.message}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`,
    );
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function runJson<T>(args: string[]): T {
  const res = run([...args, '--json']);
  expect(res.status, `命令 ${args.join(' ')} 应成功，stderr: ${res.stderr}`).toBe(0);
  return JSON.parse(res.stdout) as T;
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'tememory-cli-home-'));
  fakeHome = mkdtempSync(join(tmpdir(), 'tememory-cli-fakehome-'));
  workDir = mkdtempSync(join(tmpdir(), 'tememory-cli-workdir-'));
  fixtures = mkdtempSync(join(tmpdir(), 'tememory-cli-fixtures-'));
  cpSync(FIXTURE_SRC, fixtures, { recursive: true });
  baseEnv = {
    ...process.env,
    TEMEMORY_HOME: home,
    HOME: fakeHome,
    CLAUDE_CONFIG_DIR: join(fixtures, 'claude-code'),
    CODEX_HOME: join(fixtures, 'codex'),
    KIMI_CODE_HOME: join(fixtures, 'kimi-code'),
    TEMEMORY_CURSOR_HOME: join(fixtures, 'cursor'),
    TEMEMORY_ZCODE_HOME: join(fixtures, 'zcode'),
    // 保证 organize/sync 走本地路径，不触碰真实 LLM
    TEMEMORY_LLM_API_KEY: '',
    TEMEMORY_LLM_BASE_URL: '',
    TEMEMORY_LLM_MODEL: '',
  };
});

describe('init', () => {
  it('首次创建、二次幂等，--json 输出可解析', () => {
    const first = run(['init']);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(home);
    expect(first.stdout).toContain('已创建');

    const second = run(['init']);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('已存在');

    const parsed = runJson<{ home: string; created: boolean }>(['init']);
    expect(parsed).toEqual({ home, created: false });
  });
});

describe('sync', () => {
  interface AdapterReport {
    id: string;
    detected: boolean;
    added: number;
    updated: number;
    skipped: number;
    removed: number;
    errors: string[];
  }
  interface Report {
    adapters: AdapterReport[];
    errors: string[];
  }

  it('首次同步：5 个适配器全部检测到，按 fixture 条目数 added', () => {
    const report = runJson<Report>(['sync']);
    expect(report.errors).toEqual([]);
    expect(report.adapters).toHaveLength(5);
    const byId = Object.fromEntries(report.adapters.map((a) => [a.id, a]));
    for (const a of report.adapters) expect(a.detected).toBe(true);
    expect(byId['claude-code'].added).toBe(7);
    expect(byId['codex'].added).toBe(4);
    expect(byId['cursor'].added).toBe(2);
    expect(byId['kimi-code'].added).toBe(3);
    expect(byId['zcode'].added).toBe(3);
    // 同步后生成搜索索引缓存
    expect(existsSync(join(home, 'cache', 'search-index.json'))).toBe(true);
  });

  it('二次同步：全部 skipped；人类可读输出含进度与汇总表', () => {
    const human = run(['sync']);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('▸ claude-code');
    expect(human.stdout).toContain('同步汇总');
    expect(human.stdout).toContain('适配器');

    const report = runJson<Report>(['sync']);
    for (const a of report.adapters) {
      expect(a.added).toBe(0);
      expect(a.updated).toBe(0);
      expect(a.removed).toBe(0);
    }
    expect(report.adapters.reduce((n, a) => n + a.skipped, 0)).toBe(19);
  });
});

interface MetaRow {
  id: string;
  type: string;
  scope: string;
  title: string;
  tags: string[];
  source: { harness: string; path?: string; importedAt: string };
}

describe('list', () => {
  it('表格输出包含已知标题；--json 返回全部 19 条', () => {
    const human = run(['list']);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('Kimi Code 全局指令');
    expect(human.stdout).toContain('Claude Code 用户全局指令');

    const metas = runJson<MetaRow[]>(['list']);
    expect(metas).toHaveLength(19);
  });

  it('--type / --limit 过滤生效', () => {
    const users = runJson<MetaRow[]>(['list', '--type', 'user']);
    expect(users).toHaveLength(5);
    expect(users.every((m) => m.type === 'user')).toBe(true);

    const limited = runJson<MetaRow[]>(['list', '--limit', '3']);
    expect(limited).toHaveLength(3);

    const bad = run(['list', '--type', 'nope']);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('错误：');
  });
});

describe('search', () => {
  it('按关键词命中并输出 snippet；--json 结构完整', () => {
    const human = run(['search', '中文']);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('Claude Code 用户全局指令');
    expect(human.stdout).toContain('始终使用中文回复');

    const hits = runJson<Array<{ id: string; title: string; snippet: string; score: number }>>([
      'search',
      '中文',
    ]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.title === 'Claude Code 用户全局指令')).toBe(true);
    expect(hits.every((h) => typeof h.snippet === 'string')).toBe(true);
  });

  it('无命中时正常退出', () => {
    // 纯 ASCII 串不会被中文分词拆碎，fixture 中不存在该 token
    const res = run(['search', 'zzqqxxvv']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('没有找到');
  });
});

describe('show', () => {
  it('完整 id 与 12 位前缀都能命中，输出 frontmatter 与正文', () => {
    const metas = runJson<MetaRow[]>(['list']);
    const target = metas.find((m) => m.title === 'Kimi Code 全局指令');
    expect(target).toBeDefined();
    // 选一个 12 位前缀唯一的条目，避免同毫秒建 id 造成的前缀碰撞
    const uniquePrefix = metas.find(
      (m) => metas.filter((x) => x.id.startsWith(m.id.slice(0, 12))).length === 1,
    );
    expect(uniquePrefix).toBeDefined();

    const full = run(['show', target!.id]);
    expect(full.status).toBe(0);
    expect(full.stdout).toContain(`id: ${target!.id}`);
    expect(full.stdout).toContain('type: user');
    expect(full.stdout).toContain('source.harness: kimi-code');
    expect(full.stdout).toContain('---');
    expect(full.stdout).toContain('遵循项目现有代码风格');

    const byPrefix = run(['show', uniquePrefix!.id.slice(0, 12)]);
    expect(byPrefix.status).toBe(0);
    expect(byPrefix.stdout).toContain(`id: ${uniquePrefix!.id}`);

    const asJson = runJson<{ id: string; content: string }>(['show', target!.id]);
    expect(asJson.id).toBe(target!.id);
    expect(asJson.content).toContain('遵循项目现有代码风格');
  });

  it('id 不存在：退出码 1，stderr 单行中文错误', () => {
    const res = run(['show', 'm_doesnotexist000']);
    expect(res.status).toBe(1);
    expect(res.stderr.trim().split('\n')).toHaveLength(1);
    expect(res.stderr).toContain('错误：找不到记忆');
  });
});

const CONFLICT_A = 'm_conflictaaaa01';
const CONFLICT_B = 'm_conflictbbbb02';

function writeConflictMemory(id: string, title: string, otherId: string, content: string): void {
  const dir = join(home, 'memory', 'reference');
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    join(dir, `${title}-${id}.md`),
    `---
id: ${id}
type: reference
scope: global
title: ${title}
tags: []
source:
  harness: test
  importedAt: "${now}"
hash: fakehash-${id}
created: "${now}"
updated: "${now}"
conflictsWith:
  - ${otherId}
---
${content}
`,
    'utf8',
  );
}

describe('conflicts', () => {
  it('无冲突时提示；手工构造 conflictsWith 后能列出记忆对', () => {
    const empty = run(['conflicts']);
    expect(empty.status).toBe(0);
    expect(empty.stdout).toContain('没有');
    expect(runJson<unknown[]>(['conflicts'])).toEqual([]);

    writeConflictMemory(CONFLICT_A, '冲突甲', CONFLICT_B, '部署应该使用蓝色环境。');
    writeConflictMemory(CONFLICT_B, '冲突乙', CONFLICT_A, '部署应该使用绿色环境。');

    const pairs = runJson<Array<{ ids: string[]; titles: string[] }>>(['conflicts']);
    expect(pairs).toHaveLength(1);
    expect([...pairs[0].ids].sort()).toEqual([CONFLICT_A, CONFLICT_B].sort());

    const human = run(['conflicts']);
    expect(human.stdout).toContain('冲突甲');
    expect(human.stdout).toContain('冲突乙');
  });
});

describe('organize', () => {
  it('无 LLM 时明确提示并走本地查重；dry-run 不改动，--apply 正常执行', () => {
    const dry = run(['organize']);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('LLM 不可用');

    const plan = runJson<{ llmUsed: boolean; ops: unknown[] }>(['organize']);
    expect(plan.llmUsed).toBe(false);
    expect(Array.isArray(plan.ops)).toBe(true);

    const applied = run(['organize', '--apply']);
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain('执行完成');

    const appliedJson = runJson<{ report: { merged: number; errors: string[] } }>([
      'organize',
      '--apply',
    ]);
    expect(appliedJson.report.errors).toEqual([]);
  });
});

describe('stats', () => {
  it('按类型 / 作用域 / 来源 harness 分组计数', () => {
    const human = run(['stats']);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('按类型');
    expect(human.stdout).toContain('按来源 harness');

    // 19 条同步记忆 + 2 条手工构造的冲突记忆
    const stats = runJson<{
      total: number;
      byType: Record<string, number>;
      byHarness: Record<string, number>;
    }>(['stats']);
    expect(stats.total).toBe(21);
    expect(stats.byType.user).toBe(5);
    expect(stats.byType.reference).toBe(10);
    expect(stats.byHarness['claude-code']).toBe(7);
    expect(stats.byHarness['test']).toBe(2);
  });
});

describe('install / uninstall', () => {
  it('--command 含空格时拆分为 command + args；保留原配置其他键并生成备份', () => {
    const res = run(['install', '--adapter', 'kimi-code', '--command', 'node /abs/path/cli.js']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('已写入');
    expect(res.stdout).toContain('已备份');

    const file = join(fixtures, 'kimi-code', 'mcp.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;
    expect(parsed.mcpServers.tememory).toEqual({
      command: 'node',
      args: ['/abs/path/cli.js', 'serve'],
    });
    expect(parsed.mcpServers.web).toEqual({ command: 'uvx', args: ['web-mcp'] });
    expect(parsed.locale).toBe('zh-CN');

    const backups = readdirSync(join(fixtures, 'kimi-code')).filter((f) =>
      /^mcp\.json\.bak-\d{14}$/.test(f),
    );
    expect(backups).toHaveLength(1);
    const backupParsed = JSON.parse(
      readFileSync(join(fixtures, 'kimi-code', backups[0]), 'utf8'),
    ) as Record<string, any>;
    expect(backupParsed.mcpServers.tememory).toBeUndefined();
  });

  it('install --all 写入全部 5 家（JSON/TOML/嵌套路径/新建 ~/.claude.json），重复安装提示覆盖', () => {
    const res = run(['install', '--all']);
    expect(res.status).toBe(0);
    // kimi-code 上一轮已注册 → 覆盖提示
    expect(res.stdout).toContain('覆盖');

    const cursor = JSON.parse(
      readFileSync(join(fixtures, 'cursor', 'mcp.json'), 'utf8'),
    ) as Record<string, any>;
    expect(cursor.mcpServers.tememory).toEqual({ command: 'tememory', args: ['serve'] });
    expect(cursor.mcpServers.docs).toEqual({ url: 'https://mcp.example.com/sse' });
    expect(cursor.editor).toEqual({ enabled: true });

    const zcode = JSON.parse(
      readFileSync(join(fixtures, 'zcode', 'cli', 'config.json'), 'utf8'),
    ) as Record<string, any>;
    expect(zcode.mcp.servers.tememory).toEqual({ command: 'tememory', args: ['serve'] });
    expect(zcode.mcp.servers.fs).toEqual({ command: 'npx', args: ['-y', 'server-fs'] });
    expect(zcode.mcp.timeoutMs).toBe(5000);
    expect(zcode.theme).toBe('dark');

    const codex = parseToml(
      readFileSync(join(fixtures, 'codex', 'config.toml'), 'utf8'),
    ) as Record<string, any>;
    expect(codex.mcp_servers.tememory).toEqual({ command: 'tememory', args: ['serve'] });
    expect(codex.mcp_servers.fs).toEqual({ command: 'npx', args: ['-y', 'server-fs'] });
    expect(codex.model).toBe('gpt-5-codex');

    // claude-code 的配置在 HOME 根的 .claude.json（原本不存在 → 新建，无备份）
    const claudeFile = join(fakeHome, '.claude.json');
    const claude = JSON.parse(readFileSync(claudeFile, 'utf8')) as Record<string, any>;
    expect(claude.mcpServers.tememory).toEqual({ command: 'tememory', args: ['serve'] });
    expect(
      readdirSync(fakeHome).filter((f) => f.startsWith('.claude.json.bak-')),
    ).toHaveLength(0);

    // 其余各家都生成了带时间戳的备份
    for (const backupDir of [
      join(fixtures, 'cursor'),
      join(fixtures, 'codex'),
      join(fixtures, 'zcode', 'cli'),
    ]) {
      expect(readdirSync(backupDir).some((f) => f.includes('.bak-'))).toBe(true);
    }
  });

  it('uninstall --all 移除注册且保留其他 server；重复执行提示跳过', () => {
    const res = run(['uninstall', '--all']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('移除');

    const kimi = JSON.parse(
      readFileSync(join(fixtures, 'kimi-code', 'mcp.json'), 'utf8'),
    ) as Record<string, any>;
    expect(kimi.mcpServers.tememory).toBeUndefined();
    expect(kimi.mcpServers.web).toEqual({ command: 'uvx', args: ['web-mcp'] });
    expect(kimi.locale).toBe('zh-CN');

    const codex = parseToml(
      readFileSync(join(fixtures, 'codex', 'config.toml'), 'utf8'),
    ) as Record<string, any>;
    expect(codex.mcp_servers.tememory).toBeUndefined();
    expect(codex.mcp_servers.fs).toEqual({ command: 'npx', args: ['-y', 'server-fs'] });
    expect(codex.model).toBe('gpt-5-codex');

    const claude = JSON.parse(
      readFileSync(join(fakeHome, '.claude.json'), 'utf8'),
    ) as Record<string, any>;
    expect(claude.mcpServers.tememory).toBeUndefined();

    const again = run(['uninstall', '--all']);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('未注册');
  });
});

describe('doctor', () => {
  it('逐项输出 ✅/⚠️/❌；--json 结构完整', () => {
    const human = run(['doctor']);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('✅');
    expect(human.stdout).toContain('适配器 claude-code');
    expect(human.stdout).toContain('记忆库');
    expect(human.stdout).toContain('搜索索引');

    const report = runJson<{
      home: string;
      items: Array<{ name: string; status: string; detail: string }>;
      summary: { ok: number; warn: number; error: number };
    }>(['doctor']);
    expect(report.home).toBe(home);
    const adapterItems = report.items.filter((i) => i.name.startsWith('适配器'));
    expect(adapterItems).toHaveLength(5);
    expect(adapterItems.every((i) => i.status === 'ok')).toBe(true);
    expect(report.items).toHaveLength(9); // 主目录 + 配置 + 5 适配器 + 记忆库 + 搜索索引
    expect(report.summary.error).toBe(0);
  });
});

describe('全局行为', () => {
  it('--help 列出全部 13 个子命令', () => {
    const res = run(['--help']);
    expect(res.status).toBe(0);
    for (const name of [
      'init',
      'sync',
      'watch',
      'list',
      'search',
      'show',
      'organize',
      'conflicts',
      'serve',
      'install',
      'uninstall',
      'doctor',
      'stats',
    ]) {
      expect(res.stdout).toContain(name);
    }
  });

  it('serve / watch 命令存在（不真正启动 stdio 或常驻监听）', () => {
    const serve = run(['serve', '--help']);
    expect(serve.status).toBe(0);
    expect(serve.stdout).toContain('stdio');

    const watch = run(['watch', '--help']);
    expect(watch.status).toBe(0);
    expect(watch.stdout).toContain('debounce');
  });

  it('退出码：用法错误 2，运行错误 1，成功 0', () => {
    expect(run(['frobnicate']).status).toBe(2);
    expect(run(['show']).status).toBe(2);
    expect(run(['show', 'm_doesnotexist000']).status).toBe(1);
    expect(run(['list']).status).toBe(0);
  });

  it('--home 优先级高于 TEMEMORY_HOME，且可放在子命令之后', () => {
    const other = mkdtempSync(join(tmpdir(), 'tememory-cli-other-'));
    const created = run(['init', '--home', other]);
    expect(created.status).toBe(0);
    expect(created.stdout).toContain(other);
    expect(existsSync(join(other, 'config.toml'))).toBe(true);

    // --home 放前面也生效；该目录与 TEMEMORY_HOME 相互独立
    const list = run(['--home', other, 'list', '--json']);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });
});
