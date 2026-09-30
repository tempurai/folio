import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { adapters, createLlmClient, loadConfig, MEMORY_TYPES, readMcpConfig, SERVER_NAME } from '@tememory/core';
import type { TememoryConfig } from '@tememory/core';
import { errMsg, globalsOf, openStore, printJson } from '../common.js';

type Status = 'ok' | 'warn' | 'error';

interface DoctorItem {
  name: string;
  status: Status;
  detail: string;
}

const SYMBOL: Record<Status, string> = { ok: '✅', warn: '⚠️', error: '❌' };

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('体检：主目录 / 配置 / 各适配器 / 记忆库 / 搜索索引，逐项给出 ✅/⚠️/❌')
    .option('--check-llm', '额外探测 LLM 连通性（会发起一次真实 API 请求）')
    .action(async (opts: { checkLlm?: boolean }, cmd: Command) => {
      const g = globalsOf(cmd);
      const { paths, store } = openStore(g.home);
      const items: DoctorItem[] = [];

      // ① 主目录与磁盘可写性
      if (!existsSync(paths.home)) {
        items.push({
          name: '主目录',
          status: 'warn',
          detail: `${paths.home} 不存在，运行 tememory init 创建`,
        });
      } else {
        const probe = join(paths.home, '.tememory-write-probe');
        try {
          writeFileSync(probe, '', 'utf8');
          rmSync(probe);
          items.push({ name: '主目录', status: 'ok', detail: `${paths.home}（可写）` });
        } catch (err) {
          items.push({
            name: '主目录',
            status: 'error',
            detail: `${paths.home} 不可写：${errMsg(err)}`,
          });
        }
      }

      // ② 配置文件合法性
      let config: TememoryConfig | null = null;
      if (!existsSync(paths.configFile)) {
        items.push({
          name: '配置文件',
          status: 'warn',
          detail: `${paths.configFile} 不存在，运行 tememory init 生成默认配置`,
        });
      } else {
        try {
          config = loadConfig(paths);
          items.push({ name: '配置文件', status: 'ok', detail: `${paths.configFile}（合法）` });
        } catch (err) {
          items.push({
            name: '配置文件',
            status: 'error',
            detail: `${paths.configFile} 解析失败：${errMsg(err)}`,
          });
        }
      }

      // ③ 各适配器：detect / collect 条目数 / MCP 注册情况
      for (const adapter of adapters) {
        let detected = false;
        try {
          detected = await adapter.detect();
        } catch {
          detected = false;
        }
        if (!detected) {
          items.push({
            name: `适配器 ${adapter.id}`,
            status: 'warn',
            detail: '未检测到（harness 未安装或 home 目录不存在）',
          });
          continue;
        }
        try {
          const collected = await adapter.collect({ projectDirs: [process.cwd()] });
          let detail = `已检测到，收集到 ${collected.length} 条记忆`;
          if (adapter.mcp) {
            const file = adapter.mcp.configPath();
            if (!existsSync(file)) {
              detail += `；MCP 配置 ${file} 不存在（未注册）`;
            } else {
              let registered = false;
              let parseFailed = false;
              try {
                const parsed = readMcpConfig(adapter.mcp, file);
                registered = Object.prototype.hasOwnProperty.call(
                  adapter.mcp.getServers(parsed),
                  SERVER_NAME,
                );
              } catch {
                parseFailed = true;
              }
              detail += parseFailed
                ? `；MCP 配置 ${file} 存在但解析失败`
                : `；MCP 配置 ${file} ${registered ? '已注册 tememory' : '存在，未注册 tememory'}`;
            }
          }
          items.push({ name: `适配器 ${adapter.id}`, status: 'ok', detail });
        } catch (err) {
          items.push({
            name: `适配器 ${adapter.id}`,
            status: 'error',
            detail: `收集失败：${errMsg(err)}`,
          });
        }
      }

      // ④ 记忆库统计
      try {
        const metas = store.list();
        const parts = MEMORY_TYPES.map(
          (t) => `${t} ${metas.filter((m) => m.type === t).length}`,
        );
        items.push({ name: '记忆库', status: 'ok', detail: `共 ${metas.length} 条（${parts.join(' · ')}）` });
      } catch (err) {
        items.push({ name: '记忆库', status: 'error', detail: `读取失败：${errMsg(err)}` });
      }

      // ⑤ 搜索索引状态
      const indexFile = join(paths.cacheDir, 'search-index.json');
      if (!existsSync(indexFile)) {
        items.push({
          name: '搜索索引',
          status: 'warn',
          detail: '尚未建立（运行 tememory sync 生成）',
        });
      } else {
        try {
          const raw = JSON.parse(readFileSync(indexFile, 'utf8')) as {
            docs?: Record<string, unknown>;
          };
          const count = raw.docs !== undefined ? Object.keys(raw.docs).length : 0;
          items.push({
            name: '搜索索引',
            status: 'ok',
            detail: `已建立，覆盖 ${count} 条记忆（${indexFile}）`,
          });
        } catch (err) {
          items.push({ name: '搜索索引', status: 'error', detail: `缓存文件损坏：${errMsg(err)}` });
        }
      }

      // ⑥ LLM 连通性（可选）
      if (opts.checkLlm === true) {
        if (!config) {
          items.push({ name: 'LLM', status: 'error', detail: '配置文件不可用，无法初始化 LLM 客户端' });
        } else {
          const llm = createLlmClient(config);
          if (!llm) {
            items.push({
              name: 'LLM',
              status: 'warn',
              detail: '未配置（缺少 API Key 或已禁用），LLM 相关能力不可用',
            });
          } else {
            const reachable = await llm.ping();
            items.push(
              reachable
                ? {
                    name: 'LLM',
                    status: 'ok',
                    detail: `连接正常（${config.llm.baseURL}，模型 ${config.llm.model}）`,
                  }
                : {
                    name: 'LLM',
                    status: 'error',
                    detail: `无法连接 ${config.llm.baseURL}（模型 ${config.llm.model}）`,
                  },
            );
          }
        }
      }

      const summary = {
        ok: items.filter((i) => i.status === 'ok').length,
        warn: items.filter((i) => i.status === 'warn').length,
        error: items.filter((i) => i.status === 'error').length,
      };
      if (g.json) {
        printJson({ home: paths.home, items, summary });
        return;
      }
      for (const item of items) {
        console.log(`${SYMBOL[item.status]} ${item.name}：${item.detail}`);
      }
      console.log(`共 ${items.length} 项：${summary.ok} 正常 / ${summary.warn} 警告 / ${summary.error} 错误`);
    });
}
