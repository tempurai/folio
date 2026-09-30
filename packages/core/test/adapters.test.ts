import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeCodeAdapter } from '../src/adapters/claude-code.js';
import { codexAdapter } from '../src/adapters/codex.js';
import { cursorAdapter } from '../src/adapters/cursor.js';
import { adapters, getAdapter } from '../src/adapters/index.js';
import { kimiCodeAdapter } from '../src/adapters/kimi-code.js';
import type { McpIntegration, RawMemoryItem } from '../src/adapters/types.js';
import {
  decodeProjectDirName,
  readMarkdownItem,
  walkMarkdown,
} from '../src/adapters/utils.js';
import { zcodeAdapter } from '../src/adapters/zcode.js';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const adapterHome = (id: string): string => join(FIXTURES, 'adapters', id);
const projAlpha = join(FIXTURES, 'projects', 'proj-alpha');

const ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'KIMI_CODE_HOME',
  'FOLIO_CURSOR_HOME',
  'FOLIO_ZCODE_HOME',
] as const;

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function byBase(items: RawMemoryItem[], name: string): RawMemoryItem | undefined {
  return items.find((item) => basename(item.sourcePath) === name);
}

function rec(value: unknown): Record<string, any> {
  return value as Record<string, any>;
}

function mcpOf(adapter: { mcp?: McpIntegration }): McpIntegration {
  if (!adapter.mcp) throw new Error('adapter has no mcp integration');
  return adapter.mcp;
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.CLAUDE_CONFIG_DIR = adapterHome('claude-code');
  process.env.CODEX_HOME = adapterHome('codex');
  process.env.KIMI_CODE_HOME = adapterHome('kimi-code');
  process.env.FOLIO_CURSOR_HOME = adapterHome('cursor');
  process.env.FOLIO_ZCODE_HOME = adapterHome('zcode');
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const saved = savedEnv[key];
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

describe('注册表', () => {
  it('包含全部 5 个适配器，getAdapter 按 id 查找', () => {
    expect(adapters.map((a) => a.id)).toEqual([
      'claude-code',
      'codex',
      'cursor',
      'kimi-code',
      'zcode',
    ]);
    expect(getAdapter('cursor')).toBe(cursorAdapter);
    expect(getAdapter('kimi-code')?.name).toBe('Kimi Code');
    expect(getAdapter('nope')).toBeUndefined();
  });
});

describe('utils', () => {
  it('decodeProjectDirName 对 harness 目录名做 best-effort 解码', () => {
    expect(decodeProjectDirName('-Users-alice-projects-x')).toBe('/Users/alice/projects/x');
    expect(decodeProjectDirName('plain-name')).toBe('plain-name');
  });

  it('walkMarkdown 目录不存在时返回空数组', () => {
    expect(walkMarkdown(join(FIXTURES, 'no-such-dir'))).toEqual([]);
  });

  it('readMarkdownItem 对损坏 frontmatter 容错：整个文件当正文', () => {
    const item = readMarkdownItem(
      join(
        adapterHome('claude-code'),
        'projects',
        '-Users-alice-projects-x',
        'memory',
        'broken.md',
      ),
    );
    expect(item.frontmatter).toEqual({});
    expect(item.content).toContain('[unclosed');
    expect(item.content).toContain('frontmatter 损坏');
    expect(new Date(item.mtime).toISOString()).toBe(item.mtime);
  });
});

describe('claude-code', () => {
  it('detect：home 目录存在与否', async () => {
    await expect(claudeCodeAdapter.detect()).resolves.toBe(true);
    process.env.CLAUDE_CONFIG_DIR = join(FIXTURES, 'adapters', 'does-not-exist');
    await expect(claudeCodeAdapter.detect()).resolves.toBe(false);
  });

  it('collect 覆盖 CLAUDE.md / rules / projects memory，跳过索引与会话', async () => {
    const items = await claudeCodeAdapter.collect({ projectDirs: [] });
    expect(items).toHaveLength(7);

    const globalInstructions = byBase(items, 'CLAUDE.md');
    expect(globalInstructions).toMatchObject({
      harnessId: 'claude-code',
      typeHint: 'user',
      scope: 'global',
      title: 'Claude Code 用户全局指令',
    });
    expect(globalInstructions?.content).toContain('中文');

    for (const name of ['style.md', 'security.md']) {
      expect(byBase(items, name)).toMatchObject({
        harnessId: 'claude-code',
        typeHint: 'reference',
        scope: 'global',
      });
    }

    const api = byBase(items, 'api-design.md');
    expect(api).toMatchObject({
      typeHint: 'reference',
      scope: 'project:/Users/alice/projects/x',
      title: 'API 设计约定',
      metadata: { rawProjectDir: '-Users-alice-projects-x' },
    });
    // frontmatter 已被剥离
    expect(api?.content).not.toContain('type: reference');
    expect(new Date(api!.mtime).toISOString()).toBe(api!.mtime);

    expect(byBase(items, 'feedback-dark-mode.md')).toMatchObject({
      typeHint: 'feedback',
      scope: 'project:/Users/alice/projects/x',
    });

    const broken = byBase(items, 'broken.md');
    expect(broken).toBeDefined();
    expect(broken?.typeHint).toBeUndefined();
    expect(broken?.scope).toBe('project:/Users/alice/projects/x');
    expect(broken?.content).toContain('frontmatter 损坏');
    expect(broken?.content).toContain('[unclosed');

    expect(byBase(items, 'project-context.md')).toMatchObject({
      typeHint: 'project',
      scope: 'project:/Users/alice/projects/y',
    });

    // MEMORY.md 索引与 sessions/ 等目录一律跳过
    expect(items.some((item) => basename(item.sourcePath) === 'MEMORY.md')).toBe(false);
    expect(items.some((item) => item.sourcePath.includes('sessions'))).toBe(false);
  });
});

describe('codex', () => {
  it('detect：home 目录存在与否', async () => {
    await expect(codexAdapter.detect()).resolves.toBe(true);
    process.env.CODEX_HOME = join(FIXTURES, 'adapters', 'does-not-exist');
    await expect(codexAdapter.detect()).resolves.toBe(false);
  });

  it('collect 覆盖 AGENTS.md / memories，跳过 memories_extensions 与 sessions', async () => {
    const items = await codexAdapter.collect({ projectDirs: [] });
    expect(items).toHaveLength(4);

    expect(byBase(items, 'AGENTS.md')).toMatchObject({
      harnessId: 'codex',
      typeHint: 'user',
      scope: 'global',
      title: 'Codex 全局指令',
    });

    expect(byBase(items, 'note-one.md')).toMatchObject({ typeHint: 'user', scope: 'global' });

    const plain = byBase(items, 'plain.md');
    expect(plain).toMatchObject({ typeHint: 'reference', scope: 'global', title: 'plain' });

    // frontmatter 带明确项目信息时归为项目级
    expect(byBase(items, 'proj-scoped.md')).toMatchObject({
      typeHint: 'project',
      scope: 'project:my-app',
    });

    // memories_extensions（屏幕上下文，敏感）与 sessions 绝不收集
    expect(byBase(items, 'screen.md')).toBeUndefined();
    expect(items.some((item) => item.sourcePath.includes('memories_extensions'))).toBe(false);
    expect(items.some((item) => item.sourcePath.includes('sessions'))).toBe(false);
  });

  it('home 不存在时 collect 尽力而为返回空数组，不抛异常', async () => {
    process.env.CODEX_HOME = join(FIXTURES, 'adapters', 'does-not-exist');
    await expect(codexAdapter.collect({ projectDirs: [] })).resolves.toEqual([]);
  });
});

describe('cursor', () => {
  it('collect 覆盖全局 rules（.md/.mdc）与项目级 .cursor/rules（.mdc）', async () => {
    const items = await cursorAdapter.collect({ projectDirs: [projAlpha] });
    expect(items).toHaveLength(3);

    expect(byBase(items, 'general.md')).toMatchObject({
      harnessId: 'cursor',
      typeHint: 'reference',
      scope: 'global',
    });
    const tsRules = byBase(items, 'ts-rules.mdc');
    expect(tsRules).toMatchObject({ typeHint: 'reference', scope: 'global' });
    // 全局 rules 不附带 cursorRule metadata（仅项目级规则携带）
    expect(tsRules?.metadata).toBeUndefined();

    const alpha = byBase(items, 'alpha.mdc');
    expect(alpha).toMatchObject({
      typeHint: 'reference',
      scope: `project:${projAlpha}`,
    });
    expect(alpha?.metadata).toEqual({
      cursorRule: {
        description: 'Alpha 项目规则',
        globs: ['src/**/*.ts', 'test/**/*.ts'],
        alwaysApply: false,
      },
    });
  });

  it('无 projectDirs 时只收集全局规则', async () => {
    const items = await cursorAdapter.collect({ projectDirs: [] });
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.scope === 'global')).toBe(true);
  });
});

