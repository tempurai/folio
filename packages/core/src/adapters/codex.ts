import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { CollectContext, HarnessAdapter, RawMemoryItem } from './types.js';
import {
  defineMcpIntegration,
  deriveTitle,
  resolveHarnessHome,
  tryReadMarkdownItem,
  typeHintFrom,
  walkMarkdown,
} from './utils.js';

const ID = 'codex';

function codexHome(): string {
  return resolveHarnessHome('CODEX_HOME', '.codex');
}

async function collect(_ctx: CollectContext): Promise<RawMemoryItem[]> {
  const home = codexHome();
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
        title: 'Codex 全局指令',
        content: read.content,
        mtime: read.mtime,
      });
    }
  }

  // ② memories/；memories_extensions/ 是屏幕上下文（敏感），绝不收集；
  // sessions/config/history 等其他目录一律不碰
  for (const file of walkMarkdown(join(home, 'memories'), {
    skip: (relPath) => relPath.split(sep).includes('memories_extensions'),
  })) {
    const read = tryReadMarkdownItem(file);
    if (!read) continue;
    const project = read.frontmatter.project;
    const scope =
      typeof project === 'string' && project.trim() ? `project:${project.trim()}` : 'global';
    items.push({
      harnessId: ID,
      sourcePath: file,
      typeHint: typeHintFrom(read.frontmatter) ?? 'reference',
      scope,
      title: deriveTitle(read.frontmatter, file),
      content: read.content,
      mtime: read.mtime,
    });
  }

  return items;
}

export const codexAdapter: HarnessAdapter = {
  id: ID,
  name: 'Codex',
  detect: async () => existsSync(codexHome()),
  collect,
  mcp: defineMcpIntegration({
    configPath: () => join(codexHome(), 'config.toml'),
    format: 'toml',
    serversPath: ['mcp_servers'],
  }),
};
