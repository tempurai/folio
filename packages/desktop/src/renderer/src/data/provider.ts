import type {
  ActivityEntry,
  ApplyReport,
  FileInfo,
  FileReadResponse,
  InstallTarget,
  MemoryType,
  OrganizePlanResponse,
  Settings,
  SettingsPatch,
  SourceStatus,
  SyncReport,
  TememoryApi,
  TreeResponse,
  WatchStatus,
} from '../../../shared/ipc';
import { ACT, FILES, FOLDERS, INDEX_MD, OPS, SOURCES } from '@/data/mock';
import type { MemoryFile, MemoryFolder } from '@/lib/types';

/**
 * 数据入口：Electron 里用 preload 注入的 window.tememory；
 * 纯浏览器预览（无 preload）时回退到 mockProvider，页面代码无感知。
 */

export function toMemoryFile(info: FileInfo): MemoryFile {
  return {
    folder: info.folder,
    file: info.file,
    title: info.title,
    scope: info.scope,
    src: info.src,
    from: info.from,
    updated: info.updated,
    tags: info.tags,
    body: '',
  };
}

export function relPathOf(folder: MemoryFolder, file: string): string {
  return `${folder}/${file}`;
}

// ---------------------------------------------------------------------------
// mock fallback（数据来自 gui-mock 原 mock.ts，本地可变副本）

const SOURCE_IDS = ['claude-code', 'codex', 'cursor', 'kimi-code', 'zcode'] as const;

