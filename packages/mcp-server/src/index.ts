import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  ensureHome,
  MemoryStore,
  memoryTypeSchema,
  resolvePaths,
  SearchIndex,
  tokenize,
} from '@folio/core';
import type { UpdatePatch } from '@folio/core';
import { z } from 'zod';

export interface McpServerOptions {
  home?: string;
}

const SNIPPET_MAX_LENGTH = 200;

function readServerVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '..', 'package.json'), join(here, 'package.json')];
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: unknown };
      if (typeof pkg.version === 'string') return pkg.version;
    } catch {
      // Try the next candidate location.
    }
  }
  return '0.0.0';
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function fail(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: message }) }] };
}

function notFound(id: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: 'memory_not_found', id }) }],
  };
}

function makeSnippet(content: string, query: string): string {
  const lines = content.split('\n');
  const needle = query.trim().toLowerCase();
  const terms = [...new Set(tokenize(query))].sort((a, b) => b.length - a.length);
  let lineIndex = needle ? lines.findIndex((line) => line.toLowerCase().includes(needle)) : -1;
  if (lineIndex === -1) {
    lineIndex = lines.findIndex((line) => {
      const lower = line.toLowerCase();
      return terms.some((term) => lower.includes(term));
    });
  }
  const line = (
    lineIndex >= 0 ? lines[lineIndex] : lines.find((l) => l.trim().length > 0) ?? ''
  ).trim();
  const chars = [...line];
  if (chars.length <= SNIPPET_MAX_LENGTH) return line;
  const lower = line.toLowerCase();
  let matchIndex = needle ? lower.indexOf(needle) : -1;
  if (matchIndex === -1) {
    for (const term of terms) {
      matchIndex = lower.indexOf(term);
      if (matchIndex !== -1) break;
    }
  }
  if (matchIndex <= 0) return chars.slice(0, SNIPPET_MAX_LENGTH).join('');
  const matchCharIndex = [...lower.slice(0, matchIndex)].length;
  const start = Math.max(
    0,
    Math.min(
      matchCharIndex - Math.floor(SNIPPET_MAX_LENGTH / 2),
      chars.length - SNIPPET_MAX_LENGTH,
    ),
  );
  return chars.slice(start, start + SNIPPET_MAX_LENGTH).join('');
}

export async function createMcpServer(opts?: McpServerOptions): Promise<McpServer> {
  const paths = resolvePaths(opts?.home);
  ensureHome(paths);
  const store = new MemoryStore(paths);
  store.init();
  store.rebuildIndex();
  const searchIndex = new SearchIndex();
  const rebuildSearchIndex = () => searchIndex.build(store.all());
  rebuildSearchIndex();

  const server = new McpServer({ name: 'folio', version: readServerVersion() });

  server.registerTool(
    'memory_search',
    {
      description: '在 folio 记忆库中全文检索，返回按相关度排序的命中列表',
      inputSchema: {
        query: z.string().min(1).describe('检索词，支持中文与英文'),
        type: memoryTypeSchema.optional().describe('按记忆类型过滤'),
        scope: z.string().optional().describe('按作用域过滤，如 global 或项目标识'),
        limit: z.number().int().positive().optional().describe('返回条数上限，默认 20'),
      },
    },
    async ({ query, type, scope, limit }) => {
      try {
        const hits = searchIndex.search(query, { type, scope, limit });
        const results = [];
        for (const hit of hits) {
          const memory = store.get(hit.id);
          if (!memory) continue;
          results.push({
            id: memory.id,
            type: memory.type,
            scope: memory.scope,
            title: memory.title,
            tags: memory.tags,
            score: hit.score,
            snippet: makeSnippet(memory.content, query),
          });
        }
        return ok(results);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'memory_list',
    {
      description: '分页列出 folio 记忆库中的记忆元数据（不含正文）',
      inputSchema: {
        type: memoryTypeSchema.optional().describe('按记忆类型过滤'),
        scope: z.string().optional().describe('按作用域过滤'),
        limit: z.number().int().positive().default(50).describe('每页条数，默认 50'),
        offset: z.number().int().min(0).default(0).describe('分页偏移，默认 0'),
      },
    },
    async ({ type, scope, limit, offset }) => {
      try {
        const metas = store.list({ type, scope });
        return ok(metas.slice(offset, offset + limit));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'memory_read',
    {
      description: '按 id 读取一条记忆的完整内容（含正文）',
      inputSchema: {
        id: z.string().min(1).describe('记忆 id，形如 m_xxxxxxxxxxxx'),
      },
    },
    async ({ id }) => {
      try {
        const memory = store.get(id);
        if (!memory) return notFound(id);
        return ok(memory);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'memory_write',
    {
      description: '写入一条新记忆；同 scope 下内容完全相同时会去重并返回已有 id',
      inputSchema: {
        content: z.string().min(1).describe('记忆正文（Markdown）'),
        type: memoryTypeSchema.default('reference').describe('记忆类型，默认 reference'),
        scope: z.string().min(1).default('global').describe('作用域，默认 global'),
        tags: z.array(z.string()).optional().describe('标签列表'),
        title: z.string().optional().describe('标题，缺省时从正文推导'),
      },
    },
    async ({ content, type, scope, tags, title }) => {
      try {
        const { memory, created } = store.create({
          content,
          type,
          scope,
          tags,
          title,
          source: { harness: 'mcp', importedAt: new Date().toISOString() },
        });
        store.rebuildIndex();
        rebuildSearchIndex();
        return ok({ id: memory.id, created });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'memory_update',
    {
      description: '更新一条已有记忆的正文、标题或标签',
      inputSchema: {
        id: z.string().min(1).describe('要更新的记忆 id'),
        content: z.string().optional().describe('新正文'),
        title: z.string().optional().describe('新标题'),
        tags: z.array(z.string()).optional().describe('新标签列表（整体替换）'),
      },
    },
    async ({ id, content, title, tags }) => {
      try {
        const patch: UpdatePatch = {};
        if (content !== undefined) patch.content = content;
        if (title !== undefined) patch.title = title;
        if (tags !== undefined) patch.tags = tags;
        const memory = store.update(id, patch);
        if (!memory) return notFound(id);
        store.rebuildIndex();
        rebuildSearchIndex();
        return ok(memory);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerResource(
    'memory-index',
    'memory://index',
    {
      description: 'folio 记忆库索引文件（MEMORY.md）的当前内容',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: existsSync(paths.indexFile) ? readFileSync(paths.indexFile, 'utf8') : '',
        },
      ],
    }),
  );

  return server;
}

export async function startMcpServer(opts?: McpServerOptions): Promise<void> {
  const server = await createMcpServer(opts);
  await server.connect(new StdioServerTransport());
  console.error(`[folio] MCP server ready on stdio (home: ${resolvePaths(opts?.home).home})`);
}
