import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Memory, MemoryType } from './model.js';

export interface SearchOptions {
  limit?: number;
  type?: MemoryType;
  scope?: string;
}

export interface SearchHit {
  id: string;
  score: number;
}

interface DocInfo {
  type: MemoryType;
  scope: string;
}

const CONTENT_WEIGHT = 1;
const META_WEIGHT = 3;
const DEFAULT_LIMIT = 20;

const TOKEN_RE = /[a-z0-9]+|\p{Script=Han}+/gu;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(lower)) !== null) {
    const token = match[0];
    if (/^[a-z0-9]+$/.test(token)) {
      tokens.push(token);
    } else {
      const chars = [...token];
      for (const char of chars) tokens.push(char);
      for (let i = 0; i + 1 < chars.length; i++) {
        tokens.push(chars[i] + chars[i + 1]);
      }
    }
  }
  return tokens;
}

interface SerializedIndex {
  version: 1;
  docs: Record<string, DocInfo>;
  terms: Array<[string, Array<[string, number]>]>;
}

export class SearchIndex {
  private readonly index = new Map<string, Map<string, number>>();
  private readonly docs = new Map<string, DocInfo>();

  build(memories: Memory[]): void {
    this.index.clear();
    this.docs.clear();
    for (const memory of memories) {
      this.docs.set(memory.id, { type: memory.type, scope: memory.scope });
      const contentTerms = new Set(tokenize(memory.content));
      const metaTerms = new Set(
        tokenize([memory.title, ...memory.tags].join(' ')),
      );
      for (const term of contentTerms) this.addTerm(term, memory.id, CONTENT_WEIGHT);
      for (const term of metaTerms) this.addTerm(term, memory.id, META_WEIGHT);
    }
  }

  search(query: string, opts?: SearchOptions): SearchHit[] {
    const terms = new Set(tokenize(query));
    const scores = new Map<string, number>();
    for (const term of terms) {
      const postings = this.index.get(term);
      if (!postings) continue;
      for (const [id, weight] of postings) {
        scores.set(id, (scores.get(id) ?? 0) + weight);
      }
    }
    const limit = opts?.limit ?? DEFAULT_LIMIT;
    return [...scores.entries()]
      .filter(([id]) => {
        const doc = this.docs.get(id);
        if (!doc) return false;
        if (opts?.type !== undefined && doc.type !== opts.type) return false;
        if (opts?.scope !== undefined && doc.scope !== opts.scope) return false;
        return true;
      })
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  save(file: string): void {
    const data: SerializedIndex = {
      version: 1,
      docs: Object.fromEntries(this.docs),
      terms: [...this.index.entries()].map(([term, postings]) => [
        term,
        [...postings.entries()],
      ]),
    };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data), 'utf8');
  }

  static load(file: string): SearchIndex | null {
    if (!existsSync(file)) return null;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as SerializedIndex;
      const index = new SearchIndex();
      for (const [id, info] of Object.entries(data.docs)) {
        index.docs.set(id, info);
      }
      for (const [term, postings] of data.terms) {
        index.index.set(term, new Map(postings));
      }
      return index;
    } catch {
      return null;
    }
  }

  private addTerm(term: string, id: string, weight: number): void {
    let postings = this.index.get(term);
    if (!postings) {
      postings = new Map();
      this.index.set(term, postings);
    }
    postings.set(id, (postings.get(id) ?? 0) + weight);
  }
}
