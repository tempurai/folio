import { homedir } from 'node:os';
import { join } from 'node:path';
import { adapters, runSync } from '@folio/core';
import type { SyncReport } from '@folio/core';
import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';

// 与各 adapter 内部的 home 解析规则保持一致（env 覆盖优先，其次 ~/.<dir>），同 CLI watch
const HARNESS_HOME_RESOLVERS: Record<string, () => string> = {
  'claude-code': () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
  codex: () => process.env.CODEX_HOME ?? join(homedir(), '.codex'),
  cursor: () => process.env.FOLIO_CURSOR_HOME ?? join(homedir(), '.cursor'),
  'kimi-code': () => process.env.KIMI_CODE_HOME ?? join(homedir(), '.kimi-code'),
  zcode: () => process.env.FOLIO_ZCODE_HOME ?? join(homedir(), '.zcode'),
};

export interface MemoryWatcherOptions {
  home?: string;
  /** 变化去抖毫秒数，默认 2000 */
  debounceMs?: number;
  onSyncDone(report: SyncReport): void;
  onError?(message: string): void;
}

/**
 * 监听各 harness 的记忆源目录，变化去抖后自动增量同步（trigger: 'watch'）。
 * 不依赖 electron；渲染层通知由调用方在 onSyncDone 里完成。
 */
export class MemoryWatcher {
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;
  private pending = false;

  constructor(private readonly opts: MemoryWatcherOptions) {}

  get running(): boolean {
    return this.watcher !== null;
  }

  /** 开始监听；返回实际监听的目录（无已检测 harness 时返回空数组且保持停止） */
  async start(): Promise<string[]> {
    if (this.watcher) return [];
    const watched: Array<{ id: string; dir: string }> = [];
    for (const adapter of adapters) {
      if (!(await adapter.detect().catch(() => false))) continue;
      const resolveHome = HARNESS_HOME_RESOLVERS[adapter.id];
      if (resolveHome) watched.push({ id: adapter.id, dir: resolveHome() });
    }
    if (watched.length === 0) return [];
    this.watcher = watch(
      watched.map((w) => w.dir),
      { ignoreInitial: true },
    );
    this.watcher.on('all', () => this.schedule());
    this.watcher.on('error', (err) => {
      this.opts.onError?.(`监听错误：${err instanceof Error ? err.message : String(err)}`);
    });
    return watched.map((w) => w.dir);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const watcher = this.watcher;
    this.watcher = null;
    if (watcher) await watcher.close();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const debounce = this.opts.debounceMs ?? 2000;
    this.timer = setTimeout(() => {
      void this.runOnce();
    }, debounce);
  }

  private async runOnce(): Promise<void> {
    if (this.syncing) {
      this.pending = true;
      return;
    }
    this.syncing = true;
    try {
      const report = await runSync({
        home: this.opts.home,
        projectDirs: [],
        trigger: 'watch',
      });
      this.opts.onSyncDone(report);
    } catch (err) {
      this.opts.onError?.(
        `watch 同步失败：${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.syncing = false;
      if (this.pending) {
        this.pending = false;
        this.schedule();
      }
    }
  }
}
