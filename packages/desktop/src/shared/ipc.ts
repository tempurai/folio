import { z } from 'zod';
import type {
  ActivityEntry,
  ApplyReport,
  InstallTarget,
  MemoryType,
  OrganizePlan,
  SyncReport,
} from '@folio/core';

/**
 * 桌面端 IPC 契约：main / preload / renderer 三方共享。
 * 只允许 import type 引 core（渲染层打包时会被擦除），不得引入任何 Node/electron 运行时依赖。
 */

// renderer 侧也通过这些类型建模，统一从本文件 re-export（type-only，不产生运行时代码）
export type {
  ActivityEntry,
  ApplyReport,
  InstallTarget,
  MemoryType,
  OrganizePlan,
  SyncReport,
} from '@folio/core';

export const IPC = {
  treeList: 'tree:list',
  fileRead: 'file:read',
  fileReadIndex: 'file:readIndex',
  fileWrite: 'file:write',
  fileCreate: 'file:create',
  fileArchive: 'file:archive',
  fileShowInFolder: 'file:showInFolder',
  sourcesList: 'sources:list',
  mcpInstall: 'mcp:install',
  mcpUninstall: 'mcp:uninstall',
  syncRun: 'sync:run',
  activityList: 'activity:list',
  organizePlan: 'organize:plan',
  organizeApply: 'organize:apply',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  watchStatus: 'watch:status',
  watchSet: 'watch:set',
  /** main → renderer 事件：watch 触发的一次同步完成 */
  syncDone: 'sync-done',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

// ---------------------------------------------------------------------------
// 请求/响应类型（与 gui-mock 的数据形状对齐）

export interface FileInfo {
  folder: MemoryType;
  /** 文件名（不含目录），如 pnpm-preference-lt3a9x01.md */
  file: string;
  title: string;
  scope: string;
  /** 来源 harness id；desktop 自建为 'desktop' */
  src: string;
  /** 来源文件路径（可为空字符串） */
  from: string;
  /** 展示用时间 'MM-DD HH:mm'（本地时区） */
  updated: string;
  tags: string[];
}

export interface TreeFolder {
  folder: MemoryType;
  files: FileInfo[];
}

export interface TreeResponse {
  folders: TreeFolder[];
  counts: { total: number; byFolder: Record<MemoryType, number> };
}

export interface FileReadResponse {
  meta: FileInfo;
  body: string;
}

export interface SourceStatus {
  id: string;
  name: string;
  detected: boolean;
  importedCount: number;
  mcpRegistered: boolean;
  /** 该 harness 的 MCP 配置文件路径；不支持 MCP 时为 null */
  configPath: string | null;
}

/** 整理操作在 UI 上的展示行（st 语义同 git status：M 改 / R 移 / A 增 / ! 冲突） */
export interface OrganizeOpView {
  index: number;
  st: 'M' | 'R' | 'A' | '!';
  files: string;
  to: string | null;
  why: string;
}

/** core 的 OrganizePlan 附加展示行；ops 与 views 下标一一对应 */
export type OrganizePlanResponse = OrganizePlan & { views: OrganizeOpView[] };

export interface Settings {
  llm: {
    enabled: boolean;
    baseURL: string;
    model: string;
    hasApiKey: boolean;
    /** 掩码（如 sk-••••••••），永不下发明文 */
    apiKeyMasked: string | null;
    classifyOnSync: boolean;
  };
  adapters: Array<{ id: string; name: string; enabled: boolean }>;
  home: string;
}

export interface SettingsPatch {
  llm?: {
    enabled?: boolean;
    baseURL?: string;
    model?: string;
    classifyOnSync?: boolean;
  };
  adapters?: Array<{ id: string; enabled: boolean }>;
}

export interface WatchStatus {
  enabled: boolean;
  lastSyncAt?: string;
}

/** preload 通过 contextBridge 暴露给 renderer 的窄 API（纯数据进出） */
export interface FolioApi {
  listTree(): Promise<TreeResponse>;
  readFile(relPath: string): Promise<FileReadResponse>;
  readIndex(): Promise<string>;
  writeFile(relPath: string, body: string): Promise<FileInfo>;
  createFile(folder: MemoryType, title: string, body: string): Promise<FileInfo>;
  archiveFile(relPath: string): Promise<void>;
  showInFolder(relPath: string): Promise<void>;
  listSources(): Promise<SourceStatus[]>;
  installMcp(adapterId: string): Promise<InstallTarget[]>;
  uninstallMcp(adapterId: string): Promise<InstallTarget[]>;
  runSync(opts?: { classify?: boolean }): Promise<SyncReport>;
  listActivity(limit?: number): Promise<ActivityEntry[]>;
  planOrganize(): Promise<OrganizePlanResponse>;
  applyOrganize(opIndexes: number[]): Promise<ApplyReport>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: SettingsPatch, apiKey?: string): Promise<Settings>;
  getWatchStatus(): Promise<WatchStatus>;
  setWatch(enabled: boolean): Promise<WatchStatus>;
  /** 返回 unsubscribe（内部 removeListener），组件 cleanup 必须调用 */
  onSyncDone(cb: (report: SyncReport) => void): () => void;
}

