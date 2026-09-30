// UI 冒烟测试：playwright-core 驱动真实 Electron 窗口。
// 全用临时目录与 core 的 fixtures 伪造 harness home，不碰用户真实目录。
// 用法：pnpm --filter @folio/desktop ui-smoke
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const repoRoot = path.resolve(pkgDir, '../..');
const work = path.join(tmpdir(), 'folio-ui-smoke');
rmSync(work, { recursive: true, force: true });
const home = path.join(work, 'folio-home');
const homes = path.join(work, 'harness-homes');
const shots = path.join(work, 'shots');
mkdirSync(homes, { recursive: true });
mkdirSync(shots, { recursive: true });

const fixtures = path.join(repoRoot, 'packages/core/test/fixtures/adapters');
for (const id of ['claude-code', 'codex', 'cursor', 'kimi-code', 'zcode']) {
  cpSync(path.join(fixtures, id), path.join(homes, id), { recursive: true });
}

const env = {
  ...process.env,
  FOLIO_HOME: home,
  CLAUDE_CONFIG_DIR: path.join(homes, 'claude-code'),
  CODEX_HOME: path.join(homes, 'codex'),
  FOLIO_CURSOR_HOME: path.join(homes, 'cursor'),
  KIMI_CODE_HOME: path.join(homes, 'kimi-code'),
  FOLIO_ZCODE_HOME: path.join(homes, 'zcode'),
};
const executablePath = path.join(
  pkgDir,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
);

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  if (cond) console.log(`  ok  ${name}`);
  else console.error(`  FAIL ${name}${extra ? ` :: ${extra}` : ''}`);
}

console.log('[ui-smoke] 启动 Electron…');
const app = await electron.launch({
  executablePath,
  args: ['out/main/index.js'],
  cwd: pkgDir,
  env,
});
const page = await app.firstWindow();
page.on('pageerror', (e) => check(`渲染进程无异常`, false, String(e)));
await page.waitForSelector('text=记忆库', { timeout: 20000 });

// 1. preload bridge 完整
const fns = await page.evaluate(() => Object.keys(window.folio ?? {}));
check(
  'preload bridge 暴露窄 API',
  ['listTree', 'readIndex', 'runSync', 'getSettings', 'listSources', 'planOrganize', 'installMcp', 'createFile'].every((k) =>
    fns.includes(k),
  ),
  fns.join(','),
);

// 2. 全新记忆库为空
let tree = await page.evaluate(() => window.folio.listTree());
check('全新记忆库为空', tree.counts.total === 0, JSON.stringify(tree.counts));

// 3. 通过 IPC 触发同步（fixtures 五家 harness）
const report = await page.evaluate(() => window.folio.runSync());
const added = report.adapters.reduce((n, a) => n + a.added, 0);
const errs = report.adapters.reduce((n, a) => n + a.errors.length, 0);
check('同步导入 fixtures', added >= 5 && errs === 0, JSON.stringify(report.adapters.map((a) => [a.id, a.added, a.errors])));

// 4. 刷新后树有数据，截索引页
await page.reload();
await page.waitForSelector('text=记忆库', { timeout: 20000 });
await page.waitForTimeout(600);
tree = await page.evaluate(() => window.folio.listTree());
check('同步后文件树有数据', tree.counts.total === added, JSON.stringify(tree.counts));
await page.screenshot({ path: path.join(shots, '01-index.png') });

// 5. 打开一个记忆文件页
const firstFile = tree.folders.flatMap((f) => f.files)[0];
await page.locator('nav').getByText(firstFile.file, { exact: false }).first().click();
await page.waitForTimeout(400);
const mainText = await page.locator('main').textContent();
check('文件页渲染（面包屑+标题）', mainText.includes('memory') && mainText.includes(firstFile.title), firstFile.title);
await page.screenshot({ path: path.join(shots, '02-file.png') });

