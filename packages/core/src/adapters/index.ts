import type { HarnessAdapter } from './types.js';
import { claudeCodeAdapter } from './claude-code.js';
import { codexAdapter } from './codex.js';
import { cursorAdapter } from './cursor.js';
import { kimiCodeAdapter } from './kimi-code.js';
import { zcodeAdapter } from './zcode.js';

export { claudeCodeAdapter } from './claude-code.js';
export { codexAdapter } from './codex.js';
export { cursorAdapter } from './cursor.js';
export { kimiCodeAdapter } from './kimi-code.js';
export { zcodeAdapter } from './zcode.js';
export type { CollectContext, HarnessAdapter, McpIntegration, RawMemoryItem } from './types.js';

export const adapters: HarnessAdapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  cursorAdapter,
  kimiCodeAdapter,
  zcodeAdapter,
];

export function getAdapter(id: string): HarnessAdapter | undefined {
  return adapters.find((adapter) => adapter.id === id);
}
