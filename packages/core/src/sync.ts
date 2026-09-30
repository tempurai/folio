import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { HarnessAdapter } from './adapters/types.js';
import { ensureHome, loadConfig } from './config.js';
import { createLlmClient } from './llm.js';
import type { LlmClient } from './llm.js';
import { contentHash, memoryTypeSchema, normalizeContent } from './model.js';
import type { SyncState } from './model.js';
import { resolvePaths } from './paths.js';
import type { FolioPaths } from './paths.js';
import { SearchIndex } from './search.js';
import { MemoryStore } from './store.js';

export interface SyncEvent {
  kind:
    | 'adapter-start'
    | 'item-added'
    | 'item-updated'
    | 'item-skipped'
    | 'item-removed'
    | 'adapter-done'
    | 'adapter-error';
  adapterId: string;
  detail?: string;
}

export interface AdapterSyncReport {
  id: string;
  detected: boolean;
  added: number;
  updated: number;
  skipped: number;
  removed: number;
  errors: string[];
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  adapters: AdapterSyncReport[];
  /** 全局错误（例如同步状态文件损坏），不归属于任何单个 adapter */
  errors: string[];
}

export interface SyncOptions {
  home?: string;
  projectDirs?: string[];
  adapterIds?: string[];
  classify?: boolean;
  adapters?: HarnessAdapter[];
  onEvent?: (e: SyncEvent) => void;
  /** 同步触发来源，记入 activity.jsonl（缺省 'manual'，桌面端/watch 可传自己的标识） */
  trigger?: string;
}

/** 一次同步的活动摘要（state/activity.jsonl 中一行） */
export interface ActivityEntry {
  at: string;
  trigger: string;
  adapters: AdapterSyncReport[];
}

const sourceStateSchema = z.object({
  hash: z.string(),
  memoryId: z.string(),
  harnessId: z.string(),
  lastSyncAt: z.string(),
});

const syncStateSchema = z.object({
  version: z.literal(1),
  sources: z.record(z.string(), sourceStateSchema),
});

const classifyResultSchema = z.object({
  type: memoryTypeSchema,
  tags: z.array(z.string()).default([]),
  title: z.string().optional(),
});

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function emptyState(): SyncState {
  return { version: 1, sources: {} };
}

function loadSyncState(paths: FolioPaths): { state: SyncState; error: string | null } {
  if (!existsSync(paths.stateFile)) return { state: emptyState(), error: null };
  try {
    const parsed = syncStateSchema.parse(JSON.parse(readFileSync(paths.stateFile, 'utf8')));
    return { state: parsed, error: null };
  } catch (err) {
    return {
      state: emptyState(),
      error: `同步状态文件损坏，已从空状态重新开始：${paths.stateFile}（${errMsg(err)}）`,
    };
  }
}

function saveSyncState(paths: FolioPaths, state: SyncState): void {
  mkdirSync(paths.stateDir, { recursive: true });
  const tmp = `${paths.stateFile}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, paths.stateFile);
}

/** activity.jsonl 最多保留的行数，超出时截断保留最新 */
const ACTIVITY_MAX_LINES = 500;
const ACTIVITY_DEFAULT_LIMIT = 100;

const activityReportSchema = z.object({
  id: z.string(),
  detected: z.boolean(),
  added: z.number(),
  updated: z.number(),
  skipped: z.number(),
  removed: z.number(),
  errors: z.array(z.string()).default([]),
});

const activityEntrySchema = z.object({
  at: z.string(),
  trigger: z.string(),
  adapters: z.array(activityReportSchema),
});

function activityFile(paths: FolioPaths): string {
  return join(paths.stateDir, 'activity.jsonl');
}

function appendActivity(paths: FolioPaths, entry: ActivityEntry): void {
  mkdirSync(paths.stateDir, { recursive: true });
  const file = activityFile(paths);
  appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '');
  if (lines.length > ACTIVITY_MAX_LINES) {
    const kept = lines.slice(-ACTIVITY_MAX_LINES);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${kept.join('\n')}\n`, 'utf8');
    renameSync(tmp, file);
  }
}

