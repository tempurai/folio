# syntax=docker/dockerfile:1
# tememory 端到端验证镜像：
#   1. 全局安装真实 harness CLI（仅验证可安装性与 --version，不登录、不运行交互功能）
#   2. 在干净的 Linux 容器内完成 pnpm install / build / 全量单测
#   3. ENTRYPOINT 执行 docker/e2e.sh，跑通 init→sync→检索→install→MCP 全链路断言
FROM node:20-bookworm-slim

ENV CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_fund=false \
    npm_config_audit=false \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1

# ELECTRON_SKIP_BINARY_DOWNLOAD：desktop 包在容器内只做 electron-vite build + vitest，
# 不启动 Electron，跳过 ~110MB 的二进制下载，避免 e2e 构建被下载拖垮

# pnpm 版本与根 package.json 的 packageManager 字段保持一致
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# 真实 harness CLI：逐包安装，单个失败不中断构建，结果写入 /opt/harness-report.txt
# 供 e2e.sh 在报告中引用。Cursor（GUI）与 ZCode（桌面 ADE）没有 headless 安装方式，
# 不在此安装，由 e2e.sh 按文档布局伪造其 home 目录。
RUN set -u; \
    report=/opt/harness-report.txt; \
    : > "$report"; \
    for spec in "@anthropic-ai/claude-code:claude" "@openai/codex:codex" "@moonshot-ai/kimi-code:kimi"; do \
      pkg="${spec%%:*}"; bin="${spec##*:}"; \
      echo "===== $pkg =====" >> "$report"; \
      if npm install --global "$pkg" >> "$report" 2>&1; then \
        if ! command -v "$bin" > /dev/null 2>&1; then \
          echo "STATUS=installed-but-bin-missing bin=$bin" >> "$report"; \
          continue; \
        fi; \
        out="$("$bin" --version 2>&1)"; rc=$?; \
        if [ $rc -ne 0 ] || [ -z "$out" ]; then \
          out="$("$bin" --help 2>&1)"; rc=$?; \
        fi; \
        if [ $rc -eq 0 ] && [ -n "$out" ]; then \
          echo "STATUS=installed bin=$bin version=$(printf '%s\n' "$out" | head -n 1)" >> "$report"; \
        else \
          reason="$(printf '%s\n' "$out" | grep -m1 -E 'Error|error' || printf '%s\n' "$out" | head -n 1)"; \
          echo "STATUS=installed-but-run-failed bin=$bin reason=$reason" >> "$report"; \
        fi; \
      else \
        echo "STATUS=install-failed" >> "$report"; \
      fi; \
    done; \
    grep -E '^(=====|STATUS)' "$report"

WORKDIR /workspace
COPY . .

RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm -r build
RUN pnpm -r test

ENTRYPOINT ["bash", "/workspace/docker/e2e.sh"]
