#!/usr/bin/env bash
# harness-lab：真实 harness 联调
#   1) 各 harness 配 Kimi Code 订阅 key（api.kimi.com/coding，Anthropic + OpenAI/Responses 双兼容）
#   2) 各 harness 真实跑一个会话并诱导其写入长期记忆
#   3) folio sync 把这些记忆收进统一记忆库并断言
#   4) folio serve MCP 握手
# 用法：docker run --rm --env-file <含 KIMI_API_KEY 的文件> folio-harness-lab
# 参考：kimi.com/code/docs/en/third-party-tools/other-coding-agents.html、
#       kimi.com/code/docs/en/kimi-code-cli/configuration/providers.html
set -uo pipefail

say() { printf '\n========== %s ==========\n' "$*"; }
fail() { echo "❌ $*"; FAILED=1; }
FAILED=0

export LAB=/tmp/lab
export HOME="$LAB/home"                    # harness 的 home 全隔离在这里
export FOLIO_HOME="$LAB/folio"
export XDG_CONFIG_HOME="$LAB/xdg"
mkdir -p "$HOME" "$FOLIO_HOME" "$LAB/proj"
FOLIO="node /workspace/packages/cli/dist/cli.js"

MODEL="${LAB_MODEL:-k3}"
KIMI_CODING_BASE="${LAB_KIMI_BASE:-https://api.kimi.com/coding/v1}"
ANTHROPIC_BASE="${LAB_ANTHROPIC_BASE:-https://api.kimi.com/coding/}"
KEY="${KIMI_API_KEY:-${MOONSHOT_API_KEY:-}}"

say "0. 环境自检"
node --version
claude --version || fail "claude 不可用"
codex --version || fail "codex 不可用"
(kimi --version || kimi-code --version) 2>/dev/null || fail "kimi 不可用"
$FOLIO --version || fail "folio 不可用"
[ -z "$KEY" ] && echo "⚠️ 未提供 KIMI_API_KEY：跳过真实模型会话，只做配置与离线断言"

# ---------- 1. 各 harness 的三方 key 配置（按官方文档写法落盘） ----------
say "1. 写入三方 provider 配置"

# Claude Code：先写 ~/.claude.json 跳过 onboarding（第三方模型支持开关），env 变量见会话调用
mkdir -p "$HOME/.claude"
node --eval "
const fs = require('fs'), path = require('path'), os = require('os');
const p = path.join(os.homedir(), '.claude.json');
const cur = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {};
fs.writeFileSync(p, JSON.stringify({ ...cur, penguinModeOrgEnabled: true, hasCompletedOnboarding: true }, null, 2));
console.log('claude onboarding skip 写入完成');
"

# Codex：~/.codex/config.toml 自定义 provider（Responses API；env_key 从环境变量读 key）
mkdir -p "$HOME/.codex"
cat > "$HOME/.codex/config.toml" <<EOF
model = "$MODEL"
model_provider = "kimi"
preferred_auth_method = "apikey"

[features]
memories = true

[model_providers.kimi]
name = "Kimi Code"
base_url = "$KIMI_CODING_BASE"
env_key = "KIMI_API_KEY"
wire_api = "responses"
requires_openai_auth = false
EOF
echo "codex config.toml 已写入（provider=kimi, wire_api=responses, memories=true）"

# Kimi Code：~/.kimi-code/config.toml（type kimi；key 走 api_key_env，不落盘）
mkdir -p "$HOME/.kimi-code"
cat > "$HOME/.kimi-code/config.toml" <<EOF
default_model = "$MODEL"

[providers.kimi]
type = "kimi"
base_url = "$KIMI_CODING_BASE"
api_key_env = "KIMI_API_KEY"

[models.$MODEL]
provider = "kimi"
model = "$MODEL"
max_context_size = 262144
EOF
echo "kimi config.toml 已写入（provider=kimi, api_key_env）"

# ---------- 1.5 先把 folio MCP 注册进各 harness（任何会话开始前） ----------
say "1.5 folio install（注册 MCP server）"
$FOLIO init >/dev/null
$FOLIO install --all --command "node /workspace/packages/cli/dist/cli.js"
grep -q '"folio"' "$HOME/.claude.json" && echo "✓ claude ~/.claude.json 有 folio" || fail "claude mcp 注册失败"
grep -q 'mcp_servers.folio' "$HOME/.codex/config.toml" && echo "✓ codex config.toml 有 folio" || fail "codex mcp 注册失败"
grep -q '"folio"' "$HOME/.kimi-code/mcp.json" && echo "✓ kimi mcp.json 有 folio" || fail "kimi mcp 注册失败"

# ---------- 2. 真实会话：诱导各 harness 写长期记忆 ----------
run_claude() {
  say "2a. Claude Code 会话（目标：写 auto memory）"
  cd "$LAB/proj"
  ANTHROPIC_BASE_URL="$ANTHROPIC_BASE" ANTHROPIC_API_KEY="$KEY" ANTHROPIC_MODEL="$MODEL" \
  CLAUDE_CODE_EFFORT_LEVEL=high \
    timeout 240 claude -p "请把这条用户偏好写入你的长期记忆（memory）：我调试前端时永远先看 network 面板。写完后只回复 done。" --dangerously-skip-permissions 2>&1 | tail -3
  echo "--- claude memory 目录:"; find "$HOME/.claude" -path '*memory*' -name '*.md' 2>/dev/null | head -5
}

