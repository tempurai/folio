# folio-memory

**folio** — 统一各 AI coding harness（Claude Code、Codex、Cursor、Kimi Code、ZCode）记忆的本地记忆库工具。file-based、单向导入、MCP 服务回各 harness。

```bash
npm i -g folio-memory     # 安装后得到 folio 命令（Node ≥ 18）
folio init                # 初始化 ~/.folio
folio sync                # 从检测到的 harness 增量导入记忆
folio install --all       # 把 folio MCP server 注册进各家 harness 配置
folio serve               # stdio MCP server（供 harness 调用）
```

完整文档、桌面端（Electron）、截图与路线图见 GitHub 仓库：

**https://github.com/tempurai/folio**

[中文 README](https://github.com/tempurai/folio/blob/main/README.zh-CN.md) · [Changelog](https://github.com/tempurai/folio/blob/main/CHANGELOG.md) · MIT License