describe('kimi-code', () => {
  it('collect 覆盖 AGENTS.md / memories，跳过 MEMORY.md，按目录划项目 scope', async () => {
    const items = await kimiCodeAdapter.collect({ projectDirs: [] });
    expect(items).toHaveLength(3);

    expect(byBase(items, 'AGENTS.md')).toMatchObject({
      harnessId: 'kimi-code',
      typeHint: 'user',
      scope: 'global',
      title: 'Kimi Code 全局指令',
    });
    expect(byBase(items, 'global-note.md')).toMatchObject({
      typeHint: 'feedback',
      scope: 'global',
    });
    expect(byBase(items, 'proj-note.md')).toMatchObject({
      typeHint: 'project',
      scope: 'project:my-proj',
    });
    expect(items.some((item) => basename(item.sourcePath) === 'MEMORY.md')).toBe(false);
  });
});

describe('zcode', () => {
  it('collect 覆盖 AGENTS.md / cli 项目 memory / agent-memory（全局+项目级）', async () => {
    const items = await zcodeAdapter.collect({ projectDirs: [projAlpha] });
    expect(items).toHaveLength(4);

    expect(byBase(items, 'AGENTS.md')).toMatchObject({
      harnessId: 'zcode',
      typeHint: 'user',
      scope: 'global',
      title: 'ZCode 全局指令',
    });

    expect(byBase(items, 'topic.md')).toMatchObject({
      typeHint: 'feedback',
      scope: 'project:zapp',
      metadata: { rawProjectDir: 'zapp' },
    });

    expect(byBase(items, 'global-agent.md')).toMatchObject({
      typeHint: 'reference',
      scope: 'global',
      metadata: { agentMemory: true },
    });

    expect(byBase(items, 'alpha-agent.md')).toMatchObject({
      typeHint: 'reference',
      scope: `project:${projAlpha}`,
      metadata: { agentMemory: true },
    });

    expect(items.some((item) => basename(item.sourcePath) === 'MEMORY.md')).toBe(false);
  });
});

