import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { z } from 'zod';
import {
  SERVER_NAME,
  adapters,
  applyOrganize,
  createLlmClient,
  ensureHome,
  getAdapter,
  installMcpServer,
  loadConfig,
  MemoryStore,
  parseMemoryFile,
  patchConfig,
  planOrganize,
  readActivity,
  readMcpConfig,
  resolvePaths,
  runSync,
  slugify,
  uninstallMcpServer,
} from '@folio/core';
import type {
  ActivityEntry,
  ApplyReport,
  ConfigPatch,
  InstallTarget,
  Memory,
  MemoryMeta,
  MemoryType,
  OrganizeOp,
  OrganizePlan,
  SyncReport,
  FolioPaths,
} from '@folio/core';
import { MEMORY_TYPES } from '@folio/core';
import type {
  FileInfo,
  FileReadResponse,
  OrganizeOpView,
  OrganizePlanResponse,
  Settings,
  SettingsPatch,
  SourceStatus,
  TreeResponse,
  WatchStatus,
} from '../shared/ipc.js';

/**
 * API Key 加解密接口：生产由 safeStorage 实现（见 secrets.ts），测试注入假实现。
 * encrypt 返回 base64 文本，decrypt 还原。
 */
export interface SecretCipher {
  encrypt(plain: string): string;
  decrypt(encoded: string): string;
}

export interface ServicesOptions {
  home?: string;
  cipher: SecretCipher;
}

const secretsSchema = z.object({
  version: z.literal(1),
  llmApiKey: z.string().optional(),
});

const desktopStateSchema = z.object({
  version: z.literal(1),
  watchEnabled: z.boolean().default(false),
});

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 原子写 JSON（tmp + rename），与 core 的写法保持一致 */
function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, file);
}

function readJsonWith<T>(file: string, schema: z.ZodType<T>, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return schema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    // 损坏即降级为默认值，不阻断应用
    return fallback;
  }
}

/** 'MM-DD HH:mm'（本地时区），与 gui-mock 的 updated 格式一致 */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 与 store 内部 fileNameFor 保持一致：slug(title) + id 后 8 位 */
function fileNameFor(meta: MemoryMeta): string {
  const slug = slugify(meta.title) || 'untitled';
  return `${slug}-${meta.id.slice(-8)}.md`;
}

function toFileInfo(meta: MemoryMeta): FileInfo {
  return {
    folder: meta.type,
    file: fileNameFor(meta),
    title: meta.title,
    scope: meta.scope,
    src: meta.source.harness,
    from: meta.source.path ?? '',
    updated: fmtTime(meta.updated),
    tags: meta.tags,
  };
}

const REL_PATH_RE = /^(user|feedback|project|reference)\/[\p{Letter}\p{Number}._-]+\.md$/u;

function maskApiKey(key: string): string {
  return `${key.slice(0, Math.min(3, key.length))}${'•'.repeat(8)}`;
}

export interface DesktopServices {
  readonly paths: FolioPaths;
  listTree(): TreeResponse;
  readFile(relPath: string): FileReadResponse;
  readIndex(): string;
  writeFile(relPath: string, body: string): FileInfo;
  createFile(folder: MemoryType, title: string, body: string): FileInfo;
  archiveFile(relPath: string): void;
  absPathFor(relPath: string): string;
  listSources(): Promise<SourceStatus[]>;
  installMcp(adapterId: string): Promise<InstallTarget[]>;
  uninstallMcp(adapterId: string): Promise<InstallTarget[]>;
  runSync(opts?: { classify?: boolean }): Promise<SyncReport>;
  listActivity(limit?: number): ActivityEntry[];
  planOrganize(): Promise<OrganizePlanResponse>;
  applyOrganize(opIndexes: number[]): Promise<ApplyReport>;
  getSettings(): Settings;
  saveSettings(patch: SettingsPatch, apiKey?: string): Settings;
  getWatchStatus(): WatchStatus;
  setWatchEnabled(enabled: boolean): WatchStatus;
}

