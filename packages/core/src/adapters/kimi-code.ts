import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { CollectContext, HarnessAdapter, RawMemoryItem } from './types.js';
import {
  defineMcpIntegration,
  deriveTitle,
  resolveHarnessHome,
  tryReadMarkdownItem,
  typeHintFrom,
  walkMarkdown,
} from './utils.js';

const ID = 'kimi-code';

function kimiHome(): string {
  return resolveHarnessHome('KIMI_CODE_HOME', '.kimi-code');
}

async function collect(_ctx: CollectContext): Promise<RawMemoryItem[]> {
  const home = kimiHome();
  const items: RawMemoryItem[] = [];

  // ① 全局指令
  const globalInstructions = join(home, 'AGENTS.md');
  if (existsSync(globalInstructions)) {
    const read = tryReadMarkdownItem(globalInstructions);
    if (read) {
      items.push({
        harnessId: ID,
        sourcePath: globalInstructions,
        typeHint: 'user',
        scope: 'global',
        title: 'Kimi Code 全局指令',
        content: read.content,
        mtime: read.mtime,
      });
    }
  }

  // ② memories/（跳过 MEMORY.md 索引）；memories/<proj>/... 归为项目级
  const memoriesDir = join(home, 'memories');
  for (const file of walkMarkdown(memoriesDir, {
    skip: (_relPath, name) => name === 'MEMORY.md',
  })) {
    const read = tryReadMarkdownItem(file);
    if (!read) continue;
    const segments = relative(memoriesDir, file).split(sep);
    const scope = segments.length > 1 ? `project:${segments[0]}` : 'global';
    items.push({
      harnessId: ID,
      sourcePath: file,
      typeHint: typeHintFrom(read.frontmatter),
      scope,
      title: deriveTitle(read.frontmatter, file),
      content: read.content,
      mtime: read.mtime,
    });
  }

  return items;
}

export const kimiCodeAdapter: HarnessAdapter = {
  id: ID,
  name: 'Kimi Code',
  detect: async () => existsSync(kimiHome()),
  collect,
  mcp: defineMcpIntegration({
    configPath: () => join(kimiHome(), 'mcp.json'),
    format: 'json',
    serversPath: ['mcpServers'],
  }),
};
