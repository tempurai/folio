#!/usr/bin/env bash
# tememory 容器端到端验证脚本（仅运行于 docker/Dockerfile 构建的镜像内，不碰宿主机）。
# 流程：伪造 5 家 harness 的 home（走默认路径，不用 env 覆盖）→ init →
# sync（首轮导入 / 幂等 / 更新 / 删除）→ list/search/show/stats/conflicts/organize/doctor →
# install/uninstall 五家 MCP 配置 → MCP stdio 冒烟。任何断言失败即非零退出。
set -euo pipefail

CLI=(node /workspace/packages/cli/dist/cli.js)
PROJ=/tmp/workspace/proj-demo
WORK=/tmp/e2e/out

export TEMEMORY_HOME=/tmp/e2e/tememory
export HOME=/tmp/e2e/home

step_no=0
step() { step_no=$((step_no + 1)); echo; echo "========== 步骤 ${step_no}：$1 =========="; }
ok() { echo "  ✔ $1"; }
fail() { echo; echo "❌ E2E 失败：$1" >&2; exit 1; }
need_file() { [ -f "$1" ] || fail "文件不存在：$1"; }
need_dir() { [ -d "$1" ] || fail "目录不存在：$1"; }
need_grep() { grep -qF -- "$2" "$1" || fail "在 $1 中未找到期望内容：$2"; }
need_no_grep() { ! grep -qF -- "$2" "$1" || fail "在 $1 中出现了不该有的内容：$2"; }

mkdir -p "$WORK"

# ---------------------------------------------------------------------------
step "运行环境自检"
node --version
"${CLI[@]}" --version > /dev/null || fail "CLI 无法执行"
ok "node 与 CLI 可执行（$("${CLI[@]}" --version)）"
if [ -f /opt/harness-report.txt ]; then
  echo "  真实 harness CLI 安装报告（仅存在性验证，不登录不运行）："
  grep -E '^(=====|STATUS)' /opt/harness-report.txt | sed 's/^/    /' || true
fi

# ---------------------------------------------------------------------------
step "准备隔离环境（TEMEMORY_HOME=$TEMEMORY_HOME，HOME=$HOME）"
mkdir -p "$PROJ" "$HOME" "$TEMEMORY_HOME"
cd "$PROJ"
ok "工作目录 $(pwd)"

# ---------------------------------------------------------------------------
step "播种 5 家 harness 的记忆源（内容互不重复，便于搜索与计数断言）"

# --- Claude Code：全局指令 + 全局 rules + 项目 memory（MEMORY.md 索引应被跳过）---
mkdir -p "$HOME/.claude/rules" "$HOME/.claude/projects/-tmp-workspace-proj-demo/memory"
cat > "$HOME/.claude/CLAUDE.md" <<'EOF'
# 用户全局指令

我喜欢用 pnpm 而不是 npm 来管理依赖。
回复请一律使用简体中文。
EOF
cat > "$HOME/.claude/rules/code-style.md" <<'EOF'
# 代码风格规则

缩进统一两个空格，字符串使用单引号，文件末尾保留一个空行。
EOF
cat > "$HOME/.claude/projects/-tmp-workspace-proj-demo/memory/MEMORY.md" <<'EOF'
# 记忆索引

- [测试前先构建](feedback_testing.md)
EOF
cat > "$HOME/.claude/projects/-tmp-workspace-proj-demo/memory/feedback_testing.md" <<'EOF'
---
type: feedback
title: 测试前先构建
---

跑测试必须先 build，否则 dist 里的旧代码会让测试结果失真。
EOF

# --- Codex：全局指令 + memories/（带 project frontmatter 归为项目级）---
mkdir -p "$HOME/.codex/memories"
cat > "$HOME/.codex/AGENTS.md" <<'EOF'
# Codex 全局指令

提交信息一律用英文动词开头，一句话说清楚改动。
EOF
cat > "$HOME/.codex/memories/preference.md" <<'EOF'
---
type: user
project: proj-demo
---