run_codex() {
  say "2b. Codex 会话（目标：memories 后台提炼）"
  cd "$LAB/proj"
  KIMI_API_KEY="$KEY" timeout 240 codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox "请记住：我所有的提交信息都用英文写。确认后只回复 done。" 2>&1 | tail -3
  echo "--- codex memories 目录:"; find "$HOME/.codex/memories" -name '*.md' 2>/dev/null | head -5
}

run_kimi() {
  say "2c. Kimi Code 会话（目标：写 memories/）"
  cd "$LAB/proj"
  KIMI_API_KEY="$KEY" timeout 240 kimi -p "请记住：跑测试前必须先构建。只回复 done。" 2>&1 | tail -5
  echo "--- kimi memories 目录:"; find "$HOME/.kimi-code/memories" -name '*.md' 2>/dev/null | head -5
}

if [ -n "$KEY" ]; then
  run_claude; run_codex; run_kimi
else
  say "2. 跳过真实会话（无 key）"
fi

# ---------- 2.5 MCP 方向：harness 通过 MCP 读写统一库 ----------
run_mcp_phase() {
  say "2.5 harness 经 MCP 读写统一记忆库"

  local PROMPT_W='你现在接入了一个叫 folio 的 MCP server（工具前缀 mcp__folio__ 或 folio.）。请务必实际调用它的 memory_write 工具写入这条记忆：「部署生产前必须先跑 pnpm -r build」。然后实际调用 memory_search 搜索「部署」。最后只回复你搜到的记忆标题。'
  local PROMPT_R='你现在接入了一个叫 folio 的 MCP server。请务必实际调用它的 memory_search 工具搜索「部署」，并把搜到的记忆内容原样告诉我。'

  say "2.5a. Claude Code 经 MCP 写入"
  # 用全新项目目录（claude 对项目有会话状态残留，旧目录里 MCP 工具注册偶发缺失）
  local P2="$LAB/proj-mcp" && mkdir -p "$P2" && cd "$P2"
  local out
  out=$(ANTHROPIC_BASE_URL="$ANTHROPIC_BASE" ANTHROPIC_API_KEY="$KEY" ANTHROPIC_MODEL="$MODEL" \
    timeout 240 claude -p "$PROMPT_W" --dangerously-skip-permissions 2>&1 | tail -3)
  echo "$out"
  # claude 偶发首轮 MCP 连接失败：库内无新增则换个全新目录重试一次
  if ! $FOLIO search "部署" --json 2>/dev/null | grep -q '部署'; then
    echo "（claude 首轮未写入，换全新目录重试一次）"
    mkdir -p "$LAB/proj-mcp2" && cd "$LAB/proj-mcp2"
    ANTHROPIC_BASE_URL="$ANTHROPIC_BASE" ANTHROPIC_API_KEY="$KEY" ANTHROPIC_MODEL="$MODEL" \
      timeout 240 claude -p "$PROMPT_W" --dangerously-skip-permissions 2>&1 | tail -3
  fi

  say "2.5b. Kimi Code 经 MCP 写入+读取"
  KIMI_API_KEY="$KEY" timeout 240 kimi -p "$PROMPT_W" 2>&1 | tail -4

  say "2.5c. Codex 经 MCP 读取（验证跨 harness 可见，此时库内应有内容）"
  KIMI_API_KEY="$KEY" timeout 240 codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox "$PROMPT_R" 2>&1 | tail -4

  echo "--- folio 库内经 MCP 写入的记忆:"
  $FOLIO list --json | python3 -c "
import json, sys
items = json.load(sys.stdin)
mcp_items = [i for i in items if (i.get('source') or {}).get('harness') == 'mcp']
print(f'MCP 来源记忆 {len(mcp_items)} 条')
for i in mcp_items: print(' -', i.get('title'), '|', i.get('id'))
sys.exit(0 if mcp_items else 1)
" || fail "没有经 MCP 写入的记忆（harness 未实际调用工具）"
  $FOLIO search "部署" --json | grep -q '部署' && echo "✓ 统一库可搜到 MCP 写入的记忆" || fail "搜不到 MCP 写入的记忆"
}

if [ -n "$KEY" ]; then
  run_mcp_phase
fi

# ---------- 3. folio 同步并断言 ----------
say "3. folio sync 收编"
$FOLIO init
$FOLIO sync
$FOLIO stats

if [ -n "$KEY" ]; then
  COUNT=$($FOLIO list --json | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
  echo "folio 库内记忆条数: $COUNT"
  [ "$COUNT" -ge 1 ] || fail "harness 会话后 folio 未收到任何记忆"
  for kw in network 提交信息 构建; do
    if $FOLIO search "$kw" --json 2>/dev/null | grep -q 'id'; then echo "✓ 搜到 harness 写入的记忆关键词: $kw"; fi
  done
fi

# ---------- 4. MCP 服务链路 ----------
say "4. folio serve MCP 握手"
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"lab","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | timeout 10 $FOLIO serve 2>/dev/null | grep -o '"name":"folio"' >/dev/null \
  && echo "✓ MCP stdio 握手 OK" || fail "MCP 握手失败"

# ---------- 5. 汇总 ----------
say "5. 联调汇总"
echo "harness 写入的记忆文件："
find "$HOME/.claude" "$HOME/.codex" "$HOME/.kimi-code" -path '*memor*' -name '*.md' 2>/dev/null | sed "s|$HOME||" | head -20
echo "folio 库内文件："
find "$FOLIO_HOME/memory" -name '*.md' 2>/dev/null | head -20

if [ "$FAILED" -eq 0 ]; then echo "🎉 harness-lab 通过"; exit 0; else echo "❌ harness-lab 有失败项"; exit 1; fi
