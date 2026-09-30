import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Memory } from '../src/model.js';
import { SearchIndex } from '../src/search.js';

// 夹具说明：三条中英文混合的记忆，用来验证中文分词命中与字段权重。
const memories: Memory[] = [
  {
    id: 'm_mcp_title',
    type: 'reference',
    scope: 'global',
    title: 'MCP 服务器配置指南',
    tags: ['mcp'],
    source: { harness: 'manual', importedAt: '2026-09-29T08:00:00.000Z' },
    hash: 'h1',
    created: '2026-09-29T08:00:00.000Z',
    updated: '2026-09-29T08:00:00.000Z',
    content: '本文介绍如何在各个客户端里填写配置文件。\n',
  },
  {
    id: 'm_mcp_body',
    type: 'project',
    scope: 'project:folio',
    title: '客户端排障记录',
    tags: [],
    source: { harness: 'codex', importedAt: '2026-09-29T08:00:00.000Z' },
    hash: 'h2',
    created: '2026-09-29T08:00:00.000Z',
    updated: '2026-09-29T08:00:00.000Z',
    content: '如果 MCP 无法启动，先检查 node 版本，再查看日志输出。\n',
  },
  {
    id: 'm_pnpm',
    type: 'project',
    scope: 'global',
    title: 'monorepo 构建顺序',
    tags: ['pnpm'],
    source: { harness: 'kimi-code', importedAt: '2026-09-29T08:00:00.000Z' },
    hash: 'h3',
    created: '2026-09-29T08:00:00.000Z',
    updated: '2026-09-29T08:00:00.000Z',
    content: 'pnpm 会按拓扑顺序先构建 core，再构建依赖它的 cli。\n',
  },
];

function builtIndex(): SearchIndex {
  const index = new SearchIndex();
  index.build(memories);
  return index;
}

describe('SearchIndex', () => {
  it('中文查询词能命中正确条目，无关条目不出现', () => {
    const hits = builtIndex().search('配置文件');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe('m_mcp_title');
    expect(hits.map((h) => h.id)).not.toContain('m_pnpm');
    expect(hits.map((h) => h.id)).not.toContain('m_mcp_body');
  });

  it('title/tags 命中的权重高于正文命中', () => {
    const hits = builtIndex().search('mcp');
    const scoreOf = new Map(hits.map((h) => [h.id, h.score]));
    // m_mcp_title：title+tags 命中记 3 分；m_mcp_body：仅正文命中记 1 分
    expect(scoreOf.get('m_mcp_title')).toBe(3);
    expect(scoreOf.get('m_mcp_body')).toBe(1);
    expect(hits[0].id).toBe('m_mcp_title');
  });

  it('支持 type / scope / limit 过滤', () => {
    const index = builtIndex();
    expect(index.search('mcp', { type: 'reference' }).map((h) => h.id)).toEqual(['m_mcp_title']);
    expect(index.search('mcp', { scope: 'project:folio' }).map((h) => h.id)).toEqual(['m_mcp_body']);
    expect(index.search('mcp', { limit: 1 })).toHaveLength(1);
  });

  it('save / load 往返后检索结果一致；文件缺失返回 null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-search-'));
    const file = join(dir, 'cache', 'search-index.json');

    const index = builtIndex();
    index.save(file);

    const loaded = SearchIndex.load(file);
    expect(loaded).not.toBeNull();
    expect(loaded?.search('配置文件')[0].id).toBe('m_mcp_title');
    expect(loaded?.search('mcp').map((h) => h.id)).toEqual(
      index.search('mcp').map((h) => h.id),
    );

    expect(SearchIndex.load(join(dir, '不存在的文件.json'))).toBeNull();
  });
});