function createMockProvider(): TememoryApi {
  const files: MemoryFile[] = FILES.map((f) => ({ ...f }));
  const mcpOn = new Map<string, boolean>(SOURCES.map((s, i) => [SOURCE_IDS[i], s.mcp]));
  let ops = OPS.map((o, i) => ({ ...o, index: i }));
  let settings: Settings = {
    llm: {
      enabled: true,
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      hasApiKey: false,
      apiKeyMasked: null,
      classifyOnSync: false,
    },
    adapters: SOURCES.map((s, i) => ({ id: SOURCE_IDS[i], name: s.name, enabled: true })),
    home: '~/.tememory',
  };
  let watchEnabled = true;

  const infoOf = (f: MemoryFile): FileInfo => ({
    folder: f.folder,
    file: f.file,
    title: f.title,
    scope: f.scope,
    src: f.src,
    from: f.from,
    updated: f.updated,
    tags: f.tags,
  });

  const nowStamp = (): string => {
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  return {
    async listTree(): Promise<TreeResponse> {
      const folders = FOLDERS.map((folder) => {
        const kids = files.filter((f) => f.folder === folder).map(infoOf);
        return { folder, files: kids };
      });
      const byFolder = Object.fromEntries(
        folders.map((f) => [f.folder, f.files.length]),
      ) as Record<MemoryType, number>;
      return { folders, counts: { total: files.length, byFolder } };
    },

    async readFile(relPath: string): Promise<FileReadResponse> {
      const f = files.find((x) => relPathOf(x.folder, x.file) === relPath);
      if (!f) throw new Error(`文件不存在：${relPath}`);
      return { meta: infoOf(f), body: f.body };
    },

    async readIndex(): Promise<string> {
      return INDEX_MD;
    },

    async writeFile(relPath: string, body: string): Promise<FileInfo> {
      const f = files.find((x) => relPathOf(x.folder, x.file) === relPath);
      if (!f) throw new Error(`文件不存在：${relPath}`);
      f.body = body;
      f.updated = nowStamp();
      return infoOf(f);
    },

    async createFile(folder: MemoryType, title: string, body: string): Promise<FileInfo> {
      const file = `${title.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '-')}-mock00${
        files.length
      }.md`;
      const f: MemoryFile = {
        folder,
        file,
        title,
        scope: 'global',
        src: 'desktop',
        from: '',
        updated: nowStamp(),
        tags: [],
        body,
      };
      files.unshift(f);
      return infoOf(f);
    },

    async archiveFile(relPath: string): Promise<void> {
      const i = files.findIndex((x) => relPathOf(x.folder, x.file) === relPath);
      if (i >= 0) files.splice(i, 1);
    },

    async showInFolder(): Promise<void> {},

    async listSources(): Promise<SourceStatus[]> {
      return SOURCES.map((s, i) => ({
        id: SOURCE_IDS[i],
        name: s.name,
        detected: true,
        importedCount: s.cnt,
        mcpRegistered: mcpOn.get(SOURCE_IDS[i]) ?? false,
        configPath: `~/.${SOURCE_IDS[i]}/mcp.json`,
      }));
    },

    async installMcp(adapterId: string): Promise<InstallTarget[]> {
      mcpOn.set(adapterId, true);
      return [{ adapterId, configPath: `~/.${adapterId}/mcp.json`, changed: true }];
    },

    async uninstallMcp(adapterId: string): Promise<InstallTarget[]> {
      mcpOn.set(adapterId, false);
      return [{ adapterId, configPath: `~/.${adapterId}/mcp.json`, changed: true }];
    },

    async runSync(): Promise<SyncReport> {
      const now = new Date().toISOString();
      return { startedAt: now, finishedAt: now, adapters: [], errors: [] };
    },

    async listActivity(): Promise<ActivityEntry[]> {
      return ACT.map((a) => ({
        at: `2026-${a.t.replace(' ', 'T')}:00`,
        trigger: a.what[0][0] === 'watch' ? 'watch' : a.what[0][0] === '手动 ' ? 'manual' : 'first',
        adapters: [
          {
            id: 'mock',
            detected: true,
            added: a.p,
            updated: a.u,
            skipped: a.s,
            removed: 0,
            errors: [],
          },
        ],
      }));
    },

    async planOrganize(): Promise<OrganizePlanResponse> {
      return {
        generatedAt: new Date().toISOString(),
        llmUsed: false,
        notes: [],
        ops: ops.map((o, i) => ({ kind: 'retag' as const, id: `mock-${i}`, tags: [], reason: o.why })),
        views: ops.map((o, i) => ({ index: i, st: o.st, files: o.files, to: o.to, why: o.why })),
      };
    },

    async applyOrganize(opIndexes: number[]): Promise<ApplyReport> {
      ops = ops.filter((_, i) => !opIndexes.includes(i));
      return {
        merged: opIndexes.length,
        retyped: 0,
        retagged: 0,
        conflictsMarked: 0,
        errors: [],
      };
    },

    async getSettings(): Promise<Settings> {
      return settings;
    },

    async saveSettings(patch: SettingsPatch, apiKey?: string): Promise<Settings> {
      settings = {
        llm: {
          ...settings.llm,
          ...(patch.llm ?? {}),
          ...(apiKey
            ? { hasApiKey: true, apiKeyMasked: `${apiKey.slice(0, 3)}••••••••` }
            : apiKey === ''
              ? { hasApiKey: false, apiKeyMasked: null }
              : {}),
        },
        adapters: settings.adapters.map((a) => {
          const p = patch.adapters?.find((x) => x.id === a.id);
          return p ? { ...a, enabled: p.enabled } : a;
        }),
        home: settings.home,
      };
      return settings;
    },

    async getWatchStatus(): Promise<WatchStatus> {
      return { enabled: watchEnabled, lastSyncAt: new Date(Date.now() - 120_000).toISOString() };
    },

    async setWatch(enabled: boolean): Promise<WatchStatus> {
      watchEnabled = enabled;
      return this.getWatchStatus();
    },

    onSyncDone(): () => void {
      return () => {};
    },
  };
}

export const api: TememoryApi = window.tememory ?? createMockProvider();

/** 纯浏览器预览模式（无 Electron preload）时为 true */
export const isMock = window.tememory === undefined;