评审代码时优先看错误处理路径，而不是主流程。
EOF

# --- Cursor（GUI，无 headless 安装，按文档布局伪造）：全局 rules + 项目 rules ---
mkdir -p "$HOME/.cursor/rules" "$PROJ/.cursor/rules"
cat > "$HOME/.cursor/rules/global.mdc" <<'EOF'
---
description: 全局通用的 Cursor 规则
globs: "**/*"
alwaysApply: true
---

所有生成的代码注释一律使用中文。
EOF
cat > "$PROJ/.cursor/rules/react.mdc" <<'EOF'
---
description: React 项目规则
globs: "src/**/*.tsx"
alwaysApply: false
---

组件一律使用函数组件加 Hooks，禁止类组件。
EOF

# --- Kimi Code：全局指令 + memories/<proj>/ ---
mkdir -p "$HOME/.kimi-code/memories/proj-demo"
cat > "$HOME/.kimi-code/AGENTS.md" <<'EOF'
# Kimi Code 全局指令

重构前先列出受影响的文件清单，再动手修改。
EOF
cat > "$HOME/.kimi-code/memories/proj-demo/note.md" <<'EOF'
---
type: project
---

proj-demo 的构建产物输出到 dist 目录，部署前记得先清理。
EOF

# --- ZCode（桌面 ADE，无 headless 安装，按文档布局伪造）：全局指令 + cli/memories/projects/ ---
mkdir -p "$HOME/.zcode/cli/memories/projects/proj-demo/memory"
cat > "$HOME/.zcode/AGENTS.md" <<'EOF'
# ZCode 全局指令

数据库迁移脚本必须可以重复执行，做到幂等。
EOF
cat > "$HOME/.zcode/cli/memories/projects/proj-demo/memory/user_profile.md" <<'EOF'
---
type: user
title: 终端配色偏好
---

终端配色固定使用 Solarized Dark，编辑器字号 14。
EOF

# --- 各家 MCP 配置文件（预置已有内容，验证 install 合并且保留原字段、生成备份）---
cat > "$HOME/.claude.json" <<'EOF'
{
  "theme": "dark",
  "mcpServers": {}
}
EOF
cat > "$HOME/.codex/config.toml" <<'EOF'
model = "gpt-5-codex"
EOF
cat > "$HOME/.cursor/mcp.json" <<'EOF'
{
  "mcpServers": {}
}
EOF
cat > "$HOME/.kimi-code/mcp.json" <<'EOF'
{
  "mcpServers": {}
}
EOF
mkdir -p "$HOME/.zcode/cli"
cat > "$HOME/.zcode/cli/config.json" <<'EOF'
{
  "theme": "dark",
  "mcp": {
    "servers": {}
  }
}
EOF
ok "已播种 11 个记忆源文件 + 5 个 MCP 配置文件"

# ---------------------------------------------------------------------------
# JSON 断言工具（避免依赖 jq）
cat > "$WORK/checks.cjs" <<'EOF'
'use strict';
const fs = require('node:fs');
const [scenario, file, ...rest] = process.argv.slice(2);
const die = (msg) => {
  console.error(`检查失败[${scenario}]：${msg}`);
  process.exit(1);
};
const load = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const totals = (report) =>
  report.adapters.reduce(
    (acc, a) => ({
      added: acc.added + a.added,
      updated: acc.updated + a.updated,
      skipped: acc.skipped + a.skipped,
      removed: acc.removed + a.removed,
      errors: acc.errors + a.errors.length,
    }),
    { added: 0, updated: 0, skipped: 0, removed: 0, errors: 0 },
  );

