import { createHash, randomBytes } from 'node:crypto';
import matter from 'gray-matter';
import { z } from 'zod';

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export const MEMORY_TYPES: readonly MemoryType[] = ['user', 'feedback', 'project', 'reference'];

export interface MemorySource {
  harness: string;
  path?: string;
  importedAt: string;
}

export interface MemoryMeta {
  id: string;
  type: MemoryType;
  scope: string;
  title: string;
  tags: string[];
  source: MemorySource;
  hash: string;
  created: string;
  updated: string;
  supersedes?: string[];
  conflictsWith?: string[];
  archived?: boolean;
}

export interface Memory extends MemoryMeta {
  content: string;
}

export interface AdapterSyncState {
  lastSyncAt?: string;
  items: Record<string, { hash: string; memoryId: string; mtime?: string }>;
}

export interface SourceSyncState {
  hash: string;
  memoryId: string;
  harnessId: string;
  lastSyncAt: string;
}

export interface SyncState {
  version: 1;
  sources: Record<string, SourceSyncState>;
}

export const memoryTypeSchema = z.enum(['user', 'feedback', 'project', 'reference']);

export const memorySourceSchema = z.object({
  harness: z.string().min(1),
  path: z.string().optional(),
  importedAt: z.string().min(1),
});

export const memoryMetaSchema = z.object({
  id: z.string().min(1),
  type: memoryTypeSchema,
  scope: z.string().min(1),
  title: z.string(),
  tags: z.array(z.string()).default([]),
  source: memorySourceSchema,
  hash: z.string().min(1),
  created: z.string().min(1),
  updated: z.string().min(1),
  supersedes: z.array(z.string()).optional(),
  conflictsWith: z.array(z.string()).optional(),
  archived: z.boolean().optional(),
});

export const memorySchema = memoryMetaSchema.extend({
  content: z.string(),
});

export function parseMemoryFile(text: string): Memory {
  const { data, content } = matter(text);
  const meta = memoryMetaSchema.parse(data);
  return { ...(meta as MemoryMeta), content };
}

export function serializeMemoryFile(memory: Memory): string {
  const { content, ...meta } = memory;
  return matter.stringify(content, meta);
}

export function normalizeContent(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '') + '\n';
}

export function contentHash(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return [...slug].slice(0, 48).join('').replace(/-+$/, '');
}

export function newId(): string {
  const ts = Date.now().toString(36).padStart(8, '0');
  const bytes = randomBytes(6);
  let rand = '';
  for (let i = 0; i < 6; i++) rand += (bytes[i] % 36).toString(36);
  return `m_${ts}${rand}`;
}
