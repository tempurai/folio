import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessAdapter, RawMemoryItem } from '../src/adapters/types.js';
import type { SyncState } from '../src/model.js';
import { resolvePaths } from '../src/paths.js';
import type { TememoryPaths } from '../src/paths.js';
import { MemoryStore } from '../src/store.js';
import { runSync } from '../src/sync.js';
import type { SyncEvent } from '../src/sync.js';

interface FakeAdapter {
  adapter: HarnessAdapter;
  state: { items: RawMemoryItem[]; detected: boolean; failOnCollect: boolean };
}

function fakeAdapter(id: string, items: RawMemoryItem[] = []): FakeAdapter {
  const state = { items, detected: true, failOnCollect: false };
  return {
    state,
    adapter: {
      id,
      name: `fake-${id}`,
      detect: () => Promise.resolve(state.detected),
      collect: () => {
        if (state.failOnCollect) return Promise.reject(new Error('collect 爆炸'));
        return Promise.resolve(state.items);
      },
    },
  };
}

function makeItem(
  sourcePath: string,
  content: string,
  extra?: Partial<RawMemoryItem>,
): RawMemoryItem {
  return {
    harnessId: 'fake',
    sourcePath,
    scope: 'global',
    content,
    mtime: '2026-09-29T08:00:00.000Z',
    ...extra,
  };
}

function readState(paths: TememoryPaths): SyncState {
  return JSON.parse(readFileSync(paths.stateFile, 'utf8')) as SyncState;
}