switch (scenario) {
  case 'sync-added': {
    const report = load();
    const undetected = report.adapters.filter((a) => !a.detected).map((a) => a.id);
    if (undetected.length > 0) die(`适配器未检测到：${undetected.join(', ')}`);
    const t = totals(report);
    if (t.errors > 0 || report.errors.length > 0)
      die(`同步存在错误：${JSON.stringify(report.errors)}`);
    if (t.added < Number(rest[0])) die(`added=${t.added}，期望 ≥ ${rest[0]}`);
    console.log(`  ✔ 首次同步 added=${t.added}（≥ ${rest[0]}），5 个适配器全部检测到`);
    break;
  }
  case 'sync-idle': {
    const t = totals(load());
    if (t.added !== 0 || t.updated !== 0 || t.removed !== 0)
      die(`期望幂等（added/updated/removed 全 0），实际 added=${t.added} updated=${t.updated} removed=${t.removed}`);
    if (t.skipped !== Number(rest[0])) die(`skipped=${t.skipped}，期望 ${rest[0]}`);
    console.log(`  ✔ 幂等同步：skipped=${t.skipped}，无新增/更新/移除`);
    break;
  }
  case 'sync-updated': {
    const t = totals(load());
    if (t.updated !== 1 || t.added !== 0 || t.removed !== 0)
      die(`期望 updated=1 且 added/removed=0，实际 added=${t.added} updated=${t.updated} removed=${t.removed}`);
    console.log('  ✔ 源文件改动被识别：updated=1');
    break;
  }
  case 'sync-removed': {
    const t = totals(load());
    if (t.removed !== 1) die(`期望 removed=1，实际 removed=${t.removed}`);
    console.log('  ✔ 源文件删除被识别：removed=1');
    break;
  }
  case 'list-count': {
    const list = load();
    if (!Array.isArray(list)) die('list --json 输出不是数组');
    if (list.length !== Number(rest[0])) die(`list 条数=${list.length}，期望 ${rest[0]}`);
    console.log(`  ✔ 记忆库共 ${list.length} 条（期望 ${rest[0]}）`);
    break;
  }
  case 'list-has-source': {
    const list = load();
    if (!list.some((m) => typeof m.source?.path === 'string' && m.source.path.includes(rest[0])))
      die(`list 中找不到来源包含「${rest[0]}」的记忆`);
    console.log(`  ✔ 已删除源对应的记忆仍保留在库中（${rest[0]}）`);
    break;
  }
  case 'list-no-source': {
    const list = load();
    if (list.some((m) => typeof m.source?.path === 'string' && m.source.path.includes(rest[0])))
      die(`list 中不应出现来源包含「${rest[0]}」的记忆`);
    console.log(`  ✔ 索引文件已按规则跳过，未进入记忆库（${rest[0]}）`);
    break;
  }
  case 'stats': {
    const stats = load();
    if (stats.total !== Number(rest[0])) die(`stats.total=${stats.total}，期望 ${rest[0]}`);
    for (const h of ['claude-code', 'codex', 'cursor', 'kimi-code', 'zcode'])
      if (!stats.byHarness?.[h]) die(`stats.byHarness 缺少 ${h}`);
    console.log(`  ✔ stats 总数 ${stats.total}，5 个来源 harness 齐全`);
    break;
  }
  case 'doctor': {
    const report = load();
    if (report.summary?.error !== 0)
      die(`doctor 存在 error 项：${JSON.stringify(report.items?.filter((i) => i.status === 'error'))}`);
    console.log(`  ✔ doctor：${report.summary.ok} 正常 / ${report.summary.warn} 警告 / 0 错误`);
    break;
  }
  default:
    die(`未知场景：${scenario}`);
}
EOF

cat > "$WORK/check-install.cjs" <<'EOF'
'use strict';
const fs = require('node:fs');
const mode = process.argv[2]; // installed | removed
const HOME = process.env.HOME;
const die = (msg) => {
  console.error(`安装检查失败：${msg}`);
  process.exit(1);
};
const EXPECT_ARGS = ['/workspace/packages/cli/dist/cli.js', 'serve'];
const entryOk = (entry) =>
  !!entry && entry.command === 'node' && JSON.stringify(entry.args) === JSON.stringify(EXPECT_ARGS);
