import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { IPC } from '../shared/ipc.js';
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
  FolioApi,
  TreeResponse,
  WatchStatus,
} from '../shared/ipc.js';

/**
 * contextBridge 窄 API：只暴露函数 + 纯数据，不暴露 ipcRenderer 本体。
 * 订阅类 API 返回 unsubscribe（内部 removeListener，防泄漏）。
 */

const invoke = <T>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload) as Promise<T>;

const api: FolioApi = {
  listTree: () => invoke<TreeResponse>(IPC.treeList),
  readFile: (relPath: string) => invoke<FileReadResponse>(IPC.fileRead, { relPath }),
  readIndex: () => invoke<string>(IPC.fileReadIndex),
  writeFile: (relPath: string, body: string) =>
    invoke<FileInfo>(IPC.fileWrite, { relPath, body }),
  createFile: (folder: MemoryType, title: string, body: string) =>
    invoke<FileInfo>(IPC.fileCreate, { folder, title, body }),
  archiveFile: (relPath: string) => invoke<void>(IPC.fileArchive, { relPath }),
  showInFolder: (relPath: string) => invoke<void>(IPC.fileShowInFolder, { relPath }),

  listSources: () => invoke<SourceStatus[]>(IPC.sourcesList),
  installMcp: (adapterId: string) => invoke<InstallTarget[]>(IPC.mcpInstall, { adapterId }),
  uninstallMcp: (adapterId: string) =>
    invoke<InstallTarget[]>(IPC.mcpUninstall, { adapterId }),

  runSync: (opts?: { classify?: boolean }) => invoke<SyncReport>(IPC.syncRun, opts),
  listActivity: (limit?: number) => invoke<ActivityEntry[]>(IPC.activityList, { limit }),

  planOrganize: () => invoke<OrganizePlanResponse>(IPC.organizePlan),
  applyOrganize: (opIndexes: number[]) =>
    invoke<ApplyReport>(IPC.organizeApply, { opIndexes }),

  getSettings: () => invoke<Settings>(IPC.settingsGet),
  saveSettings: (patch: SettingsPatch, apiKey?: string) =>
    invoke<Settings>(IPC.settingsSave, { patch, apiKey }),

  getWatchStatus: () => invoke<WatchStatus>(IPC.watchStatus),
  setWatch: (enabled: boolean) => invoke<WatchStatus>(IPC.watchSet, { enabled }),

  onSyncDone(cb: (report: SyncReport) => void): () => void {
    const listener = (_event: IpcRendererEvent, report: SyncReport): void => {
      cb(report);
    };
    ipcRenderer.on(IPC.syncDone, listener);
    return () => {
      ipcRenderer.removeListener(IPC.syncDone, listener);
    };
  },
};

contextBridge.exposeInMainWorld('folio', api);
