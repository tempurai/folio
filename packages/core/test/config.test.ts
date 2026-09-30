import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureHome, loadConfig, patchConfig, saveConfig } from '../src/config.js';
import { resolvePaths } from '../src/paths.js';
import type { FolioPaths } from '../src/paths.js';

const ENV_KEYS = [
  'FOLIO_LLM_API_KEY',
  'FOLIO_LLM_BASE_URL',
  'FOLIO_LLM_MODEL',
] as const;

const savedEnv: Record<(typeof ENV_KEYS)[number], string | undefined> = {
  FOLIO_LLM_API_KEY: undefined,
  FOLIO_LLM_BASE_URL: undefined,
  FOLIO_LLM_MODEL: undefined,
};

function freshHome(): FolioPaths {
  return resolvePaths(mkdtempSync(join(tmpdir(), 'folio-config-')));
}

describe('config', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('配置文件缺失时返回完整默认值', () => {
    const config = loadConfig(freshHome());
    expect(config.llm.enabled).toBe(true);
    expect(config.llm.apiKey).toBeUndefined();
    expect(config.llm.baseURL).toBe('https://api.openai.com/v1');
    expect(config.llm.model).toBe('gpt-4o-mini');
    expect(config.llm.classifyOnSync).toBe(false);
    expect(config.sync.autoOrganize).toBe(false);
    expect(config.adapters).toEqual({});
  });

  it('字段缺失时用默认值补齐；适配器缺省视为 enabled', () => {
    const paths = freshHome();
    writeFileSync(
      paths.configFile,
      [
        '[llm]',
        'model = "my-model"',
        '',
        '[adapters.cursor]',
        'enabled = false',
        '',
        '[adapters.kimi-code]',
        '',
      ].join('\n'),
      'utf8',
    );
    const config = loadConfig(paths);
    expect(config.llm.model).toBe('my-model');
    expect(config.llm.enabled).toBe(true);
    expect(config.llm.baseURL).toBe('https://api.openai.com/v1');
    expect(config.sync.autoOrganize).toBe(false);
    expect(config.adapters.cursor).toEqual({ enabled: false });
    expect(config.adapters['kimi-code']).toEqual({ enabled: true });
  });

  it('ensureHome 建目录树 + 写默认配置；重复调用幂等且不覆盖已有配置', () => {
    const paths = freshHome();

    const first = ensureHome(paths);
    expect(first.created).toBe(true);
    expect(existsSync(paths.configFile)).toBe(true);
    for (const type of ['user', 'feedback', 'project', 'reference']) {
      expect(existsSync(join(paths.memoryDir, type))).toBe(true);
    }
    expect(existsSync(paths.stateDir)).toBe(true);
    expect(existsSync(paths.cacheDir)).toBe(true);
    expect(existsSync(paths.archiveDir)).toBe(true);

    // 默认模板本身可被 loadConfig 解析为默认值
    const template = readFileSync(paths.configFile, 'utf8');
    expect(template).toContain('folio 配置文件');
    expect(loadConfig(paths).llm.model).toBe('gpt-4o-mini');

    // 用户改过配置后，ensureHome 不得覆盖
    writeFileSync(paths.configFile, '# 用户手写配置\n', 'utf8');
    const second = ensureHome(paths);
    expect(second.created).toBe(false);
    expect(readFileSync(paths.configFile, 'utf8')).toBe('# 用户手写配置\n');
  });

  it('环境变量覆盖配置文件中的 llm 设置', () => {
    const paths = freshHome();
    writeFileSync(paths.configFile, '[llm]\nmodel = "file-model"\n', 'utf8');

    process.env.FOLIO_LLM_API_KEY = 'sk-from-env';
    process.env.FOLIO_LLM_BASE_URL = 'https://env.example.com/v1';
    process.env.FOLIO_LLM_MODEL = 'env-model';

    const config = loadConfig(paths);
    expect(config.llm.apiKey).toBe('sk-from-env');
    expect(config.llm.baseURL).toBe('https://env.example.com/v1');
    expect(config.llm.model).toBe('env-model');
  });

  it('FOLIO_HOME 环境变量参与路径解析，显式参数优先', () => {
    const envHome = mkdtempSync(join(tmpdir(), 'folio-envhome-'));
    const argHome = mkdtempSync(join(tmpdir(), 'folio-arghome-'));
    const saved = process.env.FOLIO_HOME;
    try {
      process.env.FOLIO_HOME = envHome;
      expect(resolvePaths().home).toBe(envHome);
      expect(resolvePaths(argHome).home).toBe(argHome);
      expect(resolvePaths().configFile).toBe(join(envHome, 'config.toml'));
      expect(resolvePaths().indexFile).toBe(join(envHome, 'memory', 'MEMORY.md'));
      expect(resolvePaths().stateFile).toBe(join(envHome, 'state', 'sync-state.json'));
    } finally {
      if (saved === undefined) delete process.env.FOLIO_HOME;
      else process.env.FOLIO_HOME = saved;
    }
  });

  describe('saveConfig / patchConfig', () => {
    it('saveConfig roundtrip：默认配置写回后再读保持一致，无 tmp 残留', () => {
      const paths = freshHome();
      const original = loadConfig(paths);
      saveConfig(paths, original);
      expect(loadConfig(paths)).toEqual(original);
      const text = readFileSync(paths.configFile, 'utf8');
      // 字段结构与 ensureHome 模板一致（注释不保留）
      expect(text).toContain('[llm]');
      expect(text).toContain('[sync]');
      expect(existsSync(`${paths.configFile}.tmp`)).toBe(false);
    });

    it('saveConfig 保留 apiKey 与 adapters 开关（含带短横线的适配器 id）', () => {
      const paths = freshHome();
      const config = loadConfig(paths);
      config.llm.apiKey = 'sk-test';
      config.llm.model = 'my-model';
      config.llm.classifyOnSync = true;
      config.sync.autoOrganize = true;
      config.adapters = { 'claude-code': { enabled: false }, cursor: { enabled: true } };
      saveConfig(paths, config);
      const text = readFileSync(paths.configFile, 'utf8');
      expect(text).toContain('apiKey = "sk-test"');
      expect(text).toContain('[adapters.claude-code]');
      expect(loadConfig(paths)).toEqual(config);
    });

    it('patchConfig 部分更新 llm 子对象不丢其他键，并持久化到文件', () => {
      const paths = freshHome();
      writeFileSync(
        paths.configFile,
        '[llm]\nmodel = "before"\napiKey = "sk-file"\n\n[sync]\nautoOrganize = true\n',
        'utf8',
      );
      const patched = patchConfig(paths, { llm: { model: 'after' } });
      expect(patched.llm.model).toBe('after');
      expect(patched.llm.apiKey).toBe('sk-file');
      expect(patched.llm.enabled).toBe(true);
      expect(patched.llm.baseURL).toBe('https://api.openai.com/v1');
      expect(patched.sync.autoOrganize).toBe(true);
      // 已写回文件
      expect(loadConfig(paths).llm.model).toBe('after');
    });

    it('patchConfig 深合并 adapters：新增条目不清空已有条目', () => {
      const paths = freshHome();
      patchConfig(paths, { adapters: { 'claude-code': { enabled: false } } });
      const patched = patchConfig(paths, { adapters: { cursor: { enabled: false } } });
      expect(patched.adapters).toEqual({
        'claude-code': { enabled: false },
        cursor: { enabled: false },
      });
      expect(loadConfig(paths).adapters.cursor).toEqual({ enabled: false });
    });

    it('patchConfig 中显式 undefined 的字段视为未提供', () => {
      const paths = freshHome();
      const patched = patchConfig(paths, { llm: { model: undefined, classifyOnSync: true } });
      expect(patched.llm.model).toBe('gpt-4o-mini');
      expect(patched.llm.classifyOnSync).toBe(true);
    });
  });
});
