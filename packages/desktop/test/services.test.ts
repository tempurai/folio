import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServices } from '../src/main/services.js';
import type { DesktopServices, SecretCipher } from '../src/main/services.js';

// services 设计为不依赖 electron（加解密经注入的 SecretCipher），
// 这里仍 mock 掉 electron，防止未来误引后测试进程去加载真实的 electron 包
vi.mock('electron', () => ({}));

const FIXTURE_SRC = fileURLToPath(new URL('../../core/test/fixtures/adapters', import.meta.url));

const ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'KIMI_CODE_HOME',
  'TEMEMORY_CURSOR_HOME',
  'TEMEMORY_ZCODE_HOME',
  'HOME',
] as const;

// 可逆假加密：密文绝不是明文本身，足以验证「不明文落盘/回传」
const cipher: SecretCipher = {
  encrypt: (plain) => Buffer.from(`v1:${plain}`, 'utf8').toString('base64'),
  decrypt: (encoded) => {
    const s = Buffer.from(encoded, 'base64').toString('utf8');
    if (!s.startsWith('v1:')) throw new Error('密文格式错误');
    return s.slice(3);
  },
};

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let fixtures: string;
let fakeHome: string;
let home: string;
let tempDirs: string[];
let services: DesktopServices;

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  // fixtures 会被 install/uninstall 写入，复制到临时目录再指向它；
  // HOME 指向临时目录，避免 claude-code 的 ~/.claude.json 落到真实用户目录
  fixtures = mkdtempSync(join(tmpdir(), 'tememory-desktop-fixtures-'));
  cpSync(FIXTURE_SRC, fixtures, { recursive: true });
  fakeHome = mkdtempSync(join(tmpdir(), 'tememory-desktop-fakehome-'));
  home = mkdtempSync(join(tmpdir(), 'tememory-desktop-home-'));
  tempDirs = [fixtures, fakeHome, home];
  process.env.CLAUDE_CONFIG_DIR = join(fixtures, 'claude-code');
  process.env.CODEX_HOME = join(fixtures, 'codex');
  process.env.KIMI_CODE_HOME = join(fixtures, 'kimi-code');
  process.env.TEMEMORY_CURSOR_HOME = join(fixtures, 'cursor');
  process.env.TEMEMORY_ZCODE_HOME = join(fixtures, 'zcode');
  process.env.HOME = fakeHome;
  services = createServices({ home, cipher });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('tree:list 形状', () => {
  it('空库返回四个空文件夹与计数', () => {
    const tree = services.listTree();
    expect(tree.folders.map((f) => f.folder)).toEqual(['user', 'feedback', 'project', 'reference']);
    expect(tree.counts.total).toBe(0);
    for (const f of tree.folders) {
      expect(f.files).toEqual([]);
      expect(tree.counts.byFolder[f.folder]).toBe(0);
    }
  });

  it('同步 fixtures 后产出 gui 形状的文件条目', async () => {
    const report = await services.runSync();
    expect(report.adapters).toHaveLength(5);
    const added = report.adapters.reduce((n, a) => n + a.added, 0);
    expect(added).toBeGreaterThan(0);

    const tree = services.listTree();
    expect(tree.counts.total).toBe(added);
    const all = tree.folders.flatMap((f) => f.files);
    expect(all.length).toBeGreaterThan(0);
    for (const file of all) {
      expect(file.file).toMatch(/^[\p{Letter}\p{Number}._-]+\.md$/u);
      expect(file.updated).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
      expect(file.src.length).toBeGreaterThan(0);
      expect(file.scope.length).toBeGreaterThan(0);
      expect(Array.isArray(file.tags)).toBe(true);
    }
    // 索引文件随之生成
    expect(services.readIndex()).toContain('# tememory 记忆索引');
  });
});