export function createServices(opts: ServicesOptions): DesktopServices {
  const paths = resolvePaths(opts.home);
  ensureHome(paths);
  const store = new MemoryStore(paths);
  store.init();
  if (!existsSync(paths.indexFile)) store.rebuildIndex();

  const secretsFile = join(paths.stateDir, 'secrets.json');
  const desktopStateFile = join(paths.stateDir, 'desktop.json');

  /** 最近一次整理计划（organize:apply 以此为基准按序号取操作） */
  let lastPlan: OrganizePlan | null = null;

  // ------------------------------------------------------------- secrets

  function readSecretKey(): string | null {
    const data = readJsonWith(secretsFile, secretsSchema, { version: 1 as const });
    if (!data.llmApiKey) return null;
    try {
      return opts.cipher.decrypt(data.llmApiKey);
    } catch {
      // 密文损坏或换了密钥环：当作未设置，不崩溃
      return null;
    }
  }

  function writeSecretKey(key: string): void {
    writeJsonAtomic(secretsFile, { version: 1, llmApiKey: opts.cipher.encrypt(key) });
  }

  function clearSecretKey(): void {
    if (existsSync(secretsFile)) rmSync(secretsFile);
  }

  /** 生效的 Key：secrets.json 优先，其次 config.toml / 环境变量（loadConfig 已合并） */
  function effectiveApiKey(): string | null {
    const secret = readSecretKey();
    if (secret) return secret;
    return loadConfig(paths).llm.apiKey ?? null;
  }

  /**
   * runSync 内部自行 loadConfig + createLlmClient，只认 config.toml / 环境变量。
   * 调用期间把 secrets 里的 Key 临时注入 env，结束后还原，绝不写入 config.toml。
   */
  async function withSecretEnv<T>(fn: () => Promise<T>): Promise<T> {
    const key = readSecretKey();
    if (!key) return fn();
    const prev = process.env.FOLIO_LLM_API_KEY;
    process.env.FOLIO_LLM_API_KEY = key;
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env.FOLIO_LLM_API_KEY;
      else process.env.FOLIO_LLM_API_KEY = prev;
    }
  }

  // ------------------------------------------------------------- helpers

  function assertRelPath(relPath: string): void {
    if (!REL_PATH_RE.test(relPath)) {
      throw new Error(`非法的记忆文件路径：${relPath}`);
    }
  }

  function readMemoryAt(relPath: string): Memory {
    assertRelPath(relPath);
    const abs = join(paths.memoryDir, relPath);
    if (!abs.startsWith(paths.memoryDir + sep) || !existsSync(abs)) {
      throw new Error(`文件不存在：${relPath}`);
    }
    try {
      return parseMemoryFile(readFileSync(abs, 'utf8'));
    } catch (err) {
      throw new Error(`文件解析失败（${relPath}）：${errMsg(err)}`);
    }
  }

  /** id → memory/<type>/<file>.md 映射（整理计划展示用） */
  function relPathById(): Map<string, string> {
    const map = new Map<string, string>();
    for (const meta of store.list()) {
      map.set(meta.id, `${meta.type}/${fileNameFor(meta)}`);
    }
    return map;
  }

  function opView(op: OrganizeOp, index: number, relOf: (id: string) => string): OrganizeOpView {
    switch (op.kind) {
      case 'merge': {
        const absorbed = op.absorbIds.map(relOf).join('、');
        return {
          index,
          st: 'M',
          files: relOf(op.keepId),
          to: null,
          why: absorbed ? `${op.reason}（并入：${absorbed}）` : op.reason,
        };
      }
      case 'retype': {
        const from = relOf(op.id);
        const base = from.split('/').pop() ?? from;
        return { index, st: 'R', files: from, to: `${op.type}/${base}`, why: op.reason };
      }
      case 'retag': {
        const tags = op.tags.map((t) => `#${t}`).join(' ') || '（清空标签）';
        return { index, st: 'M', files: relOf(op.id), to: null, why: `${op.reason}（标签：${tags}）` };
      }
      case 'conflict':
        return { index, st: '!', files: op.ids.map(relOf).join('  ↔  '), to: null, why: op.reason };
    }
  }

  function readWatchEnabled(): boolean {
    return readJsonWith(desktopStateFile, desktopStateSchema, { version: 1, watchEnabled: false })
      .watchEnabled;
  }

  // ------------------------------------------------------------- API

  return {
    paths,

    listTree(): TreeResponse {
      const byFolder = { user: 0, feedback: 0, project: 0, reference: 0 } as Record<
        MemoryType,
        number
      >;
      const folders = MEMORY_TYPES.map((type) => {
        const files = store.list({ type }).map(toFileInfo);
        byFolder[type] = files.length;
        return { folder: type, files };
      });
      const total = folders.reduce((n, f) => n + f.files.length, 0);
      return { folders, counts: { total, byFolder } };
    },

    readFile(relPath: string): FileReadResponse {
      const memory = readMemoryAt(relPath);
      return { meta: toFileInfo(memory), body: memory.content };
    },

    readIndex(): string {
      if (!existsSync(paths.indexFile)) store.rebuildIndex();
      return readFileSync(paths.indexFile, 'utf8');
    },

    writeFile(relPath: string, body: string): FileInfo {
      const memory = readMemoryAt(relPath);
      const updated = store.update(memory.id, { content: body });
      if (!updated) throw new Error(`文件不存在：${relPath}`);
      store.rebuildIndex();
      return toFileInfo(updated);
    },

    createFile(folder: MemoryType, title: string, body: string): FileInfo {
      const { memory } = store.create({
        content: body.trim() === '' ? `# ${title}\n` : body,
        type: folder,
        scope: 'global',
        title,
        tags: [],
        source: { harness: 'desktop', importedAt: new Date().toISOString() },
      });
      store.rebuildIndex();
      return toFileInfo(memory);
    },

    archiveFile(relPath: string): void {
      const memory = readMemoryAt(relPath);
      if (!store.archive(memory.id)) throw new Error(`归档失败，文件不存在：${relPath}`);
      store.rebuildIndex();
    },

    absPathFor(relPath: string): string {
      if (relPath === 'MEMORY.md') return paths.indexFile;
      assertRelPath(relPath);
      const abs = join(paths.memoryDir, relPath);
      if (!abs.startsWith(paths.memoryDir + sep)) {
        throw new Error(`非法的记忆文件路径：${relPath}`);
      }
      return abs;
    },

    async listSources(): Promise<SourceStatus[]> {
      // sync-state.json 只取 sources.<path>.harnessId 计数；损坏按空处理
      let sources: Record<string, { harnessId?: string }> = {};
      try {
        const raw: unknown = JSON.parse(readFileSync(paths.stateFile, 'utf8'));
        if (raw && typeof raw === 'object') {
          const candidate = (raw as { sources?: unknown }).sources;
          if (candidate && typeof candidate === 'object') {
            sources = candidate as Record<string, { harnessId?: string }>;
          }
        }
      } catch {
        sources = {};
      }
      const results: SourceStatus[] = [];
      for (const adapter of adapters) {
        const detected = await adapter.detect().catch(() => false);
        const importedCount = Object.values(sources).filter(
          (s) => s?.harnessId === adapter.id,
        ).length;
        let mcpRegistered = false;
        let configPath: string | null = null;
        if (adapter.mcp) {
          configPath = adapter.mcp.configPath();
          try {
            const parsed = readMcpConfig(adapter.mcp, configPath);
            mcpRegistered = Object.prototype.hasOwnProperty.call(
              adapter.mcp.getServers(parsed),
              SERVER_NAME,
            );
          } catch {
            mcpRegistered = false;
          }
        }
        results.push({ id: adapter.id, name: adapter.name, detected, importedCount, mcpRegistered, configPath });
      }
      return results;
    },

    async installMcp(adapterId: string): Promise<InstallTarget[]> {
      if (!getAdapter(adapterId)) throw new Error(`未知适配器：${adapterId}`);
      return installMcpServer({ adapterIds: [adapterId], all: true });
    },

    async uninstallMcp(adapterId: string): Promise<InstallTarget[]> {
      if (!getAdapter(adapterId)) throw new Error(`未知适配器：${adapterId}`);
      return uninstallMcpServer({ adapterIds: [adapterId], all: true });
    },

    async runSync(syncOpts?: { classify?: boolean }): Promise<SyncReport> {
      const config = loadConfig(paths);
      const classify = syncOpts?.classify ?? config.llm.classifyOnSync;
      return withSecretEnv(() =>
        runSync({ home: paths.home, projectDirs: [], trigger: 'manual', classify }),
      );
    },

    listActivity(limit?: number): ActivityEntry[] {
      return readActivity(paths, limit !== undefined ? { limit } : undefined);
    },

    async planOrganize(): Promise<OrganizePlanResponse> {
      const config = loadConfig(paths);
      const key = effectiveApiKey();
      if (key) config.llm.apiKey = key;
      const llm = createLlmClient(config);
      const plan = await planOrganize(store, llm);
      const relOf = (id: string): string => relPathById().get(id) ?? id;
      const views = plan.ops.map((op, index) => opView(op, index, relOf));
      lastPlan = plan;
      return { ...plan, views };
    },

    async applyOrganize(opIndexes: number[]): Promise<ApplyReport> {
      if (!lastPlan) throw new Error('请先生成整理计划，再应用操作');
      const unique = [...new Set(opIndexes)];
      for (const i of unique) {
        if (!Number.isInteger(i) || i < 0 || i >= lastPlan.ops.length) {
          throw new Error(`操作序号越界：${i}（共 ${lastPlan.ops.length} 项）`);
        }
      }
      const picked = new Set(unique);
      const subPlan: OrganizePlan = {
        ...lastPlan,
        ops: lastPlan.ops.filter((_, i) => picked.has(i)),
      };
      const report = await applyOrganize(store, subPlan);
      // 应用后计划即失效，渲染层需重新生成
      lastPlan = null;
      return report;
    },

    getSettings(): Settings {
      const config = loadConfig(paths);
      const key = effectiveApiKey();
      return {
        llm: {
          enabled: config.llm.enabled,
          baseURL: config.llm.baseURL,
          model: config.llm.model,
          hasApiKey: key !== null,
          apiKeyMasked: key !== null ? maskApiKey(key) : null,
          classifyOnSync: config.llm.classifyOnSync,
        },
        adapters: adapters.map((a) => ({
          id: a.id,
          name: a.name,
          enabled: config.adapters[a.id]?.enabled !== false,
        })),
        home: paths.home,
      };
    },

    saveSettings(patch: SettingsPatch, apiKey?: string): Settings {
      const configPatch: ConfigPatch = {};
      if (patch.llm) {
        const llm: NonNullable<ConfigPatch['llm']> = {};
        if (patch.llm.enabled !== undefined) llm.enabled = patch.llm.enabled;
        if (patch.llm.baseURL !== undefined) llm.baseURL = patch.llm.baseURL;
        if (patch.llm.model !== undefined) llm.model = patch.llm.model;
        if (patch.llm.classifyOnSync !== undefined) llm.classifyOnSync = patch.llm.classifyOnSync;
        configPatch.llm = llm;
      }
      if (patch.adapters) {
        const known = new Set(adapters.map((a) => a.id));
        for (const entry of patch.adapters) {
          if (!known.has(entry.id)) throw new Error(`未知适配器：${entry.id}`);
        }
        configPatch.adapters = Object.fromEntries(
          patch.adapters.map((entry) => [entry.id, { enabled: entry.enabled }]),
        );
      }
      // patchConfig 内部 loadConfig 会把 env 的 FOLIO_LLM_API_KEY 合并进配置，
      // 写回前临时摘掉，避免 env 里的 Key 被顺带落盘
      const prevEnv = process.env.FOLIO_LLM_API_KEY;
      delete process.env.FOLIO_LLM_API_KEY;
      try {
        patchConfig(paths, configPatch);
      } finally {
        if (prevEnv !== undefined) process.env.FOLIO_LLM_API_KEY = prevEnv;
      }
      if (apiKey !== undefined) {
        if (apiKey === '') clearSecretKey();
        else writeSecretKey(apiKey);
      }
      return this.getSettings();
    },

    getWatchStatus(): WatchStatus {
      const enabled = readWatchEnabled();
      const last = readActivity(paths, { limit: 1 })[0];
      const status: WatchStatus = { enabled };
      if (last) status.lastSyncAt = last.at;
      return status;
    },

    setWatchEnabled(enabled: boolean): WatchStatus {
      writeJsonAtomic(desktopStateFile, { version: 1, watchEnabled: enabled });
      return this.getWatchStatus();
    },
  };
}