/** 读取活动日志，最新在前；文件不存在返回 []，损坏行跳过 */
export function readActivity(paths: FolioPaths, opts?: { limit?: number }): ActivityEntry[] {
  const file = activityFile(paths);
  if (!existsSync(file)) return [];
  const limit = opts?.limit ?? ACTIVITY_DEFAULT_LIMIT;
  let lines: string[];
  try {
    lines = readFileSync(file, 'utf8').split('\n');
  } catch {
    return [];
  }
  const entries: ActivityEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = activityEntrySchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) entries.push(parsed.data);
    } catch {
      // 损坏行：跳过该行，不影响其他行
    }
  }
  return entries.reverse().slice(0, limit);
}

function extractJson(text: string, open: string, close: string): string {
  const stripped = text.replace(/```(?:json)?\s*|\s*```/g, '');
  const start = stripped.indexOf(open);
  const end = stripped.lastIndexOf(close);
  if (start === -1 || end === -1 || end < start) return stripped.trim();
  return stripped.slice(start, end + 1);
}

async function classifyMemory(
  llm: LlmClient,
  content: string,
): Promise<{ type: 'user' | 'feedback' | 'project' | 'reference'; tags: string[]; title?: string } | null> {
  const text = await llm.chat(
    [
      {
        role: 'system',
        content:
          '你是记忆分类助手。根据用户给出的记忆正文判断其类型、标签和标题。' +
          '只输出 JSON 对象，不要输出任何其他内容：' +
          '{"type":"user|feedback|project|reference","tags":["标签"],"title":"标题"}。',
      },
      { role: 'user', content: content.slice(0, 2000) },
    ],
    { maxTokens: 300, temperature: 0 },
  );
  const parsed = classifyResultSchema.safeParse(JSON.parse(extractJson(text, '{', '}')));
  return parsed.success ? parsed.data : null;
}

async function loadBuiltinAdapters(): Promise<HarnessAdapter[]> {
  try {
    const specifier = './adapters/index.js';
    const mod: unknown = await import(specifier);
    const candidate = mod as {
      adapters?: unknown;
      allAdapters?: unknown;
      default?: unknown;
    };
    const list = candidate.adapters ?? candidate.allAdapters ?? candidate.default;
    return Array.isArray(list) ? (list as HarnessAdapter[]) : [];
  } catch {
    return [];
  }
}

