import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, LlmClient } from '../src/llm.js';
import type { MemorySource } from '../src/model.js';
import { applyOrganize, planOrganize } from '../src/organize.js';
import type { OrganizePlan } from '../src/organize.js';
import { resolvePaths } from '../src/paths.js';
import type { TememoryPaths } from '../src/paths.js';
import { MemoryStore } from '../src/store.js';

function source(path: string): MemorySource {
  return { harness: 'test', path, importedAt: '2026-09-29T08:00:00.000Z' };
}

function mockLlm(responses: string[]): LlmClient & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  let i = 0;
  return {
    calls,
    chat: (messages) => {
      calls.push(messages);
      const response = responses[Math.min(i, responses.length - 1)];
      i++;
      return Promise.resolve(response);
    },
    ping: () => Promise.resolve(true),
  };
}

function planOf(...ops: OrganizePlan['ops']): OrganizePlan {
  return { generatedAt: new Date().toISOString(), ops, llmUsed: false, notes: [] };
}

describe('planOrganize', () => {
  let paths: TememoryPaths;
  let store: MemoryStore;

  beforeEach(() => {
    paths = resolvePaths(mkdtempSync(join(tmpdir(), 'tememory-organize-')));
    store = new MemoryStore(paths);
    store.init();
  });

  it('解析 LLM 返回的 JSON（容忍代码块包裹），非法 op 丢弃并记 notes', async () => {
    const a = store.create({ content: '记忆甲', type: 'user', scope: 'global', source: source('/a.md') }).memory;
    const b = store.create({ content: '记忆乙', type: 'user', scope: 'global', source: source('/b.md') }).memory;
    const c = store.create({ content: '记忆丙', type: 'reference', scope: 'global', source: source('/c.md') }).memory;

    const llm = mockLlm([
      '```json\n' +
        JSON.stringify([
          { kind: 'merge', keepId: a.id, absorbIds: [b.id], reason: '内容重复' },
          { kind: 'merge', keepId: 'm_不存在000000', absorbIds: [b.id], reason: '引用不存在的记忆' },
          { kind: 'wat', id: c.id },
          { kind: 'merge', keepId: a.id, absorbIds: [a.id], reason: 'keepId 与 absorbIds 重叠' },
          { kind: 'retag', id: c.id, tags: ['整理'], reason: '补充标签' },
        ]) +
        '\n```',
    ]);

    const plan = await planOrganize(store, llm);
    expect(plan.llmUsed).toBe(true);
    expect(plan.ops).toHaveLength(2);
    expect(plan.ops[0]).toMatchObject({ kind: 'merge', keepId: a.id, absorbIds: [b.id] });
    expect(plan.ops[1]).toMatchObject({ kind: 'retag', id: c.id, tags: ['整理'] });
    expect(plan.notes.length).toBeGreaterThanOrEqual(3);
    expect(llm.calls).toHaveLength(1);
    // prompt 为中文且包含压缩条目
    expect(llm.calls[0][0].content).toContain('整理');
    const payload = JSON.parse(llm.calls[0][1].content) as Array<{ id: string; content: string }>;
    expect(payload.map((m) => m.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it('按 batchSize 分批调用 LLM；整批失败只记 notes 不中断', async () => {
    store.create({ content: '记忆一', type: 'user', scope: 'global', source: source('/1.md') });
    store.create({ content: '记忆二', type: 'user', scope: 'global', source: source('/2.md') });
    const llm = mockLlm(['not-json-at-all', '[]']);

    const plan = await planOrganize(store, llm, { batchSize: 1 });
    expect(llm.calls).toHaveLength(2);
    expect(plan.ops).toEqual([]);
    expect(plan.notes.some((n) => n.includes('不是合法 JSON'))).toBe(true);
  });

  it('llm=null 时纯本地查重：同 hash 跨 scope 与同名标题各生成 merge 建议', async () => {
    const x1 = store.create({ content: '跨 scope 重复内容', type: 'reference', scope: 'global', source: source('/x1.md') }).memory;
    const x2 = store.create({ content: '跨 scope 重复内容', type: 'reference', scope: 'project:p', source: source('/x2.md') }).memory;
    const t1 = store.create({ content: '内容一', title: '同名标题', type: 'user', scope: 'global', source: source('/t1.md') }).memory;
    const t2 = store.create({ content: '内容二', title: '同名标题', type: 'user', scope: 'global', source: source('/t2.md') }).memory;

    const plan = await planOrganize(store, null);
    expect(plan.llmUsed).toBe(false);
    const merges = plan.ops.filter((op) => op.kind === 'merge');
    expect(merges).toHaveLength(2);
    const groups = merges.map((op) =>
      op.kind === 'merge' ? [op.keepId, ...op.absorbIds].sort() : [],
    );
    expect(groups).toContainEqual([x1.id, x2.id].sort());
    expect(groups).toContainEqual([t1.id, t2.id].sort());
  });
});

describe('applyOrganize', () => {
  let paths: TememoryPaths;
  let store: MemoryStore;

  beforeEach(() => {
    paths = resolvePaths(mkdtempSync(join(tmpdir(), 'tememory-apply-')));
    store = new MemoryStore(paths);
    store.init();
  });

  it('merge：正文追加来源分隔、被合并者归档、keeper 记录 supersedes', async () => {
    const keeper = store.create({ content: '# 保留\n主体内容', type: 'user', scope: 'global', source: source('/keep.md') }).memory;
    const absorbed = store.create({ content: '被合并的补充内容', type: 'user', scope: 'global', source: source('/absorb.md') }).memory;

    const report = await applyOrganize(
      store,
      planOf({ kind: 'merge', keepId: keeper.id, absorbIds: [absorbed.id], reason: '重复' }),
    );
    expect(report).toMatchObject({ merged: 1, errors: [] });

    const after = store.get(keeper.id);
    expect(after?.content).toContain('主体内容');
    expect(after?.content).toContain('---\n来源: /absorb.md');
    expect(after?.content).toContain('被合并的补充内容');
    expect(after?.supersedes).toContain(absorbed.id);

    expect(store.get(absorbed.id)?.archived).toBe(true);
    expect(store.all().map((m) => m.id)).toEqual([keeper.id]);
  });

  it('conflict：双方 frontmatter 互加 conflictsWith，不合并不删改内容', async () => {
    const m1 = store.create({ content: '项目用 React', type: 'project', scope: 'global', source: source('/m1.md') }).memory;
    const m2 = store.create({ content: '项目用 Vue', type: 'project', scope: 'global', source: source('/m2.md') }).memory;

    const report = await applyOrganize(
      store,
      planOf({ kind: 'conflict', ids: [m1.id, m2.id], reason: '技术栈描述矛盾' }),
    );
    expect(report).toMatchObject({ conflictsMarked: 1, errors: [] });

    const after1 = store.get(m1.id);
    const after2 = store.get(m2.id);
    expect(after1?.conflictsWith).toContain(m2.id);
    expect(after2?.conflictsWith).toContain(m1.id);
    expect(after1?.content).toBe(m1.content);
    expect(after2?.content).toBe(m2.content);
    expect(after1?.archived).toBeUndefined();
    expect(after2?.archived).toBeUndefined();
  });

  it('retype/retag 通过 store.update 生效；未知 id 记入 errors 且不中断后续 op', async () => {
    const m = store.create({ content: '待整理', type: 'reference', scope: 'global', source: source('/m.md') }).memory;

    const report = await applyOrganize(
      store,
      planOf(
        { kind: 'retype', id: 'm_不存在000000', type: 'project', reason: '不存在的目标' },
        { kind: 'retype', id: m.id, type: 'project', reason: '应归为项目' },
        { kind: 'retag', id: m.id, tags: ['新标签'], reason: '补充标签' },
      ),
    );
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('m_不存在000000');
    expect(report.retyped).toBe(1);
    expect(report.retagged).toBe(1);

    const after = store.get(m.id);
    expect(after?.type).toBe('project');
    expect(after?.tags).toEqual(['新标签']);
  });

  it('merge 找不到 keeper 时记 error，其余 op 照常执行', async () => {
    const m = store.create({ content: '正常记忆', type: 'user', scope: 'global', source: source('/m.md') }).memory;

    const report = await applyOrganize(
      store,
      planOf(
        { kind: 'merge', keepId: 'm_不存在000000', absorbIds: [m.id], reason: 'keeper 丢失' },
        { kind: 'retag', id: m.id, tags: ['保留'], reason: '正常执行' },
      ),
    );
    expect(report.errors).toHaveLength(1);
    expect(report.merged).toBe(0);
    expect(report.retagged).toBe(1);
    expect(store.get(m.id)?.archived).toBeUndefined();
  });
});
