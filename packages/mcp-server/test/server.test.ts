import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Memory, MemoryMeta } from '@tememory/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/index.js';

type CallToolResultLike = Awaited<ReturnType<Client['callTool']>>;

interface TestContext {
  client: Client;
  server: McpServer;
  home: string;
}

async function setup(): Promise<TestContext> {
  const home = mkdtempSync(join(tmpdir(), 'tememory-mcp-test-'));
  const server = await createMcpServer({ home });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'tememory-test-client', version: '0.0.1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, home };
}

function resultData(result: CallToolResultLike): unknown {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const item = content?.[0];
  if (!item || item.type !== 'text' || typeof item.text !== 'string') {
    throw new Error('expected text content in tool result');
  }
  return JSON.parse(item.text);
}

describe('tememory mcp-server', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.client.close();
    await ctx.server.close();
    rmSync(ctx.home, { recursive: true, force: true });
  });

  it('registers all five memory tools', async () => {
    const { tools } = await ctx.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'memory_list',
      'memory_read',
      'memory_search',
      'memory_update',
      'memory_write',
    ]);
  });

  it('memory_write -> memory_read round-trips with defaults applied', async () => {
    const writeResult = await ctx.client.callTool({
      name: 'memory_write',
      arguments: {
        content: '# 用户偏好\n\n用户偏好使用中文交流，回复要简洁。',
        title: '用户偏好：中文简洁回复',
        tags: ['偏好', '语言'],
      },
    });
    expect(writeResult.isError).toBeUndefined();
    const written = resultData(writeResult) as { id: string; created: boolean };
    expect(written.id).toMatch(/^m_/);
    expect(written.created).toBe(true);

    const readResult = await ctx.client.callTool({
      name: 'memory_read',
      arguments: { id: written.id },
    });
    expect(readResult.isError).toBeUndefined();
    const memory = resultData(readResult) as Memory;
    expect(memory.id).toBe(written.id);
    expect(memory.content).toContain('用户偏好使用中文交流');
    expect(memory.title).toBe('用户偏好：中文简洁回复');
    expect(memory.type).toBe('reference');
    expect(memory.scope).toBe('global');
    expect(memory.tags).toEqual(['偏好', '语言']);
    expect(memory.source.harness).toBe('mcp');
    expect(typeof memory.source.importedAt).toBe('string');
  });

  it('memory_list returns written metas without content and honors limit', async () => {
    await ctx.client.callTool({
      name: 'memory_write',
      arguments: { content: '第一条记忆：喜欢简洁回复。', title: '第一条' },
    });
    await ctx.client.callTool({
      name: 'memory_write',
      arguments: { content: '第二条记忆：构建命令是 pnpm build。', title: '第二条' },
    });

    const listResult = await ctx.client.callTool({ name: 'memory_list', arguments: {} });
    expect(listResult.isError).toBeUndefined();
    const metas = resultData(listResult) as MemoryMeta[];
    expect(metas).toHaveLength(2);
    expect(metas.map((meta) => meta.title).sort()).toEqual(['第一条', '第二条']);
    expect('content' in metas[0]).toBe(false);

    const pagedResult = await ctx.client.callTool({
      name: 'memory_list',
      arguments: { limit: 1, offset: 1 },
    });
    const paged = resultData(pagedResult) as MemoryMeta[];
    expect(paged).toHaveLength(1);
  });

  it('memory_search finds Chinese content with snippet', async () => {
    const writeResult = await ctx.client.callTool({
      name: 'memory_write',
      arguments: {
        content: '# 构建说明\n\n这个仓库使用 pnpm workspace 管理，构建命令是 pnpm build。',
        title: '构建说明',
      },
    });
    const { id } = resultData(writeResult) as { id: string };

    const searchResult = await ctx.client.callTool({
      name: 'memory_search',
      arguments: { query: '构建' },
    });
    expect(searchResult.isError).toBeUndefined();
    const hits = resultData(searchResult) as Array<{
      id: string;
      type: string;
      scope: string;
      title: string;
      tags: string[];
      score: number;
      snippet: string;
    }>;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe(id);
    expect(hits[0].title).toBe('构建说明');
    expect(hits[0].snippet).toContain('构建');
    expect([...hits[0].snippet].length).toBeLessThanOrEqual(200);

    const missResult = await ctx.client.callTool({
      name: 'memory_search',
      arguments: { query: '不存在的词语xyz' },
    });
    expect(resultData(missResult)).toEqual([]);
  });

  it('memory_read on a missing id returns an error result instead of throwing', async () => {
    const result = await ctx.client.callTool({
      name: 'memory_read',
      arguments: { id: 'm_doesnotexist' },
    });
    expect(result.isError).toBe(true);
    const payload = resultData(result) as { error: string; id: string };
    expect(payload.error).toBe('memory_not_found');
    expect(payload.id).toBe('m_doesnotexist');
  });

  it('memory_update patches a memory and refresh search; missing id errors', async () => {
    const writeResult = await ctx.client.callTool({
      name: 'memory_write',
      arguments: { content: '原始内容：项目代号 alpha。', title: '项目代号' },
    });
    const { id } = resultData(writeResult) as { id: string };

    const updateResult = await ctx.client.callTool({
      name: 'memory_update',
      arguments: { id, content: '更新后的内容：项目代号 omega。', tags: ['项目'] },
    });
    expect(updateResult.isError).toBeUndefined();
    const updated = resultData(updateResult) as Memory;
    expect(updated.content).toContain('omega');
    expect(updated.tags).toEqual(['项目']);

    const searchResult = await ctx.client.callTool({
      name: 'memory_search',
      arguments: { query: 'omega' },
    });
    const hits = resultData(searchResult) as Array<{ id: string }>;
    expect(hits.map((hit) => hit.id)).toContain(id);

    const missingResult = await ctx.client.callTool({
      name: 'memory_update',
      arguments: { id: 'm_doesnotexist', title: 'x' },
    });
    expect(missingResult.isError).toBe(true);
  });

  it('memory://index resource reflects written entries as markdown', async () => {
    await ctx.client.callTool({
      name: 'memory_write',
      arguments: { content: '资源测试：索引应包含本条标题。', title: '索引可见性条目' },
    });

    const resource = await ctx.client.readResource({ uri: 'memory://index' });
    expect(resource.contents).toHaveLength(1);
    const item = resource.contents[0];
    expect(item.mimeType).toBe('text/markdown');
    if (!('text' in item)) throw new Error('expected text resource content');
    expect(item.text).toContain('# tememory 记忆索引');
    expect(item.text).toContain('索引可见性条目');
  });
});
