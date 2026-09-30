import { ipcMain, shell } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import {
  IPC,
  activityListReqSchema,
  emptyReqSchema,
  fileArchiveReqSchema,
  fileCreateReqSchema,
  fileReadReqSchema,
  fileShowReqSchema,
  fileWriteReqSchema,
  mcpActionReqSchema,
  organizeApplyReqSchema,
  settingsSaveReqSchema,
  syncRunReqSchema,
  watchSetReqSchema,
} from '../shared/ipc.js';
import type { DesktopServices } from './services.js';
import type { MemoryWatcher } from './watch.js';

export interface IpcDeps {
  services: DesktopServices;
  watcher: MemoryWatcher;
  getWindow(): BrowserWindow | null;
  /** 校验 event.senderFrame.origin 是否自家 origin（dev: vite URL；prod: file://） */
  isAllowedSender(event: IpcMainInvokeEvent): boolean;
}

/**
 * 注册全部 ipcMain.handle。每个 handler 强制三件套：
 * sender origin 校验 → zod 载荷校验 → 调 services（只进纯数据，只出纯数据）。
 */
export function registerIpcHandlers(deps: IpcDeps): void {
  const { services, watcher } = deps;

  const handle = <S extends z.ZodTypeAny>(
    channel: string,
    schema: S,
    fn: (payload: z.infer<S>) => unknown,
  ): void => {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!deps.isAllowedSender(event)) {
        throw new Error(`拒绝来自非自家 origin 的调用：${channel}`);
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(
          `IPC 载荷校验失败（${channel}）：${issue ? `${issue.path.join('.')} ${issue.message}` : '格式错误'}`,
        );
      }
      return fn(parsed.data as z.infer<S>);
    });
  };

  handle(IPC.treeList, emptyReqSchema, () => services.listTree());
  handle(IPC.fileRead, fileReadReqSchema, (p) => services.readFile(p.relPath));
  handle(IPC.fileReadIndex, emptyReqSchema, () => services.readIndex());
  handle(IPC.fileWrite, fileWriteReqSchema, (p) => services.writeFile(p.relPath, p.body));
  handle(IPC.fileCreate, fileCreateReqSchema, (p) =>
    services.createFile(p.folder, p.title, p.body),
  );
  handle(IPC.fileArchive, fileArchiveReqSchema, (p) => services.archiveFile(p.relPath));
  handle(IPC.fileShowInFolder, fileShowReqSchema, (p) => {
    shell.showItemInFolder(services.absPathFor(p.relPath));
  });

  handle(IPC.sourcesList, emptyReqSchema, () => services.listSources());
  handle(IPC.mcpInstall, mcpActionReqSchema, (p) => services.installMcp(p.adapterId));
  handle(IPC.mcpUninstall, mcpActionReqSchema, (p) => services.uninstallMcp(p.adapterId));

  handle(IPC.syncRun, syncRunReqSchema, (p) => services.runSync(p ?? {}));
  handle(IPC.activityList, activityListReqSchema, (p) => services.listActivity(p?.limit));

  handle(IPC.organizePlan, emptyReqSchema, () => services.planOrganize());
  handle(IPC.organizeApply, organizeApplyReqSchema, (p) => services.applyOrganize(p.opIndexes));

  handle(IPC.settingsGet, emptyReqSchema, () => services.getSettings());
  handle(IPC.settingsSave, settingsSaveReqSchema, (p) => services.saveSettings(p.patch, p.apiKey));

  handle(IPC.watchStatus, emptyReqSchema, () => services.getWatchStatus());
  handle(IPC.watchSet, watchSetReqSchema, async (p) => {
    const status = services.setWatchEnabled(p.enabled);
    if (p.enabled) await watcher.start();
    else await watcher.stop();
    return status;
  });
}

/** watch 同步完成 → 推送渲染层（窗口已销毁则不再 send） */
export function forwardSyncDone(getWindow: () => BrowserWindow | null) {
  return (report: unknown): void => {
    const win = getWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(IPC.syncDone, report);
  };
}
