import type { Command } from 'commander';
import { MEMORY_TYPES, MemoryStore, resolvePaths } from '@folio/core';
import type { Memory, MemoryType, FolioPaths } from '@folio/core';

export interface Globals {
  home?: string;
  json: boolean;
}

export function globalsOf(cmd: Command): Globals {
  const opts = cmd.optsWithGlobals() as { home?: unknown; json?: unknown };
  return {
    home: typeof opts.home === 'string' ? opts.home : undefined,
    json: opts.json === true,
  };
}

/** 把任意错误压成一行中文可用的消息（多行合并，便于 stderr 单行输出） */
export function errMsg(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, ' ').trim();
}

export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export interface StoreContext {
  paths: FolioPaths;
  store: MemoryStore;
}

export function openStore(home?: string): StoreContext {
  const paths = resolvePaths(home);
  return { paths, store: new MemoryStore(paths) };
}

export function parseType(value: string): MemoryType {
  if ((MEMORY_TYPES as readonly string[]).includes(value)) return value as MemoryType;
  throw new Error(`未知记忆类型：${value}（可选：${MEMORY_TYPES.join(' / ')}）`);
}

export function parseCount(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${flag} 必须是正整数，收到：${value}`);
  }
  return n;
}

/** 精确 id 匹配；失败则按唯一前缀匹配（list 输出只显示前 12 位） */
export function findMemory(store: MemoryStore, idOrPrefix: string): Memory | null {
  const exact = store.get(idOrPrefix);
  if (exact) return exact;
  const candidates = [...store.list(), ...store.list({ archived: true })].filter((meta) =>
    meta.id.startsWith(idOrPrefix),
  );
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    throw new Error(
      `id 前缀「${idOrPrefix}」匹配到 ${candidates.length} 条记忆，请提供更长的前缀：${candidates
        .map((m) => m.id)
        .join(', ')}`,
    );
  }
  return store.get(candidates[0].id);
}

export function makeSnippet(content: string, query: string, maxLength = 120): string {
  const lines = content.split('\n');
  const needle = query.trim().toLowerCase();
  let line = '';
  if (needle) {
    line = lines.find((l) => l.toLowerCase().includes(needle)) ?? '';
  }
  if (!line) line = lines.find((l) => l.trim().length > 0) ?? '';
  return truncate(line.trim(), maxLength);
}

export function truncate(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars.slice(0, max - 1).join('')}…`;
}

export function formatTime(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

function isWideChar(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3ffff)
  );
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += isWideChar(ch.codePointAt(0) ?? 0) ? 2 : 1;
  return width;
}

function padCell(text: string, width: number): string {
  const pad = width - displayWidth(text);
  return pad > 0 ? text + ' '.repeat(pad) : text;
}

/** 手绘等宽表格（中文按 2 列宽计），不引入第三方依赖 */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, i) =>
    Math.max(displayWidth(header), ...rows.map((row) => displayWidth(row[i] ?? ''))),
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, i) => padCell(cell, widths[i]))
      .join('  ')
      .trimEnd();
  const separator = widths.map((w) => '─'.repeat(w));
  return [line(headers), line(separator), ...rows.map(line)].join('\n');
}