describe('runSync', () => {
  let home: string;
  let paths: TememoryPaths;
  let store: MemoryStore;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'tememory-sync-'));
    paths = resolvePaths(home);
    store = new MemoryStore(paths);
    store.init();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('首次同步全部 added，二次同步全部 skipped（幂等），并重建索引与搜索缓存', async () => {
    const { adapter } = fakeAdapter('fake-a', [
      makeItem('/a/1.md', '# 记忆一\n内容一'),
      makeItem('/a/2.md', '# 记忆二\n内容二'),
    ]);
    const events: SyncEvent[] = [];

    const first = await runSync({ home, adapters: [adapter], onEvent: (e) => events.push(e) });
    expect(first.adapters).toHaveLength(1);
    expect(first.adapters[0]).toMatchObject({
      id: 'fake-a',
      detected: true,
      added: 2,
      updated: 0,
      skipped: 0,
      removed: 0,
      errors: [],
    });
    expect(store.all()).toHaveLength(2);
    // typeHint 缺省为 reference，source 记录 harness 与路径
    const memory = store.all().find((m) => m.title === '记忆一');
    expect(memory?.type).toBe('reference');
    expect(memory?.source.harness).toBe('fake-a');
    expect(memory?.source.path).toBe('/a/1.md');
    // 索引与搜索缓存已重建
    expect(readFileSync(paths.indexFile, 'utf8')).toContain('记忆一');
    expect(existsSync(join(paths.cacheDir, 'search-index.json'))).toBe(true);
    // 状态文件记录了两个源
    expect(Object.keys(readState(paths).sources).sort()).toEqual(['/a/1.md', '/a/2.md']);
    // 事件流包含 adapter 生命周期
    expect(events.map((e) => e.kind)).toContain('adapter-start');
    expect(events.map((e) => e.kind)).toContain('adapter-done');

    const second = await runSync({ home, adapters: [adapter] });
    expect(second.adapters[0]).toMatchObject({ added: 0, updated: 0, skipped: 2, removed: 0 });
    expect(store.all()).toHaveLength(2);
  });

  it('源内容变化 → updated，state hash 与库内正文同步更新', async () => {
    const fake = fakeAdapter('fake-a', [makeItem('/a/1.md', '原始内容')]);
    await runSync({ home, adapters: [fake.adapter] });
    const before = readState(paths).sources['/a/1.md'];

    fake.state.items = [makeItem('/a/1.md', '修改后的内容')];
    const report = await runSync({ home, adapters: [fake.adapter] });
    expect(report.adapters[0]).toMatchObject({ added: 0, updated: 1, skipped: 0 });

    const after = readState(paths).sources['/a/1.md'];
    expect(after.memoryId).toBe(before.memoryId);
    expect(after.hash).not.toBe(before.hash);
    expect(store.get(before.memoryId)?.content).toBe('修改后的内容\n');
  });

  it('源删除 → removed，记忆文件保留不动', async () => {
    const fake = fakeAdapter('fake-a', [
      makeItem('/a/1.md', '保留的'),
      makeItem('/a/2.md', '将被删除源'),
    ]);
    await runSync({ home, adapters: [fake.adapter] });
    const removedMemoryId = readState(paths).sources['/a/2.md'].memoryId;

    fake.state.items = [makeItem('/a/1.md', '保留的')];
    const report = await runSync({ home, adapters: [fake.adapter] });
    expect(report.adapters[0]).toMatchObject({ skipped: 1, removed: 1 });

    expect(Object.keys(readState(paths).sources)).toEqual(['/a/1.md']);
    expect(store.get(removedMemoryId)).not.toBeNull();
    expect(store.all()).toHaveLength(2);
  });

  it('同内容不同源去重：第二条只在 state 建链接，不新建记忆', async () => {
    const { adapter } = fakeAdapter('fake-a', [
      makeItem('/a/1.md', '完全一样的内容'),
      makeItem('/a/2.md', '完全一样的内容'),
    ]);
    const report = await runSync({ home, adapters: [adapter] });
    expect(report.adapters[0]).toMatchObject({ added: 1, skipped: 1 });
    expect(store.all()).toHaveLength(1);

    const state = readState(paths);
    expect(Object.keys(state.sources).sort()).toEqual(['/a/1.md', '/a/2.md']);
    expect(state.sources['/a/2.md'].memoryId).toBe(state.sources['/a/1.md'].memoryId);
  });

  it('state 文件损坏时从空状态重新开始并记 error，已有记忆通过去重链接保留', async () => {
    const { adapter } = fakeAdapter('fake-a', [
      makeItem('/a/1.md', '记忆一'),
      makeItem('/a/2.md', '记忆二'),
    ]);
    await runSync({ home, adapters: [adapter] });
    const before = readState(paths);

    writeFileSync(paths.stateFile, 'not-json{{{', 'utf8');
    const report = await runSync({ home, adapters: [adapter] });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('损坏');
    // 全部走 findByHash 去重链接：不新建、不报错中断
    expect(report.adapters[0]).toMatchObject({ added: 0, skipped: 2, errors: [] });
    expect(store.all()).toHaveLength(2);
    // state 重建后仍指向原记忆
    const after = readState(paths);
    expect(after.sources['/a/1.md'].memoryId).toBe(before.sources['/a/1.md'].memoryId);
    expect(after.sources['/a/2.md'].memoryId).toBe(before.sources['/a/2.md'].memoryId);
  });

  it('单个 adapter 抛错不中断其他 adapter', async () => {
    const bad = fakeAdapter('fake-bad');
    bad.state.failOnCollect = true;
    const good = fakeAdapter('fake-good', [makeItem('/g/1.md', '好适配器的记忆')]);

    const report = await runSync({ home, adapters: [bad.adapter, good.adapter] });
    expect(report.adapters).toHaveLength(2);
    const badReport = report.adapters.find((a) => a.id === 'fake-bad');
    const goodReport = report.adapters.find((a) => a.id === 'fake-good');
    expect(badReport?.errors).toHaveLength(1);
    expect(badReport?.added).toBe(0);
    expect(goodReport).toMatchObject({ added: 1, errors: [] });
    expect(store.all()).toHaveLength(1);
    // 失败的 adapter 不做删除检测，state 里只有 good 的源
    expect(Object.keys(readState(paths).sources)).toEqual(['/g/1.md']);
  });

  it('detect 返回 false 时报告 detected:false 且不处理任何条目', async () => {
    const fake = fakeAdapter('fake-a', [makeItem('/a/1.md', '不会被收集')]);
    fake.state.detected = false;
    const report = await runSync({ home, adapters: [fake.adapter] });
    expect(report.adapters[0]).toMatchObject({
      detected: false,
      added: 0,
      updated: 0,
      skipped: 0,
      removed: 0,
    });
    expect(store.all()).toHaveLength(0);
  });

  it('adapterIds 只运行指定 adapter；config 里 enabled=false 的 adapter 被过滤', async () => {
    const a = fakeAdapter('fake-a', [makeItem('/a/1.md', '甲')]);
    const b = fakeAdapter('fake-b', [makeItem('/b/1.md', '乙')]);

    const only = await runSync({ home, adapters: [a.adapter, b.adapter], adapterIds: ['fake-a'] });
    expect(only.adapters.map((r) => r.id)).toEqual(['fake-a']);

    writeFileSync(paths.configFile, '[adapters.fake-b]\nenabled = false\n', 'utf8');
    const filtered = await runSync({ home, adapters: [a.adapter, b.adapter] });
    expect(filtered.adapters.map((r) => r.id)).toEqual(['fake-a']);
  });

  it('classify=true 且 LLM 可用时，用 LLM 重判新记忆的 type/tags/title', async () => {
    const requests: Array<{ authorization?: string; body: string }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        requests.push({ authorization: req.headers.authorization, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"type":"project","tags":["同步","测试"],"title":"LLM 判定的标题"}',
                },
              },
            ],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      // baseURL 带尾部 /，验证容错；env 变量提供 apiKey
      vi.stubEnv('TEMEMORY_LLM_API_KEY', 'test-key');
      vi.stubEnv('TEMEMORY_LLM_BASE_URL', `http://127.0.0.1:${port}/v1/`);

      const { adapter } = fakeAdapter('fake-a', [makeItem('/a/1.md', '一条待分类的记忆')]);
      const report = await runSync({ home, adapters: [adapter], classify: true });
      expect(report.adapters[0]).toMatchObject({ added: 1, errors: [] });

      const memory = store.all()[0];
      expect(memory.type).toBe('project');
      expect(memory.tags).toEqual(['同步', '测试']);
      expect(memory.title).toBe('LLM 判定的标题');
      expect(requests).toHaveLength(1);
      expect(requests[0].authorization).toBe('Bearer test-key');
      expect(JSON.parse(requests[0].body).model).toBe('gpt-4o-mini');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