export async function runSync(opts: SyncOptions): Promise<SyncReport> {
  const paths = resolvePaths(opts.home);
  ensureHome(paths);
  const config = loadConfig(paths);
  const store = new MemoryStore(paths);
  store.init();

  const { state, error: stateError } = loadSyncState(paths);
  const topErrors: string[] = stateError ? [stateError] : [];

  let adapters = opts.adapters ?? (await loadBuiltinAdapters());
  if (opts.adapterIds !== undefined) {
    const allowed = new Set(opts.adapterIds);
    adapters = adapters.filter((adapter) => allowed.has(adapter.id));
  }
  adapters = adapters.filter((adapter) => config.adapters[adapter.id]?.enabled !== false);

  const llm = opts.classify === true ? createLlmClient(config) : null;
  const emit = (kind: SyncEvent['kind'], adapterId: string, detail?: string): void => {
    opts.onEvent?.({ kind, adapterId, detail });
  };

  const startedAt = new Date().toISOString();
  const reports: AdapterSyncReport[] = [];
  let changed = false;

  for (const adapter of adapters) {
    const report: AdapterSyncReport = {
      id: adapter.id,
      detected: false,
      added: 0,
      updated: 0,
      skipped: 0,
      removed: 0,
      errors: [],
    };
    reports.push(report);
    emit('adapter-start', adapter.id);
    try {
      report.detected = await adapter.detect();
      if (!report.detected) {
        emit('adapter-done', adapter.id, '未检测到该 harness，跳过');
        continue;
      }
      const items = await adapter.collect({ projectDirs: opts.projectDirs ?? [] });
      const seen = new Set<string>();
      for (const item of items) {
        seen.add(item.sourcePath);
        try {
          const now = new Date().toISOString();
          const content = normalizeContent(item.content);
          const hash = contentHash(content);
          const entry = state.sources[item.sourcePath];

          if (entry && entry.hash === hash) {
            entry.lastSyncAt = now;
            report.skipped++;
            emit('item-skipped', adapter.id, item.sourcePath);
            continue;
          }

          if (entry) {
            const existing = store.get(entry.memoryId);
            if (existing) {
              store.update(entry.memoryId, {
                content,
                ...(item.title !== undefined ? { title: item.title } : {}),
              });
              entry.hash = hash;
              entry.lastSyncAt = now;
              report.updated++;
              changed = true;
              emit('item-updated', adapter.id, entry.memoryId);
              continue;
            }
            // state 里记的记忆已不在库中：按新增处理并复用该条目
          }

          const duplicate = store.findByHash(hash, item.scope);
          if (duplicate) {
            state.sources[item.sourcePath] = {
              hash,
              memoryId: duplicate.id,
              harnessId: adapter.id,
              lastSyncAt: now,
            };
            report.skipped++;
            emit('item-skipped', adapter.id, `${item.sourcePath}（与 ${duplicate.id} 内容重复，仅建立链接）`);
            continue;
          }

          const { memory, created } = store.create({
            content,
            type: item.typeHint ?? 'reference',
            scope: item.scope,
            ...(item.title !== undefined ? { title: item.title } : {}),
            tags: [],
            source: { harness: adapter.id, path: item.sourcePath, importedAt: now },
          });
          state.sources[item.sourcePath] = {
            hash,
            memoryId: memory.id,
            harnessId: adapter.id,
            lastSyncAt: now,
          };
          if (!created) {
            report.skipped++;
            emit('item-skipped', adapter.id, item.sourcePath);
            continue;
          }
          report.added++;
          changed = true;
          emit('item-added', adapter.id, memory.id);

          if (llm) {
            try {
              const classified = await classifyMemory(llm, content);
              if (classified) {
                store.update(memory.id, {
                  type: classified.type,
                  tags: classified.tags,
                  ...(classified.title !== undefined ? { title: classified.title } : {}),
                });
              }
            } catch (err) {
              report.errors.push(`LLM 分类失败（${item.sourcePath}）：${errMsg(err)}`);
            }
          }
        } catch (err) {
          report.errors.push(`处理失败（${item.sourcePath}）：${errMsg(err)}`);
        }
      }

      for (const [sourcePath, entry] of Object.entries(state.sources)) {
        if (entry.harnessId !== adapter.id || seen.has(sourcePath)) continue;
        delete state.sources[sourcePath];
        report.removed++;
        emit('item-removed', adapter.id, sourcePath);
      }
      emit(
        'adapter-done',
        adapter.id,
        `added=${report.added} updated=${report.updated} skipped=${report.skipped} removed=${report.removed}`,
      );
    } catch (err) {
      report.errors.push(errMsg(err));
      emit('adapter-error', adapter.id, errMsg(err));
    }
  }

  saveSyncState(paths, state);

  if (changed) {
    store.rebuildIndex();
    const index = new SearchIndex();
    index.build(store.all());
    index.save(join(paths.cacheDir, 'search-index.json'));
  }

  const finishedAt = new Date().toISOString();
  try {
    appendActivity(paths, {
      at: finishedAt,
      trigger: opts.trigger ?? 'manual',
      adapters: reports,
    });
  } catch (err) {
    // 活动日志是附属产物，写失败不中断同步，降级为全局错误提示
    topErrors.push(`活动日志写入失败：${errMsg(err)}`);
  }

  return {
    startedAt,
    finishedAt,
    adapters: reports,
    errors: topErrors,
  };
}
