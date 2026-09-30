import { describe, expect, it } from 'vitest';
import {
  contentHash,
  newId,
  normalizeContent,
  parseMemoryFile,
  serializeMemoryFile,
  slugify,
} from '../src/model.js';
import type { Memory } from '../src/model.js';

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  const content = normalizeContent('# 第一条记忆\r\n\r\n用户偏好简洁的回复。  \n');
  return {
    id: newId(),
    type: 'user',
    scope: 'global',
    title: '用户偏好：简洁回复',
    tags: ['偏好', '回复风格'],
    source: {
      harness: 'manual',
      path: '/tmp/notes.md',
      importedAt: '2026-09-29T08:00:00.000Z',
    },
    hash: contentHash(content),
    created: '2026-09-29T08:00:00.000Z',
    updated: '2026-09-29T09:30:00.000Z',
    content,
    ...overrides,
  };
}

describe('model', () => {
  it('serialize → parse 往返后完全一致', () => {
    const memory = makeMemory({ supersedes: ['m_old00001'], conflictsWith: ['m_conflict9'] });
    expect(parseMemoryFile(serializeMemoryFile(memory))).toEqual(memory);
  });

  it('往返：可选字段缺省也保持一致', () => {
    const memory = makeMemory();
    delete memory.source.path;
    expect(parseMemoryFile(serializeMemoryFile(memory))).toEqual(memory);
  });

  it('中文标题产生非空且合法的 slug', () => {
    const slug = slugify('如何在 Claude Code 中配置 MCP 服务器？');
    expect(slug.length).toBeGreaterThan(0);
    expect(slug).toMatch(/^[\p{Script=Han}a-z0-9-]+$/u);
    expect(slug.startsWith('-')).toBe(false);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug).not.toMatch(/--/);
    expect(slug).toContain('如何在');
    expect(slug).toContain('claude-code');
  });

  it('slug 截断到 48 字符', () => {
    const longTitle = '这是一个非常长的标题'.repeat(20);
    expect([...slugify(longTitle)].length).toBeLessThanOrEqual(48);
  });

  it('normalizeContent 统一换行、去行尾空白、末尾恰好一个换行', () => {
    expect(normalizeContent('甲\r\n乙  \r\n\r\n\r\n')).toBe('甲\n乙\n');
    expect(normalizeContent('')).toBe('\n');
  });

  it('规范化后 hash 稳定', () => {
    const a = normalizeContent('标题\r\n内容  \n\n');
    const b = normalizeContent('标题\n内容\n');
    expect(a).toBe(b);
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('newId 格式固定且互不重复', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^m_[0-9a-z]{8}[0-9a-z]{6}$/);
  });
});
