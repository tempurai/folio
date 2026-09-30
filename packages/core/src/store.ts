import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  MEMORY_TYPES,
  contentHash,
  newId,
  normalizeContent,
  parseMemoryFile,
  serializeMemoryFile,
  slugify,
} from './model.js';
import type { Memory, MemoryMeta, MemorySource, MemoryType } from './model.js';
import type { FolioPaths } from './paths.js';

export interface ListFilter {
  type?: MemoryType;
  scope?: string;
  archived?: boolean;
}

export interface CreateInput {
  content: string;
  type: MemoryType;
  scope: string;
  title?: string;
  tags?: string[];
  source: MemorySource;
}

export interface UpdatePatch {
  content?: string;
  type?: MemoryType;
  scope?: string;
  title?: string;
  tags?: string[];
  conflictsWith?: string[];
  supersedes?: string[];
}

interface ScannedEntry {
  memory: Memory;
  type: MemoryType;
  fileName: string;
}

function deriveTitle(content: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) return heading[1];
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return [...trimmed].slice(0, 20).join('');
  }
  return 'untitled';
}

function fileNameFor(memory: MemoryMeta): string {
  const slug = slugify(memory.title) || 'untitled';
  return `${slug}-${memory.id.slice(-8)}.md`;
}

function toMeta(memory: Memory): MemoryMeta {
  const { content: _content, ...meta } = memory;
  return meta;
}

export class MemoryStore {
  constructor(private readonly paths: FolioPaths) {}

  init(): void {
    mkdirSync(this.paths.memoryDir, { recursive: true });
    for (const type of MEMORY_TYPES) {
      mkdirSync(join(this.paths.memoryDir, type), { recursive: true });
    }
  }

  list(filter?: ListFilter): MemoryMeta[] {
    const root = filter?.archived ? this.paths.archiveDir : this.paths.memoryDir;
    return this.scanAll(root)
      .map((entry) => entry.memory)
      .filter((memory) => {
        if (filter?.type !== undefined && memory.type !== filter.type) return false;
        if (filter?.scope !== undefined && memory.scope !== filter.scope) return false;
        return true;
      })
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .map(toMeta);
  }

  get(id: string): Memory | null {
    const entry = this.locate(id);
    if (!entry) return null;
    return entry.memory;
  }

  create(input: CreateInput): { memory: Memory; created: boolean } {
    const content = normalizeContent(input.content);
    const hash = contentHash(content);
    const existing = this.findByHash(hash, input.scope);
    if (existing) {
      const memory = this.get(existing.id);
      if (memory) return { memory, created: false };
    }
    const now = new Date().toISOString();
    const memory: Memory = {
      id: newId(),
      type: input.type,
      scope: input.scope,
      title: input.title ?? deriveTitle(content),
      tags: input.tags ?? [],
      source: input.source,
      hash,
      created: now,
      updated: now,
      content,
    };
    const dir = join(this.paths.memoryDir, memory.type);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, fileNameFor(memory)), serializeMemoryFile(memory), 'utf8');
    return { memory, created: true };
  }

  update(id: string, patch: UpdatePatch): Memory | null {
    const entry = this.locate(id);
    if (!entry) return null;
    const previous = entry.memory;
    const next: Memory = {
      ...previous,
      updated: new Date().toISOString(),
    };
    if (patch.content !== undefined) {
      next.content = normalizeContent(patch.content);
      next.hash = contentHash(next.content);
    }
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.tags !== undefined) next.tags = patch.tags;
    if (patch.scope !== undefined) next.scope = patch.scope;
    if (patch.conflictsWith !== undefined) next.conflictsWith = patch.conflictsWith;
    if (patch.supersedes !== undefined) next.supersedes = patch.supersedes;

    const root = entry.root;
    let target = join(root, entry.type, entry.fileName);
    if (patch.type !== undefined && patch.type !== previous.type) {
      next.type = patch.type;
      const dir = join(root, next.type);
      mkdirSync(dir, { recursive: true });
      const moved = join(dir, entry.fileName);
      renameSync(target, moved);
      target = moved;
    }
    writeFileSync(target, serializeMemoryFile(next), 'utf8');
    return next;
  }

  archive(id: string): boolean {
    const entry = this.locateIn(this.paths.memoryDir, id);
    if (!entry) return false;
    const memory: Memory = { ...entry.memory, archived: true };
    const dir = join(this.paths.archiveDir, memory.type);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, entry.fileName), serializeMemoryFile(memory), 'utf8');
    rmSync(join(this.paths.memoryDir, entry.type, entry.fileName));
    return true;
  }

  findByHash(hash: string, scope: string): MemoryMeta | null {
    for (const root of [this.paths.memoryDir, this.paths.archiveDir]) {
      for (const entry of this.scanAll(root)) {
        if (entry.memory.hash === hash && entry.memory.scope === scope) {
          return toMeta(entry.memory);
        }
      }
    }
    return null;
  }

  all(): Memory[] {
    return this.scanAll(this.paths.memoryDir)
      .map((entry) => entry.memory)
      .filter((memory) => !memory.archived)
      .sort((a, b) => b.updated.localeCompare(a.updated));
  }

  rebuildIndex(): void {
    const entries = this.scanAll(this.paths.memoryDir)
      .filter((entry) => !entry.memory.archived)
      .sort((a, b) => b.memory.updated.localeCompare(a.memory.updated));

    const lines: string[] = [
      '# folio 记忆索引',
      '',
      '> 本文件由 folio 自动生成，请勿手动修改；要修改内容请编辑对应的记忆文件。',
      '',
    ];
    for (const type of MEMORY_TYPES) {
      lines.push(`## ${type}`, '');
      for (const entry of entries.filter((e) => e.type === type)) {
        const { memory } = entry;
        const tags = memory.tags.map((tag) => `#${tag}`).join(' ');
        const suffix = tags ? ` · ${tags}` : '';
        lines.push(
          `- [${memory.title}](${type}/${entry.fileName}) · ${memory.scope}${suffix}`,
        );
      }
      lines.push('');
    }
    writeFileSync(this.paths.indexFile, lines.join('\n'), 'utf8');
  }

  private scanAll(root: string): ScannedEntry[] {
    const entries: ScannedEntry[] = [];
    for (const type of MEMORY_TYPES) {
      const dir = join(root, type);
      if (!existsSync(dir)) continue;
      for (const fileName of readdirSync(dir)) {
        if (!fileName.endsWith('.md')) continue;
        const filePath = join(dir, fileName);
        try {
          const memory = parseMemoryFile(readFileSync(filePath, 'utf8'));
          entries.push({ memory, type, fileName });
        } catch {
          // Skip files that fail frontmatter parsing or validation.
        }
      }
    }
    return entries;
  }

  private locateIn(root: string, id: string): (ScannedEntry & { root: string }) | null {
    for (const entry of this.scanAll(root)) {
      if (entry.memory.id === id) return { ...entry, root };
    }
    return null;
  }

  private locate(id: string): (ScannedEntry & { root: string }) | null {
    return (
      this.locateIn(this.paths.memoryDir, id) ?? this.locateIn(this.paths.archiveDir, id)
    );
  }
}
