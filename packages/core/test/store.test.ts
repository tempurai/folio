import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemorySource } from '../src/model.js';
import { resolvePaths } from '../src/paths.js';
import type { FolioPaths } from '../src/paths.js';
import { MemoryStore } from '../src/store.js';

const source: MemorySource = {
  harness: 'claude-code',
  path: '/tmp/CLAUDE.md',
  importedAt: '2026-09-29T08:00:00.000Z',
};

describe('MemoryStore', () => {
  let paths: FolioPaths;
  let store: MemoryStore;

  beforeEach(() => {
    paths = resolvePaths(mkdtempSync(join(tmpdir(), 'folio-store-')));
    store = new MemoryStore(paths);
    store.init();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('init 创建 memory/ 与四个 type 子目录', () => {
    for (const type of ['user', 'feedback', 'project', 'reference']) {
      expect(existsSync(join(paths.memoryDir, type))).toBe(true);
    }
  });

  it('create 写入记忆文件并可 get 读回；标题缺省取首个标题行', () => {
    const { memory, created } = store.create({
      content: '# 用户偏好\n用户喜欢简洁的回复。',
      type: 'user',
      scope: 'global',
      tags: ['偏好'],
      source,
    });
    expect(created).toBe(true);
    expect(memory.title).toBe('用户偏好');
    expect(memory.content).toBe('# 用户偏好\n用户喜欢简洁的回复。\n');

    const files = readdirSync(join(paths.memoryDir, 'user'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^用户偏好-[0-9a-z]{8}\.md$/);

    const loaded = store.get(memory.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.content).toBe(memory.content);
    expect(loaded?.hash).toBe(memory.hash);
    expect(loaded?.tags).toEqual(['偏好']);
    expect(store.get('m_不存在的id00')).toBeNull();
  });

  it('标题缺省时回退到正文前 20 字', () => {
    const { memory } = store.create({
      content: '没有标题行的一段正文，用来验证标题回退逻辑是否工作正常',
      type: 'reference',
      scope: 'global',
      source,
    });
    expect(memory.title).toBe('没有标题行的一段正文，用来验证标题回退逻');
  });

  it('同 hash + scope 去重并返回 created:false；不同 scope 不去重', () => {
    const first = store.create({ content: '重复的内容', type: 'project', scope: 'project:folio', source });
    const second = store.create({ content: '重复的内容\r\n', type: 'project', scope: 'project:folio', source });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.memory.id).toBe(first.memory.id);

    const third = store.create({ content: '重复的内容', type: 'project', scope: 'global', source });
    expect(third.created).toBe(true);
    expect(third.memory.id).not.toBe(first.memory.id);
    expect(readdirSync(join(paths.memoryDir, 'project'))).toHaveLength(2);
  });

  it('list 默认不含 archived，按 updated 倒序，支持 type/scope 过滤', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-29T08:00:00.000Z');
    const older = store.create({ content: '较早的记忆', type: 'user', scope: 'global', source }).memory;
    vi.setSystemTime('2026-09-29T09:00:00.000Z');
    const newer = store.create({ content: '较新的记忆', type: 'feedback', scope: 'project:x', source }).memory;

    expect(store.list().map((m) => m.id)).toEqual([newer.id, older.id]);
    expect(store.list({ type: 'user' }).map((m) => m.id)).toEqual([older.id]);
    expect(store.list({ scope: 'project:x' }).map((m) => m.id)).toEqual([newer.id]);
    // list 不携带正文
    expect('content' in store.list()[0]).toBe(false);
  });

  it('update 更新内容与 hash；type 变化移动文件且文件名保持稳定', () => {
    const { memory } = store.create({
      content: '# 旧标题\n旧内容',
      type: 'user',
      scope: 'global',
      source,
    });
    const fileBefore = readdirSync(join(paths.memoryDir, 'user'))[0];

    const updated = store.update(memory.id, {
      content: '新内容',
      type: 'reference',
      title: '新标题',
      tags: ['改后'],
      supersedes: ['m_旧的记忆00'],
    });
    expect(updated).not.toBeNull();
    expect(updated?.title).toBe('新标题');
    expect(updated?.hash).not.toBe(memory.hash);
    expect(updated!.updated >= memory.updated).toBe(true);
    expect(updated?.supersedes).toEqual(['m_旧的记忆00']);

    expect(existsSync(join(paths.memoryDir, 'user', fileBefore))).toBe(false);
    expect(readdirSync(join(paths.memoryDir, 'reference'))).toEqual([fileBefore]);
    expect(store.get(memory.id)?.content).toBe('新内容\n');
    expect(store.update('m_不存在的id00', { title: 'x' })).toBeNull();
  });

  it('archive 移入 archive/<type>/ 且 frontmatter 标记 archived: true', () => {
    const { memory } = store.create({ content: '要归档的记忆', type: 'feedback', scope: 'global', source });
    expect(store.archive(memory.id)).toBe(true);
    expect(store.archive(memory.id)).toBe(false);

    expect(store.list().some((m) => m.id === memory.id)).toBe(false);
    const archivedList = store.list({ archived: true });
    expect(archivedList).toHaveLength(1);
    expect(archivedList[0].id).toBe(memory.id);
    expect(archivedList[0].archived).toBe(true);

    const files = readdirSync(join(paths.archiveDir, 'feedback'));
    expect(files).toHaveLength(1);
    const text = readFileSync(join(paths.archiveDir, 'feedback', files[0]), 'utf8');
    expect(text).toContain('archived: true');
    // get 仍能读到归档记忆
    expect(store.get(memory.id)?.archived).toBe(true);
  });

  it('findByHash 按 hash + scope 命中', () => {
    const { memory } = store.create({ content: '哈希查找', type: 'user', scope: 'project:x', source });
    expect(store.findByHash(memory.hash, 'project:x')?.id).toBe(memory.id);
    expect(store.findByHash(memory.hash, 'global')).toBeNull();
    expect(store.findByHash('0'.repeat(64), 'project:x')).toBeNull();
  });

  it('all 返回含正文的活跃记忆', () => {
    const { memory } = store.create({ content: '正文在这里', type: 'user', scope: 'global', source });
    const all = store.all();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(memory.id);
    expect(all[0].content).toBe('正文在这里\n');
    store.archive(memory.id);
    expect(store.all()).toHaveLength(0);
  });

  it('rebuildIndex 生成 MEMORY.md：含自动生成标注、按 type 分节、不含 archived', () => {
    store.create({
      content: '# 活跃记忆',
      title: '活跃记忆',
      type: 'user',
      scope: 'global',
      tags: ['标签甲'],
      source,
    });
    const gone = store.create({
      content: '已归档',
      title: '归档记忆',
      type: 'project',
      scope: 'project:folio',
      source,
    }).memory;
    store.archive(gone.id);

    store.rebuildIndex();
    const md = readFileSync(paths.indexFile, 'utf8');
    expect(md).toContain('自动生成');
    expect(md).toContain('## user');
    expect(md).toContain('## feedback');
    expect(md).toContain('## project');
    expect(md).toContain('## reference');
    expect(md).toMatch(/- \[活跃记忆\]\(user\/.+\.md\) · global · #标签甲/);
    expect(md).not.toContain('归档记忆');
  });
});
