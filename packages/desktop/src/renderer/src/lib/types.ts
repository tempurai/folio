export type MemoryFolder = 'user' | 'feedback' | 'project' | 'reference';

export type Route =
  | { kind: 'file'; id: string } // id 为文件名，'__index__' 表示 MEMORY.md 索引页
  | { kind: 'sources' }
  | { kind: 'organize' }
  | { kind: 'activity' }
  | { kind: 'settings' };

export interface MemoryFile {
  folder: MemoryFolder;
  file: string;
  title: string;
  scope: string;
  src: string;
  from: string;
  updated: string;
  tags: string[];
  body: string;
}

export interface SourceInfo {
  letter: string;
  name: string;
  paths: string;
  mcp: boolean;
  cnt: number;
}

export interface OrganizeOp {
  st: 'M' | 'R' | 'A' | '!';
  files: string;
  to: string | null;
  why: string;
}

export interface ActivityEntry {
  t: string;
  // [文本, 是否加粗关键词]
  what: Array<[string, boolean]>;
  p: number;
  u: number;
  s: number;
}

export const INDEX_ID = '__index__';