describe('MCP 集成', () => {
  it('claude-code：json，configPath 在家目录根的 .claude.json，顶层 mcpServers', () => {
    const mcp = mcpOf(claudeCodeAdapter);
    expect(mcp.format).toBe('json');
    expect(mcp.configPath()).toBe(join(homedir(), '.claude.json'));

    const parsed = { theme: 'dark', mcpServers: { fs: { command: 'npx' } } };
    expect(mcp.getServers(parsed)).toEqual({ fs: { command: 'npx' } });

    const added = rec(mcp.withServer(parsed, 'folio', { command: 'folio' }));
    expect(added.mcpServers).toEqual({
      fs: { command: 'npx' },
      folio: { command: 'folio' },
    });
    expect(added.theme).toBe('dark');
    // 不修改原对象
    expect(parsed.mcpServers).toEqual({ fs: { command: 'npx' } });

    const removed = rec(mcp.withoutServer(added, 'fs'));
    expect(removed.mcpServers).toEqual({ folio: { command: 'folio' } });
    expect(removed.theme).toBe('dark');

    // 非法输入容错
    expect(mcp.getServers(null)).toEqual({});
    expect(mcp.getServers('nonsense')).toEqual({});
    expect(mcp.withServer(undefined, 'a', 1)).toEqual({ mcpServers: { a: 1 } });
  });

  it('codex：toml，configPath = <codexHome>/config.toml，顶层 mcp_servers', () => {
    const mcp = mcpOf(codexAdapter);
    expect(mcp.format).toBe('toml');
    const configPath = mcp.configPath();
    expect(configPath).toBe(join(adapterHome('codex'), 'config.toml'));

    const parsed = parseToml(readFileSync(configPath, 'utf8'));
    expect(mcp.getServers(parsed)).toEqual({ fs: { command: 'npx', args: ['-y', 'server-fs'] } });

    const added = rec(mcp.withServer(parsed, 'folio', { command: 'folio', args: ['mcp'] }));
    expect(added.mcp_servers).toEqual({
      fs: { command: 'npx', args: ['-y', 'server-fs'] },
      folio: { command: 'folio', args: ['mcp'] },
    });
    // 其他顶层键保留
    expect(added.model).toBe('gpt-5-codex');
    expect(added.approval_policy).toBe('on-request');

    const removed = rec(mcp.withoutServer(added, 'fs'));
    expect(removed.mcp_servers).toEqual({ folio: { command: 'folio', args: ['mcp'] } });
    expect(removed.model).toBe('gpt-5-codex');
  });

  it('cursor：json，configPath = <cursorHome>/mcp.json，顶层 mcpServers', () => {
    const mcp = mcpOf(cursorAdapter);
    expect(mcp.format).toBe('json');
    const configPath = mcp.configPath();
    expect(configPath).toBe(join(adapterHome('cursor'), 'mcp.json'));

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    const added = rec(mcp.withServer(parsed, 'folio', { command: 'folio' }));
    expect(added.mcpServers).toEqual({
      docs: { url: 'https://mcp.example.com/sse' },
      folio: { command: 'folio' },
    });
    expect(added.editor).toEqual({ enabled: true });

    const removed = rec(mcp.withoutServer(added, 'docs'));
    expect(removed.mcpServers).toEqual({ folio: { command: 'folio' } });
    expect(removed.editor).toEqual({ enabled: true });
  });

  it('kimi-code：json，configPath = <kimiHome>/mcp.json，顶层 mcpServers', () => {
    const mcp = mcpOf(kimiCodeAdapter);
    expect(mcp.format).toBe('json');
    const configPath = mcp.configPath();
    expect(configPath).toBe(join(adapterHome('kimi-code'), 'mcp.json'));

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    const added = rec(mcp.withServer(parsed, 'folio', { command: 'folio' }));
    expect(added.mcpServers).toEqual({
      web: { command: 'uvx', args: ['web-mcp'] },
      folio: { command: 'folio' },
    });
    expect(added.locale).toBe('zh-CN');

    const removed = rec(mcp.withoutServer(added, 'web'));
    expect(removed.mcpServers).toEqual({ folio: { command: 'folio' } });
    expect(removed.locale).toBe('zh-CN');
  });

  it('zcode：json，configPath = <zcodeHome>/cli/config.json，嵌套 mcp.servers', () => {
    const mcp = mcpOf(zcodeAdapter);
    expect(mcp.format).toBe('json');
    const configPath = mcp.configPath();
    expect(configPath).toBe(join(adapterHome('zcode'), 'cli', 'config.json'));

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    expect(mcp.getServers(parsed)).toEqual({ fs: { command: 'npx', args: ['-y', 'server-fs'] } });

    const added = rec(mcp.withServer(parsed, 'folio', { command: 'folio' }));
    expect(added.mcp.servers).toEqual({
      fs: { command: 'npx', args: ['-y', 'server-fs'] },
      folio: { command: 'folio' },
    });
    // 嵌套路径上的其他键与顶层其他键都保留
    expect(added.mcp.timeoutMs).toBe(5000);
    expect(added.theme).toBe('dark');

    const removed = rec(mcp.withoutServer(added, 'fs'));
    expect(removed.mcp.servers).toEqual({ folio: { command: 'folio' } });
    expect(removed.mcp.timeoutMs).toBe(5000);
    expect(removed.theme).toBe('dark');

    // 空配置 / 缺失中间层时自动补出嵌套结构
    expect(mcp.withServer({}, 'a', 1)).toEqual({ mcp: { servers: { a: 1 } } });
    expect(mcp.withoutServer({ theme: 'dark' }, 'a')).toEqual({
      theme: 'dark',
      mcp: { servers: {} },
    });
    expect(mcp.getServers({ mcp: 'oops' })).toEqual({});
  });
});
