import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { z } from 'zod';
import { MEMORY_TYPES } from './model.js';
import type { TememoryPaths } from './paths.js';
import { join } from 'node:path';

export interface TememoryConfig {
  llm: {
    enabled: boolean;
    apiKey?: string;
    baseURL: string;
    model: string;
    classifyOnSync: boolean;
  };
  sync: {
    autoOrganize: boolean;
  };
  adapters: Record<string, { enabled: boolean }>;
}

const llmSchema = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().optional(),
  baseURL: z.string().default('https://api.openai.com/v1'),
  model: z.string().default('gpt-4o-mini'),
  classifyOnSync: z.boolean().default(false),
});

const syncSchema = z.object({
  autoOrganize: z.boolean().default(false),
});

const adapterSchema = z.object({
  enabled: z.boolean().default(true),
});

const configSchema = z.object({
  llm: llmSchema.prefault({}),
  sync: syncSchema.prefault({}),
  adapters: z.record(z.string(), adapterSchema).default({}),
});

const DEFAULT_CONFIG_TEMPLATE = `# tememory 配置文件
# 本文件由 tememory 自动生成。可手动编辑；环境变量优先级高于本文件：
#   TEMEMORY_LLM_API_KEY / TEMEMORY_LLM_BASE_URL / TEMEMORY_LLM_MODEL

[llm]
# 是否启用 LLM 辅助能力（记忆分类、自动整理等）
enabled = true
# LLM API Key。建议不要写进文件，改用环境变量 TEMEMORY_LLM_API_KEY
# apiKey = "sk-..."
# OpenAI 兼容接口的 Base URL
baseURL = "https://api.openai.com/v1"
# 默认使用的模型
model = "gpt-4o-mini"
# 同步时是否调用 LLM 自动为新记忆分类
classifyOnSync = false

[sync]
# 同步完成后是否自动整理记忆库（去重、合并、归档建议）
autoOrganize = false

# 各 harness 适配器的开关。缺省的适配器一律视为启用。
# 例如要关闭 Claude Code 适配器：
# [adapters.claude-code]
# enabled = false
`;

export function loadConfig(paths: TememoryPaths): TememoryConfig {
  let raw: unknown = {};
  if (existsSync(paths.configFile)) {
    raw = parseToml(readFileSync(paths.configFile, 'utf8'));
  }
  const config: TememoryConfig = configSchema.parse(raw);
  const apiKey = process.env.TEMEMORY_LLM_API_KEY;
  if (apiKey) config.llm.apiKey = apiKey;
  const baseURL = process.env.TEMEMORY_LLM_BASE_URL;
  if (baseURL) config.llm.baseURL = baseURL;
  const model = process.env.TEMEMORY_LLM_MODEL;
  if (model) config.llm.model = model;
  return config;
}

export function ensureHome(paths: TememoryPaths): { created: boolean } {
  mkdirSync(paths.home, { recursive: true });
  mkdirSync(paths.memoryDir, { recursive: true });
  for (const type of MEMORY_TYPES) {
    mkdirSync(join(paths.memoryDir, type), { recursive: true });
  }
  mkdirSync(paths.stateDir, { recursive: true });
  mkdirSync(paths.cacheDir, { recursive: true });
  mkdirSync(paths.archiveDir, { recursive: true });

  if (existsSync(paths.configFile)) {
    return { created: false };
  }
  writeFileSync(paths.configFile, DEFAULT_CONFIG_TEMPLATE, 'utf8');
  return { created: true };
}

/**
 * 把配置写回 config.toml（smol-toml 序列化，tmp+rename 原子写）。
 * 注意：序列化不保留原文件中的注释，注释会丢失；字段结构与 ensureHome
 * 的默认模板保持一致（[llm] / [sync] / [adapters.*]）。config 中的值
 * 原样落盘——若 llm.apiKey 来自环境变量覆盖（loadConfig 的行为），
 * 调用方需自行判断是否希望它写入文件。
 */
export function saveConfig(paths: TememoryPaths, config: TememoryConfig): void {
  const data = {
    llm: {
      enabled: config.llm.enabled,
      ...(config.llm.apiKey !== undefined ? { apiKey: config.llm.apiKey } : {}),
      baseURL: config.llm.baseURL,
      model: config.llm.model,
      classifyOnSync: config.llm.classifyOnSync,
    },
    sync: { autoOrganize: config.sync.autoOrganize },
    adapters: config.adapters,
  };
  mkdirSync(paths.home, { recursive: true });
  const tmp = `${paths.configFile}.tmp`;
  writeFileSync(tmp, stringifyToml(data), 'utf8');
  renameSync(tmp, paths.configFile);
}

/** patchConfig 用的深补丁：llm/sync 子对象可只给部分字段，缺省字段保持不变 */
export interface ConfigPatch {
  llm?: Partial<TememoryConfig['llm']>;
  sync?: Partial<TememoryConfig['sync']>;
  adapters?: Record<string, { enabled: boolean }>;
}

function withoutUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** loadConfig → 深合并 patch → saveConfig，返回合并后的新配置 */
export function patchConfig(paths: TememoryPaths, patch: ConfigPatch): TememoryConfig {
  const current = loadConfig(paths);
  const merged: TememoryConfig = {
    llm: { ...current.llm, ...withoutUndefined(patch.llm ?? {}) },
    sync: { ...current.sync, ...withoutUndefined(patch.sync ?? {}) },
    adapters: { ...current.adapters, ...patch.adapters },
  };
  saveConfig(paths, merged);
  return merged;
}