describe('file 读写闭环', () => {
  it('create → read → write → archive，全程维护索引', () => {
    const created = services.createFile('user', '测试标题', '# 正文\n第一行。');
    expect(created.file).toMatch(/^测试标题-[0-9a-z]{8}\.md$/);
    expect(created.src).toBe('desktop');
    const rel = `user/${created.file}`;

    const read = services.readFile(rel);
    expect(read.meta.title).toBe('测试标题');
    expect(read.body).toContain('第一行。');

    const updated = services.writeFile(rel, '# 正文\n改过了。');
    expect(updated.title).toBe('测试标题');
    expect(services.readFile(rel).body).toContain('改过了。');
    expect(services.readIndex()).toContain('测试标题');

    services.archiveFile(rel);
    expect(services.listTree().counts.total).toBe(0);
    expect(() => services.readFile(rel)).toThrow('文件不存在');
    // 归档文件仍在 archive/ 下
    expect(existsSync(join(home, 'archive', 'user', created.file))).toBe(true);
  });

  it('拒绝非法与越界路径', () => {
    expect(() => services.readFile('../../etc/passwd.md')).toThrow('非法的记忆文件路径');
    expect(() => services.readFile('user/../secret.md')).toThrow('非法的记忆文件路径');
    expect(() => services.readFile('user/不存在.md')).toThrow('文件不存在');
    expect(() => services.absPathFor('memory/user/x.md')).toThrow('非法的记忆文件路径');
  });

  it('readIndex 在索引缺失时自动重建', () => {
    services.createFile('project', '索引用例', '内容。');
    rmSync(join(home, 'memory', 'MEMORY.md'));
    expect(services.readIndex()).toContain('索引用例');
  });
});

describe('sources 状态与 MCP 注册', () => {
  it('listSources 反映检测/导入数/注册状态，install/uninstall 往返', async () => {
    await services.runSync();
    const before = await services.listSources();
    expect(before).toHaveLength(5);
    for (const s of before) {
      expect(s.detected).toBe(true);
      expect(typeof s.importedCount).toBe('number');
      expect(typeof s.mcpRegistered).toBe('boolean');
    }
    expect(before.some((s) => s.importedCount > 0)).toBe(true);

    const kimiBefore = before.find((s) => s.id === 'kimi-code');
    expect(kimiBefore?.mcpRegistered).toBe(false);
    expect(kimiBefore?.configPath).toBe(join(fixtures, 'kimi-code', 'mcp.json'));

    const targets = await services.installMcp('kimi-code');
    expect(targets).toHaveLength(1);
    expect(targets[0].adapterId).toBe('kimi-code');
    expect(targets[0].changed).toBe(true);
    const after = await services.listSources();
    expect(after.find((s) => s.id === 'kimi-code')?.mcpRegistered).toBe(true);

    const removed = await services.uninstallMcp('kimi-code');
    expect(removed[0].changed).toBe(true);
    expect((await services.listSources()).find((s) => s.id === 'kimi-code')?.mcpRegistered).toBe(false);

    await expect(services.installMcp('nope')).rejects.toThrow('未知适配器');
  });
});

describe('settings get/save 与 API Key 保密', () => {
  it('默认值、补丁保存、apiKey 全程不明文', () => {
    const s0 = services.getSettings();
    expect(s0.home).toBe(home);
    expect(s0.llm.hasApiKey).toBe(false);
    expect(s0.llm.apiKeyMasked).toBeNull();
    expect(s0.adapters).toHaveLength(5);
    expect(s0.adapters.every((a) => a.enabled)).toBe(true);

    const s1 = services.saveSettings(
      {
        llm: {
          baseURL: 'http://127.0.0.1:9/v1',
          model: 'test-model',
          classifyOnSync: true,
        },
        adapters: [{ id: 'codex', enabled: false }],
      },
      'sk-test-abcdef123456',
    );
    expect(s1.llm.baseURL).toBe('http://127.0.0.1:9/v1');
    expect(s1.llm.model).toBe('test-model');
    expect(s1.llm.classifyOnSync).toBe(true);
    expect(s1.llm.hasApiKey).toBe(true);
    expect(s1.llm.apiKeyMasked).not.toBeNull();
    expect(s1.adapters.find((a) => a.id === 'codex')?.enabled).toBe(false);
    expect(s1.adapters.find((a) => a.id === 'cursor')?.enabled).toBe(true);
    // 返回值不含明文 Key
    expect(JSON.stringify(s1)).not.toContain('sk-test-abcdef123456');

    // secrets.json 与 config.toml 均不含明文 Key
    const secretsText = readFileSync(join(home, 'state', 'secrets.json'), 'utf8');
    expect(secretsText).not.toContain('sk-test-abcdef123456');
    const configText = readFileSync(join(home, 'config.toml'), 'utf8');
    expect(configText).not.toContain('sk-test-abcdef123456');
    expect(configText).not.toContain('apiKey');
    expect(configText).toContain('test-model');

    // 新实例仍能读到 Key（加密持久化生效）
    const s2 = createServices({ home, cipher }).getSettings();
    expect(s2.llm.hasApiKey).toBe(true);
    expect(JSON.stringify(s2)).not.toContain('sk-test-abcdef123456');

    // 空字符串清除 Key
    const s3 = services.saveSettings({}, '');
    expect(s3.llm.hasApiKey).toBe(false);
    expect(s3.llm.apiKeyMasked).toBeNull();
    expect(existsSync(join(home, 'state', 'secrets.json'))).toBe(false);

    expect(() => services.saveSettings({ adapters: [{ id: 'nope', enabled: true }] })).toThrow(
      '未知适配器',
    );
  });
});

