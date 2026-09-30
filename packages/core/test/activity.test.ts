import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HarnessAdapter, RawMemoryItem } from '../src/adapters/types.js';
import { resolvePaths } from '../src/paths.js';
import type { FolioPaths } from '../src/paths.js';
import { readActivity, runSync } from '../src/sync.js';
import type { ActivityEntry } from '../src/sync.js';

function fakeAdapter(id: string, items: RawMemoryItem[] = []): HarnessAdapter {
  return {
    id,
    name: `fake-${id}`,
    detect: () => Promise.resolve(true),
    collect: () => Promise.resolve(items),
  };
}

function makeItem(sourcePath: string, content: string): RawMemoryItem {
  return {
    harnessId: 'fake',
    sourcePath,
    scope: 'global',
    content,
    mtime: '2026-09-29T08:00:00.000Z',
  };
}

function makeEntry(at: string, trigger = 'manual'): ActivityEntry {
  return {
    at,
    trigger,
    adapters: [
      { id: 'fake-a', detected: true, added: 1, updated: 0, skipped: 0, removed: 0, errors: [] },
    ],
  };
}

function activityLines(paths: FolioPaths): string[] {
  return readFileSync(join(paths.stateDir, 'activity.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

describe('activity 日志', () => {
  let home: string;
  let paths: FolioPaths;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'folio-activity-'));
    paths = resolvePaths(home);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('runSync 完成后追加一行摘要；readActivity 最新在前，trigger 缺省 manual', async () => {
    const adapter = fakeAdapter('fake-a', [makeItem('/a/1.md', '记忆一')]);
    const report = await runSync({ home, adapters: [adapter] });

    const lines = activityLines(paths);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as ActivityEntry;
    expect(entry.at).toBe(report.finishedAt);
    expect(entry.trigger).toBe('manual');
    expect(entry.adapters).toEqual([
      { id: 'fake-a', detected: true, added: 1, updated: 0, skipped: 0, removed: 0, errors: [] },
    ]);

    await runSync({ home, adapters: [adapter], trigger: 'watch' });
    expect(activityLines(paths)).toHaveLength(2);

    const entries = readActivity(paths);
    expect(entries).toHaveLength(2);
    // 最新在前：第二次（watch）排第一；第一次的全部 skipped
    expect(entries[0].trigger).toBe('watch');
    expect(entries[0].adapters[0]).toMatchObject({ id: 'fake-a', skipped: 1 });
    expect(entries[1].trigger).toBe('manual');
    expect(entries[1].adapters[0]).toMatchObject({ id: 'fake-a', added: 1 });
  });

  it('limit 限制返回条数，缺省 100；文件不存在返回 []', async () => {
    expect(readActivity(resolvePaths(join(home, 'not-created')))).toEqual([]);

    const adapter = fakeAdapter('fake-a');
    for (let i = 0; i < 3; i++) {
      await runSync({ home, adapters: [adapter], trigger: `t${i}` });
    }
    expect(readActivity(paths)).toHaveLength(3);
    const limited = readActivity(paths, { limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited.map((e) => e.trigger)).toEqual(['t2', 't1']);
  });

  it('损坏行与不合 schema 的行被跳过，不影响其他行', async () => {
    const file = join(paths.stateDir, 'activity.jsonl');
    const adapter = fakeAdapter('fake-a');
    await runSync({ home, adapters: [adapter], trigger: 'good-1' });
    appendFileSync(file, 'not-json{{{\n', 'utf8');
    appendFileSync(file, '{"at":"2026-01-01T00:00:00.000Z"}\n', 'utf8');
    appendFileSync(file, `${JSON.stringify(makeEntry('2026-01-02T00:00:00.000Z', 'good-2'))}\n`, 'utf8');

    const entries = readActivity(paths);
    expect(entries.map((e) => e.trigger)).toEqual(['good-2', 'good-1']);
  });

  it('超过 500 行时截断保留最新 500 行', async () => {
    const file = join(paths.stateDir, 'activity.jsonl');
    mkdirSync(paths.stateDir, { recursive: true });
    // 预置 500 行，再 runSync 一次产生第 501 行 → 截断回 500
    for (let i = 0; i < 500; i++) {
      const at = `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`;
      appendFileSync(file, `${JSON.stringify(makeEntry(at, `seed-${i}`))}\n`, 'utf8');
    }

    const adapter = fakeAdapter('fake-a');
    await runSync({ home, adapters: [adapter], trigger: 'newest' });

    const lines = activityLines(paths);
    expect(lines).toHaveLength(500);
    // 最旧的 seed-0 被丢弃，最新一行是本次同步
    expect((JSON.parse(lines[0]) as ActivityEntry).trigger).toBe('seed-1');
    expect((JSON.parse(lines[lines.length - 1]) as ActivityEntry).trigger).toBe('newest');

    // readActivity 默认 100 条，最新在前
    const entries = readActivity(paths);
    expect(entries).toHaveLength(100);
    expect(entries[0].trigger).toBe('newest');
    expect(readActivity(paths, { limit: 500 })).toHaveLength(500);
  });

  it('runSync 报告的 adapters 完整落入日志（含 removed/errors 字段）', async () => {
    const file = join(paths.stateDir, 'activity.jsonl');
    const adapter = fakeAdapter('fake-a', [makeItem('/a/1.md', '将被删除源')]);
    await runSync({ home, adapters: [adapter] });
    // 源消失 → removed=1（collect 返回空）
    const empty = fakeAdapter('fake-a');
    const report = await runSync({ home, adapters: [empty], trigger: 't-removed' });

    const entries = readActivity(paths, { limit: 1 });
    expect(entries[0].at).toBe(report.finishedAt);
    expect(entries[0].adapters[0]).toEqual({
      id: 'fake-a',
      detected: true,
      added: 0,
      updated: 0,
      skipped: 0,
      removed: 1,
      errors: [],
    });
    // 文件里读原始行验证 JSON 结构带 errors 键
    const raw = JSON.parse(
      readFileSync(file, 'utf8').trim().split('\n').pop() as string,
    ) as Record<string, any>;
    expect(Object.keys(raw.adapters[0]).sort()).toEqual([
      'added',
      'detected',
      'errors',
      'id',
      'removed',
      'skipped',
      'updated',
    ]);
  });
});
