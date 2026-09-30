import { z } from 'zod';
import type { LlmClient } from './llm.js';
import { memoryTypeSchema } from './model.js';
import type { Memory, MemoryType } from './model.js';
import type { MemoryStore } from './store.js';

export type OrganizeOp =
  | { kind: 'merge'; keepId: string; absorbIds: string[]; reason: string }
  | { kind: 'retype'; id: string; type: MemoryType; reason: string }
  | { kind: 'retag'; id: string; tags: string[]; reason: string }
  | { kind: 'conflict'; ids: string[]; reason: string };

export interface OrganizePlan {
  generatedAt: string;
  ops: OrganizeOp[];
  llmUsed: boolean;
  notes: string[];
}

export interface ApplyReport {
  /** 被合并（归档）掉的记忆条数 */
  merged: number;
  retyped: number;
  retagged: number;
  conflictsMarked: number;
  errors: string[];
}

const organizeOpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('merge'),
    keepId: z.string().min(1),
    absorbIds: z.array(z.string().min(1)).min(1),
    reason: z.string(),
  }),
  z.object({
    kind: z.literal('retype'),
    id: z.string().min(1),
    type: memoryTypeSchema,
    reason: z.string(),
  }),
  z.object({
    kind: z.literal('retag'),
    id: z.string().min(1),
    tags: z.array(z.string()),
    reason: z.string(),
  }),
  z.object({
    kind: z.literal('conflict'),
    ids: z.array(z.string().min(1)).min(2),
    reason: z.string(),
  }),
]);

const SYSTEM_PROMPT = `你在整理一个个人记忆库。用户会发来一批记忆（JSON 数组），每条包含 id/type/scope/title/tags/content（content 仅截取前 200 字）。
请找出需要整理的问题，只输出一个 JSON 数组，不要输出任何解释或代码块标记。数组元素为以下四种操作之一：
- {"kind":"merge","keepId":"保留的记忆id","absorbIds":["被合并的记忆id"],"reason":"原因"}：内容重复或高度近似的记忆，合并到信息更全的一条
- {"kind":"retype","id":"记忆id","type":"user|feedback|project|reference","reason":"原因"}：类型归类不当（user=用户偏好与习惯，feedback=用户反馈与教训，project=项目状态与决策，reference=参考资料）
- {"kind":"retag","id":"记忆id","tags":["标签"],"reason":"原因"}：标签缺失或不准确，tags 为调整后的完整标签列表
- {"kind":"conflict","ids":["记忆id","记忆id"],"reason":"原因"}：内容互相矛盾的记忆，只做标记，不要合并
没有需要整理的内容时输出 []。所有 id 必须来自输入。`;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function extractJsonArray(text: string): string {
  const stripped = text.replace(/```(?:json)?\s*|\s*```/g, '');
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return stripped.trim();
  return stripped.slice(start, end + 1);
}

function summarize(memory: Memory): Record<string, unknown> {
  return {
    id: memory.id,
    type: memory.type,
    scope: memory.scope,
    title: memory.title,
    tags: memory.tags,
    content: memory.content.slice(0, 200),
  };
}

function opReferencedIds(op: OrganizeOp): string[] {
  switch (op.kind) {
    case 'merge':
      return [op.keepId, ...op.absorbIds];
    case 'retype':
    case 'retag':
      return [op.id];
    case 'conflict':
      return op.ids;
  }
}

function localDedupe(memories: Memory[]): OrganizeOp[] {
  const ops: OrganizeOp[] = [];
  const emitted = new Set<string>();
  const emitMerge = (group: Memory[], reason: string): void => {
    const [keep, ...rest] = group;
    const key = [keep.id, ...rest.map((m) => m.id).sort()].join('|');
    if (emitted.has(key)) return;
    emitted.add(key);
    ops.push({ kind: 'merge', keepId: keep.id, absorbIds: rest.map((m) => m.id), reason });
  };

  const byHash = new Map<string, Memory[]>();
  for (const memory of memories) {
    const group = byHash.get(memory.hash) ?? [];
    group.push(memory);
    byHash.set(memory.hash, group);
  }
  for (const group of byHash.values()) {
    const scopes = new Set(group.map((m) => m.scope));
    if (group.length > 1 && scopes.size > 1) {
      emitMerge(group, '内容 hash 相同但分散在不同 scope，疑似重复，建议合并');
    }
  }

  const byTitle = new Map<string, Memory[]>();
  for (const memory of memories) {
    if (!memory.title) continue;
    const group = byTitle.get(memory.title) ?? [];
    group.push(memory);
    byTitle.set(memory.title, group);
  }
  for (const [title, group] of byTitle) {
    if (group.length > 1) {
      emitMerge(group, `标题「${title}」完全相同，疑似重复，建议合并`);
    }
  }
  return ops;
}