describe('organize plan/apply（无 LLM 走本地查重）', () => {
  it('同名记忆产生 merge 建议，apply 后合并并使计划失效', async () => {
    services.createFile('user', '重复标题', '内容A。');
    services.createFile('project', '重复标题', '内容B。');

    const plan = await services.planOrganize();
    expect(plan.llmUsed).toBe(false);
    expect(plan.ops.length).toBeGreaterThan(0);
    expect(plan.views).toHaveLength(plan.ops.length);
    const mergeView = plan.views.find((v) => v.st === 'M');
    expect(mergeView).toBeDefined();
    expect(mergeView?.files).toMatch(/^(user|project)\/.+\.md$/);

    const report = await services.applyOrganize(plan.views.map((v) => v.index));
    expect(report.merged).toBeGreaterThan(0);
    expect(report.errors).toEqual([]);
    expect(services.listTree().counts.total).toBe(1);

    // 应用后缓存的计划失效
    await expect(services.applyOrganize([0])).rejects.toThrow('请先生成整理计划');
  });

  it('未生成计划时拒绝 apply；序号越界拒绝', async () => {
    await expect(services.applyOrganize([0])).rejects.toThrow('请先生成整理计划');
    services.createFile('user', '重复标题', '内容A。');
    services.createFile('project', '重复标题', '内容B。');
    await services.planOrganize();
    await expect(services.applyOrganize([99])).rejects.toThrow('越界');
  });

  it('没有重复时计划为空', async () => {
    services.createFile('user', '独一无二的标题', '内容。');
    const plan = await services.planOrganize();
    expect(plan.ops).toEqual([]);
    expect(plan.views).toEqual([]);
  });
});

describe('activity 与 watch 状态', () => {
  it('同步写入活动日志并可读取；watch 开关持久化', async () => {
    expect(services.listActivity()).toEqual([]);
    expect(services.getWatchStatus().enabled).toBe(false);
    expect(services.getWatchStatus().lastSyncAt).toBeUndefined();

    await services.runSync();
    await services.runSync();
    const entries = services.listActivity();
    expect(entries).toHaveLength(2);
    expect(entries[0].trigger).toBe('manual');
    expect(entries[0].at >= entries[1].at).toBe(true);
    expect(Array.isArray(entries[0].adapters)).toBe(true);
    const added = entries[1].adapters.reduce((n, a) => n + a.added, 0);
    expect(added).toBeGreaterThan(0);
    // limit 生效
    expect(services.listActivity(1)).toHaveLength(1);

    const status = services.getWatchStatus();
    expect(status.lastSyncAt).toBe(entries[0].at);

    const on = services.setWatchEnabled(true);
    expect(on.enabled).toBe(true);
    // 持久化到 state/desktop.json
    expect(createServices({ home, cipher }).getWatchStatus().enabled).toBe(true);
    expect(services.setWatchEnabled(false).enabled).toBe(false);
  });
});
