import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectContext, HarnessAdapter, RawMemoryItem } from './types.js';
import {
  defineMcpIntegration,
  deriveTitle,
  resolveHarnessHome,
  tryReadMarkdownItem,
  walkMarkdown,
} from './utils.js';

const ID = 'cursor';

const CURSOR_RULE_KEYS = ['description', 'globs', 'alwaysApply'] as const;

function cursorHome(): string {
  return resolveHarnessHome('TEMEMORY_CURSOR_HOME', '.cursor');
}

function cursorRuleMeta(frontmatter: Record<string, unknown>): Record<string, unknown> | undefined {
  const rule: Record<string, unknown> = {};
  for (const key of CURSOR_RULE_KEYS) {
    if (key in frontmatter) rule[key] = frontmatter[key];
  }
  return Object.keys(rule).length > 0 ? { cursorRule: rule } : undefined;
}

async function collect(ctx: CollectContext): Promise<RawMemoryItem[]> {
  const home = cursorHome();
  const items: RawMemoryItem[] = [];

  // ① 全局 rules（.md 与 .mdc）
  for (const file of walkMarkdown(join(home, 'rules'), { extensions: ['.md', '.mdc'] })) {
    const read = tryReadMarkdownItem(file);
    if (!read) continue;
    items.push({
      harnessId: ID,
      sourcePath: file,
      typeHint: 'reference',
      scope: 'global',
      title: deriveTitle(read.frontmatter, file),
      content: read.content,
      mtime: read.mtime,
    });
  }

  // ② 项目级 .cursor/rules（仅 .mdc）
  for (const dir of ctx.projectDirs) {
    for (const file of walkMarkdown(join(dir, '.cursor', 'rules'), {
      extensions: ['.mdc'],
    })) {
      const read = tryReadMarkdownItem(file);
      if (!read) continue;
      items.push({
        harnessId: ID,
        sourcePath: file,
        typeHint: 'reference',
        scope: `project:${dir}`,
        title: deriveTitle(read.frontmatter, file),
        content: read.content,
        mtime: read.mtime,
        metadata: cursorRuleMeta(read.frontmatter),
      });
    }
  }

  return items;
}

export const cursorAdapter: HarnessAdapter = {
  id: ID,
  name: 'Cursor',
  detect: async () => existsSync(cursorHome()),
  collect,
  mcp: defineMcpIntegration({
    configPath: () => join(cursorHome(), 'mcp.json'),
    format: 'json',
    serversPath: ['mcpServers'],
  }),
};