// 6. 来源页：5 家全部 detected
await page.locator('nav').getByText('来源').click();
await page.waitForTimeout(400);
const srcText = await page.locator('main').textContent();
const sources = await page.evaluate(() => window.folio.listSources());
check('来源：5 家全部检测到', sources.length === 5 && sources.every((s) => s.detected), JSON.stringify(sources.map((s) => [s.id, s.detected])));
check('来源页渲染五家名称', ['Claude Code', 'Codex', 'Cursor', 'Kimi Code', 'ZCode'].every((n) => srcText.includes(n)));
await page.screenshot({ path: path.join(shots, '03-sources.png') });

// 7. MCP 注册/注销（写到伪造的 cursor home）
await page.evaluate(() => window.folio.installMcp('cursor'));
const mcpFile = path.join(homes, 'cursor', 'mcp.json');
const mcpCfg = JSON.parse(readFileSync(mcpFile, 'utf8'));
check('installMcp 写入 cursor mcp.json', Boolean(mcpCfg.mcpServers?.folio?.command), JSON.stringify(mcpCfg).slice(0, 150));
await page.evaluate(() => window.folio.uninstallMcp('cursor'));
const mcpCfg2 = JSON.parse(readFileSync(mcpFile, 'utf8'));
check('uninstallMcp 移除条目', !mcpCfg2.mcpServers?.folio, JSON.stringify(mcpCfg2).slice(0, 150));

// 8. 整理计划（无 API Key → 本地查重兜底）
await page.locator('nav').getByText('整理').click();
await page.waitForTimeout(300);
const plan = await page.evaluate(() => window.folio.planOrganize());
check('整理计划（本地兜底）', Array.isArray(plan.ops) && plan.llmUsed === false, JSON.stringify({ ops: plan.ops?.length, llmUsed: plan.llmUsed }));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(shots, '04-organize.png') });

// 9. 设置：Key 加密存 secrets.json，不落 config.toml、不明文回传
const s1 = await page.evaluate(() => window.folio.getSettings());
check('settings:get 初始态', s1.home === home && s1.llm.hasApiKey === false, s1.home);
const s2 = await page.evaluate(() =>
  window.folio.saveSettings({ llm: { baseURL: 'https://example.test/v1' } }, 'sk-secret-test-123'),
);
check('settings:save 只回掩码', s2.llm.hasApiKey === true && !JSON.stringify(s2).includes('sk-secret-test-123'), JSON.stringify(s2.llm));
const cfgText = readFileSync(path.join(home, 'config.toml'), 'utf8');
check('config.toml 有 baseURL 且无 Key 明文', cfgText.includes('example.test') && !cfgText.includes('sk-secret-test-123'));
const secretsText = existsSync(path.join(home, 'state', 'secrets.json'))
  ? readFileSync(path.join(home, 'state', 'secrets.json'), 'utf8')
  : '';
check('secrets.json 存在且无 Key 明文', secretsText.length > 0 && !secretsText.includes('sk-secret-test-123'));
await page.locator('nav').getByText('设置').click();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(shots, '05-settings.png') });

// 10. 活动日志
const act = await page.evaluate(() => window.folio.listActivity());
check('活动日志有记录', act.length >= 1, String(act.length));
await page.locator('nav').getByText('活动').click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(shots, '06-activity.png') });

// 11. 新建 → 归档 一条记忆
const created = await page.evaluate(() =>
  window.folio.createFile('reference', 'UI 冒烟测试记忆', '这是通过 window.folio.createFile 创建的。'),
);
tree = await page.evaluate(() => window.folio.listTree());
check('createFile 出现在树中', tree.folders.flatMap((f) => f.files).some((f) => f.file === created.file), created.file);
await page.evaluate((rel) => window.folio.archiveFile(rel), `reference/${created.file}`);
tree = await page.evaluate(() => window.folio.listTree());
check('archiveFile 从树中移除', !tree.folders.flatMap((f) => f.files).some((f) => f.file === created.file));

await app.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n[ui-smoke] ${results.length - failed.length}/${results.length} 通过，截图在 ${shots}`);
process.exit(failed.length ? 1 : 0);
