import type { MemoryType } from '../model.js';

export interface CollectContext {
  projectDirs: string[];
}

export interface RawMemoryItem {
  harnessId: string;
  sourcePath: string;
  typeHint?: MemoryType;
  scope: string;
  title?: string;
  content: string;
  mtime: string;
  metadata?: Record<string, unknown>;
}

export interface McpIntegration {
  configPath(): string;
  format: 'json' | 'toml';
  getServers(parsed: unknown): Record<string, unknown>;
  withServer(parsed: unknown, name: string, entry: unknown): unknown;
  withoutServer(parsed: unknown, name: string): unknown;
}

export interface HarnessAdapter {
  id: string;
  name: string;
  detect(): Promise<boolean>;
  collect(ctx: CollectContext): Promise<RawMemoryItem[]>;
  mcp?: McpIntegration;
}