// ---------------------------------------------------------------------------
// 请求载荷 zod schema（main 入口逐通道校验）

const memoryTypeReq = z.enum(['user', 'feedback', 'project', 'reference']);

/** memory/<type>/<file>.md：字符集不含 '/'，天然免疫路径穿越 */
const relPathReq = z
  .string()
  .regex(/^(user|feedback|project|reference)\/[\p{Letter}\p{Number}._-]+\.md$/u);

/** showInFolder 额外允许索引文件本身 */
const showableRelPathReq = z.union([relPathReq, z.literal('MEMORY.md')]);

const bodyReq = z.string().max(512 * 1024);

const adapterIdReq = z.string().regex(/^[a-z0-9-]{1,64}$/);

/** 无载荷通道：preload 不传第二参数，main 收到 undefined */
export const emptyReqSchema = z.undefined().optional();

export const fileReadReqSchema = z.strictObject({ relPath: relPathReq });

export const fileWriteReqSchema = z.strictObject({ relPath: relPathReq, body: bodyReq });

export const fileCreateReqSchema = z.strictObject({
  folder: memoryTypeReq,
  title: z.string().trim().min(1).max(200),
  body: bodyReq,
});

export const fileArchiveReqSchema = z.strictObject({ relPath: relPathReq });

export const fileShowReqSchema = z.strictObject({ relPath: showableRelPathReq });

export const mcpActionReqSchema = z.strictObject({ adapterId: adapterIdReq });

export const syncRunReqSchema = z
  .strictObject({ classify: z.boolean().optional() })
  .optional();

export const activityListReqSchema = z
  .strictObject({ limit: z.number().int().min(1).max(500).optional() })
  .optional();

export const organizeApplyReqSchema = z.strictObject({
  opIndexes: z.array(z.number().int().min(0).max(9999)).min(1).max(1000),
});

export const settingsPatchReqSchema = z.strictObject({
  llm: z
    .strictObject({
      enabled: z.boolean().optional(),
      baseURL: z.string().trim().min(1).max(500).url().optional(),
      model: z.string().trim().min(1).max(200).optional(),
      classifyOnSync: z.boolean().optional(),
    })
    .optional(),
  adapters: z
    .array(z.strictObject({ id: adapterIdReq, enabled: z.boolean() }))
    .max(50)
    .optional(),
});

export const settingsSaveReqSchema = z.strictObject({
  patch: settingsPatchReqSchema,
  /** 缺省保持不变；空字符串清除；其余走 safeStorage 加密落 secrets.json */
  apiKey: z.string().max(512).optional(),
});

export const watchSetReqSchema = z.strictObject({ enabled: z.boolean() });

export type FileReadReq = z.infer<typeof fileReadReqSchema>;
export type FileWriteReq = z.infer<typeof fileWriteReqSchema>;
export type FileCreateReq = z.infer<typeof fileCreateReqSchema>;
export type SettingsSaveReq = z.infer<typeof settingsSaveReqSchema>;
