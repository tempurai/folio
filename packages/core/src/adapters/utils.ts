import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, relative } from 'node:path';
import matter from 'gray-matter';
import { MEMORY_TYPES } from '../model.js';
import type { MemoryType } from '../model.js';
import type { McpIntegration } from './types.js';

export interface WalkMarkdownOptions {
  extensions?: string[];
  skip?: (relPath: string, name: string) => boolean;
}

export function walkMarkdown(dir: string, opts?: WalkMarkdownOptions): string[] {
  if (!existsSync(dir)) return [];
  const extensions = (opts?.extensions ?? ['.md']).map((ext) => ext.toLowerCase());
  const results: string[] = [];
  const walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      const rel = relative(dir, full);
      if (opts?.skip?.(rel, entry.name)) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && extensions.includes(extname(entry.name).toLowerCase())) {
        results.push(full);
      }
    }
  };
  walk(dir);
  return results.sort();
}

export function listSubdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export interface MarkdownItem {
  content: string;
  frontmatter: Record<string, unknown>;
  mtime: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readMarkdownItem(filePath: string): MarkdownItem {
  const raw = readFileSync(filePath, 'utf8');
  let content = raw;
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = matter(raw);
    content = parsed.content;
    if (isRecord(parsed.data)) frontmatter = parsed.data;
  } catch {
    // frontmatter 损坏：容错处理，整个文件当正文，忽略 frontmatter
  }
  const mtime = statSync(filePath).mtime.toISOString();
  return { content, frontmatter, mtime };
}

export function tryReadMarkdownItem(filePath: string): MarkdownItem | null {
  try {
    return readMarkdownItem(filePath);
  } catch {
    return null;
  }
}

export function decodeProjectDirName(name: string): string {
  if (name.startsWith('-')) return name.replace(/-/g, '/');
  return name;
}

export function resolveHarnessHome(envVar: string, defaultDirName: string): string {
  return process.env[envVar] ?? join(homedir(), defaultDirName);
}

export function typeHintFrom(frontmatter: Record<string, unknown>): MemoryType | undefined {
  const type = frontmatter.type;
  if (typeof type === 'string' && (MEMORY_TYPES as readonly string[]).includes(type)) {
    return type as MemoryType;
  }
  return undefined;
}

export function deriveTitle(
  frontmatter: Record<string, unknown>,
  filePath: string,
): string | undefined {
  for (const key of ['title', 'name']) {
    const value = frontmatter[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const stem = basename(filePath).replace(/\.[^.]+$/, '');
  return stem || undefined;
}

export interface McpIntegrationOptions {
  configPath: () => string;
  format: 'json' | 'toml';
  serversPath: string[];
}

export function defineMcpIntegration(options: McpIntegrationOptions): McpIntegration {
  const { configPath, format, serversPath } = options;

  const getServers = (parsed: unknown): Record<string, unknown> => {
    let node: unknown = parsed;
    for (const segment of serversPath) {
      if (!isRecord(node)) return {};
      node = node[segment];
    }
    return isRecord(node) ? node : {};
  };

  const setServers = (
    node: unknown,
    path: string[],
    servers: Record<string, unknown>,
  ): unknown => {
    const head = path[0];
    if (head === undefined) return servers;
    const base = isRecord(node) ? node : {};
    return {
      ...base,
      [head]: path.length === 1 ? servers : setServers(base[head], path.slice(1), servers),
    };
  };

  return {
    configPath,
    format,
    getServers,
    withServer(parsed, name, entry) {
      return setServers(parsed, serversPath, { ...getServers(parsed), [name]: entry });
    },
    withoutServer(parsed, name) {
      const servers = { ...getServers(parsed) };
      delete servers[name];
      return setServers(parsed, serversPath, servers);
    },
  };
}
