import { homedir } from 'node:os';
import { join } from 'node:path';

export interface TememoryPaths {
  home: string;
  configFile: string;
  memoryDir: string;
  indexFile: string;
  stateDir: string;
  stateFile: string;
  cacheDir: string;
  archiveDir: string;
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export function resolvePaths(homeOverride?: string): TememoryPaths {
  const home = expandHome(
    homeOverride ?? process.env.TEMEMORY_HOME ?? join(homedir(), '.tememory'),
  );
  const memoryDir = join(home, 'memory');
  const stateDir = join(home, 'state');
  const cacheDir = join(home, 'cache');
  return {
    home,
    configFile: join(home, 'config.toml'),
    memoryDir,
    indexFile: join(memoryDir, 'MEMORY.md'),
    stateDir,
    stateFile: join(stateDir, 'sync-state.json'),
    cacheDir,
    archiveDir: join(home, 'archive'),
  };
}