const jsonAt = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const targets = [
  { name: 'Claude Code', path: `${HOME}/.claude.json`, get: (j) => j?.mcpServers?.tememory, keep: (j) => j.theme === 'dark' },
  { name: 'Cursor', path: `${HOME}/.cursor/mcp.json`, get: (j) => j?.mcpServers?.tememory },
  { name: 'Kimi Code', path: `${HOME}/.kimi-code/mcp.json`, get: (j) => j?.mcpServers?.tememory },
  { name: 'ZCode（嵌套 mcp.servers）', path: `${HOME}/.zcode/cli/config.json`, get: (j) => j?.mcp?.servers?.tememory, keep: (j) => j.theme === 'dark' },
];

if (mode === 'installed') {
  for (const t of targets) {
    const j = jsonAt(t.path);
    if (!entryOk(t.get(j))) die(`${t.name}（${t.path}）的 tememory 条目不正确：${JSON.stringify(t.get(j))}`);
    if (t.keep && !t.keep(j)) die(`${t.name}（${t.path}）原有配置字段丢失`);
  }
  const toml = fs.readFileSync(`${HOME}/.codex/config.toml`, 'utf8');
  if (!/\[mcp_servers\.tememory\]/.test(toml)) die('codex config.toml 缺少 [mcp_servers.tememory] 段');
  if (!/command\s*=\s*"node"/.test(toml)) die('codex config.toml 缺少 command = "node"');
  if (!/args\s*=\s*\[[^\]]*cli\.js[^\]]*"serve"\s*\]/.test(toml)) die('codex config.toml 的 args 不正确');
  if (!/model\s*=\s*"gpt-5-codex"/.test(toml)) die('codex config.toml 原有 model 字段丢失');
  console.log('  ✔ 5 个 harness 配置中的 tememory 条目均正确，原有字段保留');
} else if (mode === 'removed') {
  for (const t of targets) {
    const j = jsonAt(t.path);
    if (t.get(j) !== undefined) die(`${t.name}（${t.path}）中 tememory 条目未被移除`);
  }
  const toml = fs.readFileSync(`${HOME}/.codex/config.toml`, 'utf8');
  if (/tememory/.test(toml)) die('codex config.toml 中仍残留 tememory');
  if (!/model\s*=\s*"gpt-5-codex"/.test(toml)) die('codex config.toml 原有 model 字段丢失');
  console.log('  ✔ uninstall 后 5 个 harness 配置中的 tememory 条目均已移除，原有字段保留');
} else {
  die(`未知模式：${mode}`);
}
EOF

# ---------------------------------------------------------------------------
step "tememory init"
"${CLI[@]}" init > "$WORK/init.txt" 2>&1
need_file "$TEMEMORY_HOME/config.toml"
for t in user feedback project reference; do need_dir "$TEMEMORY_HOME/memory/$t"; done
need_grep "$WORK/init.txt" "已创建 tememory 主目录"
ok "主目录结构生成（config.toml + memory/四类目录）"

# ---------------------------------------------------------------------------
step "首次 sync：断言 added ≥ 9 且 5 个适配器全部检测到"
"${CLI[@]}" sync --json > "$WORK/sync1.json" 2>&1
node "$WORK/checks.cjs" sync-added "$WORK/sync1.json" 9

step "二次 sync（人类可读）：断言各适配器汇总表且无增量"
"${CLI[@]}" sync > "$WORK/sync2.txt" 2>&1
need_grep "$WORK/sync2.txt" "同步汇总"
for id in claude-code codex cursor kimi-code zcode; do need_grep "$WORK/sync2.txt" "$id"; done
# 汇总表头本身含「新增/更新」字样，只能断言进度行（带 + / ~ / - 前缀）不存在
need_no_grep "$WORK/sync2.txt" "+ 新增"
need_no_grep "$WORK/sync2.txt" "~ 更新"
need_no_grep "$WORK/sync2.txt" "- 源已消失"
ok "汇总表覆盖 5 个适配器，无新增/更新/移除进度行"

