import { join } from 'node:path';
import type { Command } from 'commander';
import {
  ensureHome,
  MEMORY_TYPES,
  MemoryStore,
  resolvePaths,
  SearchIndex,
} from '@folio/core';
import {
  findMemory,
  formatTime,
  globalsOf,
  makeSnippet,
  openStore,
  parseCount,
  parseType,
  printJson,
  renderTable,
  truncate,
} from '../common.js';

interface ListOpts {
  type?: string;
  scope?: string;
  limit?: string;
  archived?: boolean;
}

interface SearchOpts {
  type?: string;
  scope?: string;
  limit?: string;
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('初始化 folio 主目录（创建目录结构与默认配置文件）')
    .action((_opts: Record<string, never>, cmd: Command) => {
      const g = globalsOf(cmd);
      const paths = resolvePaths(g.home);
      const { created } = ensureHome(paths);
      const store = new MemoryStore(paths);
      store.init();
      if (g.json) {
        printJson({ home: paths.home, created });
        return;
      }
      console.log(
        created ? `已创建 folio 主目录：${paths.home}` : `主目录已存在：${paths.home}`,
      );
      console.log(`  配置文件：${paths.configFile}${created ? '（已生成默认配置）' : ''}`);
      console.log(`  记忆目录：${paths.memoryDir}`);
    });
}

export function registerList(program: Command): void {
  program
    .command('list')
    .description('列出记忆库中的记忆（id / 类型 / 作用域 / 标题 / 标签 / 更新时间）')
    .option('--type <type>', `按类型过滤（${MEMORY_TYPES.join('/')}）`)
    .option('--scope <scope>', '按作用域过滤（如 global、project:xxx）')
    .option('--limit <n>', '最多列出的条数')
    .option('--archived', '列出已归档的记忆')
    .action((opts: ListOpts, cmd: Command) => {
      const g = globalsOf(cmd);
      const type = opts.type !== undefined ? parseType(opts.type) : undefined;
      const limit = opts.limit !== undefined ? parseCount(opts.limit, '--limit') : undefined;
      const { store } = openStore(g.home);
      let metas = store.list({ type, scope: opts.scope, archived: opts.archived === true });
      const total = metas.length;
      if (limit !== undefined) metas = metas.slice(0, limit);
      if (g.json) {
        printJson(metas);
        return;
      }
      if (metas.length === 0) {
        console.log('（没有符合条件的记忆）');
        return;
      }
      console.log(
        renderTable(
          ['ID', '类型', '作用域', '标题', '标签', '更新时间'],
          metas.map((m) => [
            m.id.slice(0, 12),
            m.type,
            m.scope,
            truncate(m.title, 30),
            m.tags.join(','),
            formatTime(m.updated),
          ]),
        ),
      );
      if (metas.length < total) {
        console.log(`（共 ${total} 条，按 --limit 只显示前 ${metas.length} 条）`);
      }
    });
}

export function registerSearch(program: Command): void {
  program
    .command('search')
    .description('在记忆库中全文检索，输出命中条目与首个命中行摘要')
    .argument('<query>', '检索词，支持中文与英文')
    .option('--type <type>', `按类型过滤（${MEMORY_TYPES.join('/')}）`)
    .option('--scope <scope>', '按作用域过滤')
    .option('--limit <n>', '返回条数上限，默认 20')
    .action((query: string, opts: SearchOpts, cmd: Command) => {
      const g = globalsOf(cmd);
      const type = opts.type !== undefined ? parseType(opts.type) : undefined;
      const limit = opts.limit !== undefined ? parseCount(opts.limit, '--limit') : undefined;
      const { paths, store } = openStore(g.home);
      const cacheFile = join(paths.cacheDir, 'search-index.json');
      let index = SearchIndex.load(cacheFile);
      let fromCache = true;
      if (!index) {
        index = new SearchIndex();
        index.build(store.all());
        fromCache = false;
      }
      const hits = index.search(query, { type, scope: opts.scope, limit });
      const results: Array<{
        id: string;
        score: number;
        type: string;
        scope: string;
        title: string;
        snippet: string;
      }> = [];
      for (const hit of hits) {
        const memory = store.get(hit.id);
        if (!memory) continue;
        results.push({
          id: memory.id,
          score: hit.score,
          type: memory.type,
          scope: memory.scope,
          title: memory.title,
          snippet: makeSnippet(memory.content, query),
        });
      }
      if (g.json) {
        printJson(results);
        return;
      }
      if (results.length === 0) {
        console.log(`没有找到与「${query}」相关的记忆。`);
        return;
      }
      if (!fromCache) {
        console.log('（搜索索引缓存不存在，已临时重建；运行 folio sync 可刷新缓存）');
      }
      for (const r of results) {
        console.log(`${r.id.slice(0, 12)}  [${r.score}]  ${r.title}（${r.type} · ${r.scope}）`);
        if (r.snippet) console.log(`    ${r.snippet}`);
      }
    });
}

