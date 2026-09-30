import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectContext, HarnessAdapter, RawMemoryItem } from './types.js';
import {
  defineMcpIntegration,
  deriveTitle,
  listSubdirs,
  resolveHarnessHome,
  tryReadMarkdownItem,
  typeHintFrom,
  walkMarkdown,
} from './utils.js';

const ID = 'zcode';

function zcodeHome(): string {
  return resolveHarnessHome('TEMEMORY_ZCODE_HOME', '.zcode');
}

async function collect(ctx: CollectContext): Promise<RawMemoryItem[]> {
  const home = zcodeHome();
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
        title: 'ZCode 全局指令',
        content: read.content,
        mtime: read.mtime,
      });
    }
  }

  // ② cli/memories/projects/<proj>/memory/（跳过 MEMORY.md 索引）
  const projectsDir = join(home, 'cli', 'memories', 'projects');
  for (const projectDir of listSubdirs(projectsDir)) {
    const memoryDir = join(projectsDir, projectDir, 'memory');
    for (const file of walkMarkdown(memoryDir, {
      skip: (_relPath, name) => name === 'MEMORY.md',
    })) {
      const read = tryReadMarkdownItem(file);
      if (!read) continue;
      items.push({
        harnessId: ID,
        sourcePath: file,
        typeHint: typeHintFrom(read.frontmatter),
        scope: `project:${projectDir}`,
        title: deriveTitle(read.frontmatter, file),
        content: read.content,
        mtime: read.mtime,
        metadata: { rawProjectDir: projectDir },
      });
    }
  }

  // ③ agent-memory（全局 + 各项目 .zcode/agent-memory）
  for (const file of walkMarkdown(join(home, 'agent-memory'))) {
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
      metadata: { agentMemory: true },
    });
  }
  for (const dir of ctx.projectDirs) {
    for (const file of walkMarkdown(join(dir, '.zcode', 'agent-memory'))) {
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
        metadata: { agentMemory: true },
      });
    }
  }

  return items;
}

export const zcodeAdapter: HarnessAdapter = {
  id: ID,
  name: 'ZCode',
  detect: async () => existsSync(zcodeHome()),
  collect,
  mcp: defineMcpIntegration({
    configPath: () => join(zcodeHome(), 'cli', 'config.json'),
    format: 'json',
    // ZCode 的 MCP servers 在嵌套的 mcp.servers 键下
    serversPath: ['mcp', 'servers'],
  }),
};