step "三次 sync（--json）：断言完全幂等"
"${CLI[@]}" sync --json > "$WORK/sync3.json" 2>&1
node "$WORK/checks.cjs" sync-idle "$WORK/sync3.json" 11

# ---------------------------------------------------------------------------
step "改动一个源文件后再 sync：断言 updated=1"
printf '\n补充：code review 时也要顺手看一眼测试覆盖率。\n' >> "$HOME/.codex/memories/preference.md"
"${CLI[@]}" sync --json > "$WORK/sync4.json" 2>&1
node "$WORK/checks.cjs" sync-updated "$WORK/sync4.json"

step "删除一个源文件后再 sync：断言 removed=1 且记忆仍保留在库中"
rm "$HOME/.kimi-code/memories/proj-demo/note.md"
"${CLI[@]}" sync --json > "$WORK/sync5.json" 2>&1
node "$WORK/checks.cjs" sync-removed "$WORK/sync5.json"
"${CLI[@]}" list --json > "$WORK/list.json" 2>&1
node "$WORK/checks.cjs" list-count "$WORK/list.json" 11
node "$WORK/checks.cjs" list-has-source "$WORK/list.json" "kimi-code/memories/proj-demo/note.md"

# ---------------------------------------------------------------------------
step "list / search / show / stats / conflicts / organize 检索与整理"
node "$WORK/checks.cjs" list-no-source "$WORK/list.json" "MEMORY.md"
"${CLI[@]}" list > "$WORK/list.txt" 2>&1
need_grep "$WORK/list.txt" "测试前先构建"
ok "list 表格输出包含已知标题"

"${CLI[@]}" search "pnpm" > "$WORK/search-pnpm.txt" 2>&1
need_grep "$WORK/search-pnpm.txt" "Claude Code 用户全局指令"
ok "search「pnpm」命中 Claude Code 全局指令"

"${CLI[@]}" search "测试" > "$WORK/search-test.txt" 2>&1
need_grep "$WORK/search-test.txt" "测试前先构建"
ok "search「测试」命中 feedback 记忆"

MEM_ID=$(node -e 'const l=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));const m=l.find((x)=>x.title==="测试前先构建");if(!m){console.error("找不到目标记忆");process.exit(1)}console.log(m.id)' "$WORK/list.json")
"${CLI[@]}" show "$MEM_ID" > "$WORK/show.txt" 2>&1
need_grep "$WORK/show.txt" "type: feedback"
need_grep "$WORK/show.txt" "source.harness: claude-code"
need_grep "$WORK/show.txt" "跑测试必须先 build"
ok "show $MEM_ID 输出 frontmatter 与正文"

"${CLI[@]}" stats --json > "$WORK/stats.json" 2>&1
node "$WORK/checks.cjs" stats "$WORK/stats.json" 11

"${CLI[@]}" conflicts > "$WORK/conflicts.txt" 2>&1
need_grep "$WORK/conflicts.txt" "没有标记冲突的记忆"
ok "conflicts 输出正常（无冲突）"

"${CLI[@]}" organize > "$WORK/organize.txt" 2>&1
need_grep "$WORK/organize.txt" "LLM 不可用"
need_grep "$WORK/organize.txt" "整理计划（由本地查重规则生成）"
need_grep "$WORK/organize.txt" "没有需要整理的内容"
ok "organize 无 API key 时走本地查重 dry-run"

# ---------------------------------------------------------------------------
step "doctor 体检"
"${CLI[@]}" doctor --json > "$WORK/doctor.json" 2>&1
node "$WORK/checks.cjs" doctor "$WORK/doctor.json"