export function registerShow(program: Command): void {
  program
    .command('show')
    .description('显示一条记忆的完整 frontmatter 字段与正文')
    .argument('<id>', '记忆 id 或其唯一前缀')
    .action((idArg: string, _opts: Record<string, never>, cmd: Command) => {
      const g = globalsOf(cmd);
      const { store } = openStore(g.home);
      const memory = findMemory(store, idArg);
      if (!memory) throw new Error(`找不到记忆：${idArg}`);
      if (g.json) {
        printJson(memory);
        return;
      }
      const fields: Array<[string, string]> = [
        ['id', memory.id],
        ['type', memory.type],
        ['scope', memory.scope],
        ['title', memory.title],
        ['tags', memory.tags.length > 0 ? memory.tags.join(', ') : '（无）'],
        ['source.harness', memory.source.harness],
      ];
      if (memory.source.path !== undefined) fields.push(['source.path', memory.source.path]);
      fields.push(['source.importedAt', memory.source.importedAt]);
      fields.push(['hash', memory.hash]);
      fields.push(['created', memory.created]);
      fields.push(['updated', memory.updated]);
      if (memory.supersedes && memory.supersedes.length > 0) {
        fields.push(['supersedes', memory.supersedes.join(', ')]);
      }
      if (memory.conflictsWith && memory.conflictsWith.length > 0) {
        fields.push(['conflictsWith', memory.conflictsWith.join(', ')]);
      }
      if (memory.archived === true) fields.push(['archived', 'true']);
      for (const [key, value] of fields) console.log(`${key}: ${value}`);
      console.log('---');
      process.stdout.write(memory.content.endsWith('\n') ? memory.content : `${memory.content}\n`);
    });
}

export function registerConflicts(program: Command): void {
  program
    .command('conflicts')
    .description('列出所有 frontmatter 标记了 conflictsWith 的冲突记忆对')
    .action((_opts: Record<string, never>, cmd: Command) => {
      const g = globalsOf(cmd);
      const { store } = openStore(g.home);
      const seen = new Set<string>();
      const pairs: Array<{ ids: [string, string]; titles: [string, string | null] }> = [];
      for (const memory of store.all()) {
        for (const otherId of memory.conflictsWith ?? []) {
          const key = [memory.id, otherId].sort().join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          const other = store.get(otherId);
          pairs.push({
            ids: [memory.id, otherId],
            titles: [memory.title, other?.title ?? null],
          });
        }
      }
      if (g.json) {
        printJson(pairs);
        return;
      }
      if (pairs.length === 0) {
        console.log('没有标记冲突的记忆。');
        return;
      }
      console.log(`共 ${pairs.length} 对冲突记忆：`);
      for (const pair of pairs) {
        const [a, b] = pair.ids;
        const [titleA, titleB] = pair.titles;
        const other = titleB === null ? `${b.slice(0, 12)}（目标已不存在）` : `${b.slice(0, 12)}「${titleB}」`;
        console.log(`  • ${a.slice(0, 12)}「${titleA}」 ↔ ${other}`);
      }
    });
}

function sortedEntries(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function registerStats(program: Command): void {
  program
    .command('stats')
    .description('记忆库统计：按类型 / 作用域 / 来源 harness 分组计数')
    .action((_opts: Record<string, never>, cmd: Command) => {
      const g = globalsOf(cmd);
      const { store } = openStore(g.home);
      const metas = store.list();
      const byType = new Map<string, number>(MEMORY_TYPES.map((t) => [t, 0]));
      const byScope = new Map<string, number>();
      const byHarness = new Map<string, number>();
      for (const m of metas) {
        byType.set(m.type, (byType.get(m.type) ?? 0) + 1);
        byScope.set(m.scope, (byScope.get(m.scope) ?? 0) + 1);
        byHarness.set(m.source.harness, (byHarness.get(m.source.harness) ?? 0) + 1);
      }
      const scopeRows = sortedEntries(byScope);
      const harnessRows = sortedEntries(byHarness);
      if (g.json) {
        printJson({
          total: metas.length,
          byType: Object.fromEntries(byType),
          byScope: Object.fromEntries(scopeRows),
          byHarness: Object.fromEntries(harnessRows),
        });
        return;
      }
      console.log(`记忆总数：${metas.length}`);
      console.log('');
      console.log('按类型：');
      console.log(
        renderTable(
          ['类型', '数量'],
          MEMORY_TYPES.map((t) => [t, String(byType.get(t) ?? 0)]),
        ),
      );
      console.log('');
      console.log('按作用域：');
      console.log(
        scopeRows.length > 0
          ? renderTable(['作用域', '数量'], scopeRows.map(([k, v]) => [k, String(v)]))
          : '（无）',
      );
      console.log('');
      console.log('按来源 harness：');
      console.log(
        harnessRows.length > 0
          ? renderTable(['harness', '数量'], harnessRows.map(([k, v]) => [k, String(v)]))
          : '（无）',
      );
    });
}
