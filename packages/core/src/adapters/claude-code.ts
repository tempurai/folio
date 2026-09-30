import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CollectContext, HarnessAdapter, RawMemoryItem } from './types.js';
import {
  decodeProjectDirName,
  defineMcpIntegration,
  deriveTitle,
  listSubdirs,
  resolveHarnessHome,
  tryReadMarkdownItem,
  typeHintFrom,
  walkMarkdown,
} from './utils.js';

const ID = 'claude-code';

function claudeHome(): string {
  return resolveHarnessHome('CLAUDE_CONFIG_DIR', '.claude');
}

async function collect(_ctx: CollectContext): Promise<RawMemoryItem[]> {
  const home = claudeHome();
  const items: RawMemoryItem[] = [];

  // ① 用户全局指令
  const globalInstructions = join(home, 'CLAUDE.md');
  if (existsSync(globalInstructions)) {
    const read = tryReadMarkdownItem(globalInstructions);
    if (read) {
      items.push({
        harnessId: ID,
        sourcePath: globalInstructions,
        typeHint: 'user',
        scope: 'global',
        title: 'Claude Code 用户全局指令',
        content: read.content,
        mtime: read.mtime,
      });
    }
  }

  // ② 全局 rules
  for (const file of walkMarkdown(join(home, 'rules'))) {
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

  // ③ 项目级 memory（跳过 MEMORY.md 索引文件；sessions/history 等其他目录一律不碰）
  const projectsDir = join(home, 'projects');
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
        scope: `project:${decodeProjectDirName(projectDir)}`,
        title: deriveTitle(read.frontmatter, file),
        content: read.content,
        mtime: read.mtime,
        metadata: { rawProjectDir: projectDir },
      });
    }
  }

  return items;
}

export const claudeCodeAdapter: HarnessAdapter = {
  id: ID,
  name: 'Claude Code',
  detect: async () => existsSync(claudeHome()),
  collect,
  mcp: defineMcpIntegration({
    // 注意：Claude Code 的 MCP 配置在家目录根的 .claude.json，不在 ~/.claude 里
    configPath: () => join(homedir(), '.claude.json'),
    format: 'json',
    serversPath: ['mcpServers'],
  }),
};