# ---------------------------------------------------------------------------
step "install --all：注册 MCP server 进 5 家配置（断言条目、原字段保留、备份存在）"
"${CLI[@]}" install --all --command "node /workspace/packages/cli/dist/cli.js" > "$WORK/install.txt" 2>&1
for cfg in \
  "$HOME/.claude.json" \
  "$HOME/.codex/config.toml" \
  "$HOME/.cursor/mcp.json" \
  "$HOME/.kimi-code/mcp.json" \
  "$HOME/.zcode/cli/config.json"; do
  need_file "$cfg"
  compgen -G "${cfg}.bak-"* > /dev/null || fail "缺少备份文件：${cfg}.bak-*"
  echo "  ----- ${cfg}"
  cat "$cfg"
done
node "$WORK/check-install.cjs" installed
ok "5 个备份文件（.bak-*）均已生成"

step "uninstall --all：断言条目移除且原字段保留"
"${CLI[@]}" uninstall --all > "$WORK/uninstall.txt" 2>&1
node "$WORK/check-install.cjs" removed

# ---------------------------------------------------------------------------
step "MCP stdio 冒烟（initialize → tools/list → memory_write → memory_search → resources/read）"
cat > "$WORK/mcp-smoke.mjs" <<'EOF'
import { spawn } from 'node:child_process';

const fail = (msg) => {
  console.error(`❌ MCP 冒烟失败：${msg}`);
  process.exit(1);
};

const child = spawn('node', ['/workspace/packages/cli/dist/cli.js', 'serve'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
child.on('error', (err) => fail(`无法启动 serve：${err.message}`));

let buffer = '';
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line === '') continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`请求超时：${method}`)), 15000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
const notify = (method, params) =>
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);

const toolResult = (msg) => {
  if (msg.error) fail(`JSON-RPC 错误：${JSON.stringify(msg.error)}`);
  const text = msg.result?.content?.[0]?.text;
  if (typeof text !== 'string') fail(`工具响应缺少 content[0].text：${JSON.stringify(msg.result)}`);
  if (msg.result?.isError) fail(`工具返回错误：${text}`);
  return JSON.parse(text);
};

try {
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'tememory-e2e', version: '0.0.1' },
  });
  if (!init.result?.serverInfo?.name) fail(`initialize 响应异常：${JSON.stringify(init)}`);
  notify('notifications/initialized', {});

  const tools = await request('tools/list', {});
  const names = (tools.result?.tools ?? []).map((t) => t.name).sort();
  const expect = ['memory_list', 'memory_read', 'memory_search', 'memory_update', 'memory_write'];
  if (JSON.stringify(names) !== JSON.stringify(expect))
    fail(`工具列表不符：实际为 ${names.join(', ')}`);

  const written = toolResult(
    await request('tools/call', {
      name: 'memory_write',
      arguments: {
        content: '容器冒烟测试专用记忆：鲸鱼也会写代码。',
        type: 'feedback',
        scope: 'global',
        title: '容器冒烟记忆',
      },
    }),
  );
  if (!written.id || written.created !== true)
    fail(`memory_write 响应异常：${JSON.stringify(written)}`);

  const hits = toolResult(
    await request('tools/call', { name: 'memory_search', arguments: { query: '鲸鱼' } }),
  );
  if (!Array.isArray(hits) || !hits.some((h) => h.id === written.id))
    fail(`memory_search 未命中刚写入的记忆：${JSON.stringify(hits)}`);

  const resource = await request('resources/read', { uri: 'memory://index' });
  const indexText = resource.result?.contents?.[0]?.text ?? '';
  if (!indexText.includes('容器冒烟记忆')) fail('memory://index 中未找到新记忆标题');

  console.log('  ✔ MCP stdio 冒烟通过：5 个工具齐全，写入可搜到，索引资源含新记忆标题');
  child.kill('SIGTERM');
  process.exit(0);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
EOF
node "$WORK/mcp-smoke.mjs"

# ---------------------------------------------------------------------------
echo
echo "=============================================="
echo "🎉 E2E 全部通过（共 ${step_no} 个步骤）"
echo "=============================================="