export async function planOrganize(
  store: MemoryStore,
  llm: LlmClient | null,
  opts?: { batchSize?: number },
): Promise<OrganizePlan> {
  const memories = store.all();
  const notes: string[] = [];
  const ops: OrganizeOp[] = [];

  if (!llm) {
    ops.push(...localDedupe(memories));
    return { generatedAt: new Date().toISOString(), ops, llmUsed: false, notes };
  }

  const batchSize = Math.max(1, opts?.batchSize ?? 60);
  const knownIds = new Set(memories.map((m) => m.id));
  for (let start = 0; start < memories.length; start += batchSize) {
    const batchNo = Math.floor(start / batchSize) + 1;
    const batch = memories.slice(start, start + batchSize);
    let text: string;
    try {
      text = await llm.chat(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(batch.map(summarize)) },
        ],
        { maxTokens: 2000, temperature: 0 },
      );
    } catch (err) {
      notes.push(`第 ${batchNo} 批整理请求失败：${errMsg(err)}`);
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(extractJsonArray(text));
    } catch {
      notes.push(`第 ${batchNo} 批整理结果不是合法 JSON，已跳过`);
      continue;
    }
    if (!Array.isArray(raw)) {
      notes.push(`第 ${batchNo} 批整理结果不是 JSON 数组，已跳过`);
      continue;
    }
    for (const candidate of raw) {
      const parsed = organizeOpSchema.safeParse(candidate);
      if (!parsed.success) {
        notes.push(`非法操作已丢弃：${JSON.stringify(candidate)?.slice(0, 120) ?? 'null'}`);
        continue;
      }
      const op = parsed.data as OrganizeOp;
      const unknownIds = opReferencedIds(op).filter((id) => !knownIds.has(id));
      if (unknownIds.length > 0) {
        notes.push(`操作引用了不存在的记忆（${unknownIds.join(', ')}），已丢弃`);
        continue;
      }
      if (op.kind === 'merge' && op.absorbIds.includes(op.keepId)) {
        notes.push(`merge 操作的 keepId 不能出现在 absorbIds 中（${op.keepId}），已丢弃`);
        continue;
      }
      ops.push(op);
    }
  }

  return { generatedAt: new Date().toISOString(), ops, llmUsed: true, notes };
}

export async function applyOrganize(
  store: MemoryStore,
  plan: OrganizePlan,
): Promise<ApplyReport> {
  const report: ApplyReport = {
    merged: 0,
    retyped: 0,
    retagged: 0,
    conflictsMarked: 0,
    errors: [],
  };

  for (const op of plan.ops) {
    try {
      switch (op.kind) {
        case 'merge': {
          const keeper = store.get(op.keepId);
          if (!keeper) {
            report.errors.push(`merge：找不到要保留的记忆 ${op.keepId}`);
            break;
          }
          const parts: string[] = [];
          const absorbed: string[] = [];
          for (const absorbId of op.absorbIds) {
            if (absorbId === keeper.id) continue;
            const other = store.get(absorbId);
            if (!other) {
              report.errors.push(`merge：找不到要合并的记忆 ${absorbId}`);
              continue;
            }
            const origin = other.source.path ?? other.id;
            parts.push(`---\n来源: ${origin}\n\n${other.content.replace(/\n+$/, '')}`);
            absorbed.push(other.id);
          }
          if (absorbed.length === 0) break;
          const content = `${keeper.content.replace(/\n+$/, '')}\n\n${parts.join('\n\n')}\n`;
          const supersedes = [...new Set([...(keeper.supersedes ?? []), ...absorbed])];
          store.update(keeper.id, { content, supersedes });
          for (const id of absorbed) store.archive(id);
          report.merged += absorbed.length;
          break;
        }
        case 'retype': {
          const updated = store.update(op.id, { type: op.type });
          if (!updated) {
            report.errors.push(`retype：找不到记忆 ${op.id}`);
            break;
          }
          report.retyped++;
          break;
        }
        case 'retag': {
          const updated = store.update(op.id, { tags: op.tags });
          if (!updated) {
            report.errors.push(`retag：找不到记忆 ${op.id}`);
            break;
          }
          report.retagged++;
          break;
        }
        case 'conflict': {
          const ids = [...new Set(op.ids)];
          let found = 0;
          for (const id of ids) {
            const memory = store.get(id);
            if (!memory) {
              report.errors.push(`conflict：找不到记忆 ${id}`);
              continue;
            }
            const conflictsWith = [
              ...new Set([...(memory.conflictsWith ?? []), ...ids.filter((x) => x !== id)]),
            ];
            store.update(id, { conflictsWith });
            found++;
          }
          if (found > 0) report.conflictsMarked++;
          break;
        }
      }
    } catch (err) {
      report.errors.push(`${op.kind} 操作失败：${errMsg(err)}`);
    }
  }

  store.rebuildIndex();
  return report;
}
