import type {
  ActivityEntry,
  MemoryFile,
  MemoryFolder,
  OrganizeOp,
  SourceInfo,
} from '@/lib/types';

export const FOLDERS: MemoryFolder[] = ['user', 'feedback', 'project', 'reference'];

export const TYPE_LABEL: Record<MemoryFolder, string> = {
  user: '用户',
  feedback: '偏好反馈',
  project: '项目',
  reference: '参考资料',
};

// 类型标识色 → tailwind token，只用于 6px 小圆点
export const TYPE_DOT_CLASS: Record<MemoryFolder, string> = {
  user: 'bg-type-user',
  feedback: 'bg-type-feedback',
  project: 'bg-type-project',
  reference: 'bg-type-reference',
};

export const FILES: MemoryFile[] = [
  { folder: 'user',      file: 'pnpm-preference-lt3a9x01.md', title: '包管理器偏好：优先 pnpm', scope: 'global', src: 'claude-code', from: '~/.claude/CLAUDE.md', updated: '09-26 21:14', tags: ['包管理', '工具链'],
    body: '我喜欢用 pnpm 而不是 npm，所有项目都优先 pnpm。\n\n新仓库初始化默认 `pnpm init`，CI 里也统一用 pnpm。' },
  { folder: 'user',      file: 'language-preference-lt3e7b30.md', title: '回复语言偏好', scope: 'global', src: 'kimi-code', from: '~/.kimi-code/AGENTS.md', updated: '09-25 16:55', tags: ['沟通'],
    body: '日常交流用中文，代码标识符和注释用英文，提交信息用英文。' },
  { folder: 'user',      file: 'editor-terminal-lt419f05.md', title: '编辑器与终端偏好', scope: 'global', src: 'codex', from: '~/.codex/memories/preference.md', updated: '09-22 19:31', tags: ['工具'],
    body: '终端用 Warp，编辑器用 Cursor。暗色主题，等宽字体 JetBrains Mono。' },
  { folder: 'user',      file: 'profile-lt43c8a2.md', title: '用户画像', scope: 'global', src: 'zcode', from: '~/.zcode/cli/memories/projects/demo/memory/user_profile.md', updated: '09-27 08:26', tags: ['画像'],
    body: '全栈工程师，主要写 TypeScript 和 Go。关注 AI 基础设施与开发者工具。' },
  { folder: 'feedback',  file: 'build-before-test-lt3bc422.md', title: '跑测试前必须先构建', scope: 'project:tememory', src: 'claude-code', from: '~/.claude/projects/-tmp-workspace/memory/feedback_testing.md', updated: '09-28 10:02', tags: ['测试', '构建'],
    body: 'cli 的 e2e 测试跑的是 dist 产物。改完代码必须先 `pnpm -r build` 再 `pnpm -r test`，否则测的是旧代码。' },
  { folder: 'feedback',  file: 'no-destructive-cmds-lt44d9f6.md', title: '不要替我执行破坏性命令', scope: 'global', src: 'claude-code', from: '~/.claude/projects/-tmp-workspace/memory/feedback_safety.md', updated: '09-24 17:12', tags: ['安全', '边界'],
    body: '`rm -rf`、`git push --force`、数据库 drop 这类操作，必须先列出影响范围并等我确认。' },
  { folder: 'project',   file: 'node18-constraint-lt3f2c81.md', title: 'tememory 的 Node 版本约束', scope: 'project:tememory', src: 'kimi-code', from: '~/.kimi-code/memories/tememory/note.md', updated: '09-29 11:20', tags: ['兼容性', 'Node'],
    body: '宿主机是 Node 18，所有依赖必须兼容 Node 18：加依赖前先查 engines。chokidar 锁 4.x、commander 锁 13.x。' },
  { folder: 'project',   file: 'legacy-npm-lock-lt45e1b8.md', title: 'legacy-app 锁定 npm', scope: 'project:legacy-app', src: 'cursor', from: 'legacy-app/.cursor/rules/deps.mdc', updated: '09-14 15:38', tags: ['包管理'],
    body: 'legacy-app 仓库锁定 npm（package-lock.json 已提交），不要切换到 pnpm。' },
  { folder: 'project',   file: 'react-rules-lt42b6e4.md', title: 'React 组件规范', scope: 'project:web-app', src: 'cursor', from: 'web-app/.cursor/rules/react.mdc', updated: '09-15 11:47', tags: ['React', '前端'],
    body: '- 函数组件 + hooks，不写 class 组件\n- 样式用 CSS Modules，不引运行时 CSS-in-JS' },
  { folder: 'reference', file: 'code-style-lt3d1f99.md', title: '代码风格约定', scope: 'global', src: 'claude-code', from: '~/.claude/rules/code-style.md', updated: '09-20 09:40', tags: ['代码风格'],
    body: '- 缩进 2 空格\n- import 排序：node 内置 → 第三方 → 相对路径\n- 不用的变量前缀下划线' },
  { folder: 'reference', file: 'codex-global-lt40a2d7.md', title: 'Codex 全局指令', scope: 'global', src: 'codex', from: '~/.codex/AGENTS.md', updated: '09-18 14:03', tags: [],
    body: 'Always run tests before committing. Prefer small, reviewable commits.' },
  { folder: 'reference', file: 'mcp-notes-lt46f3c0.md', title: 'MCP 配置备忘', scope: 'global', src: 'zcode', from: '~/.zcode/agent-memory/infra/mcp-notes.md', updated: '09-21 13:59', tags: ['MCP'],
    body: 'ZCode 的 MCP 配置在 `~/.zcode/cli/config.json` 的 `mcp.servers` 嵌套键，和其他家不一样。' },
];

export const INDEX_MD = `# MEMORY.md

> 自动生成，请勿手改。12 条记忆 · 更新于 09-29 11:42

## 用户（4）
- [包管理器偏好：优先 pnpm](user/pnpm-preference-lt3a9x01.md) · global · #包管理
- [回复语言偏好](user/language-preference-lt3e7b30.md) · global
- [编辑器与终端偏好](user/editor-terminal-lt419f05.md) · global
- [用户画像](user/profile-lt43c8a2.md) · global

## 偏好反馈（2）
- [跑测试前必须先构建](feedback/build-before-test-lt3bc422.md) · project:tememory
- [不要替我执行破坏性命令](feedback/no-destructive-cmds-lt44d9f6.md) · global

## 项目（3）
- [tememory 的 Node 版本约束](project/node18-constraint-lt3f2c81.md) · project:tememory
- [legacy-app 锁定 npm](project/legacy-npm-lock-lt45e1b8.md) · project:legacy-app
- [React 组件规范](project/react-rules-lt42b6e4.md) · project:web-app

## 参考资料（3）
- [代码风格约定](reference/code-style-lt3d1f99.md) · global
- [Codex 全局指令](reference/codex-global-lt40a2d7.md) · global
- [MCP 配置备忘](reference/mcp-notes-lt46f3c0.md) · global`;

export const SOURCES: SourceInfo[] = [
  { letter: 'C',  name: 'Claude Code', paths: '~/.claude/CLAUDE.md · rules/ · projects/*/memory/', mcp: true,  cnt: 8 },
  { letter: 'Cx', name: 'Codex',       paths: '~/.codex/AGENTS.md · memories/（跳过 memories_extensions）', mcp: true, cnt: 4 },
  { letter: 'Cu', name: 'Cursor',      paths: '~/.cursor/rules · <repo>/.cursor/rules/*.mdc', mcp: true,  cnt: 5 },
  { letter: 'K',  name: 'Kimi Code',   paths: '~/.kimi-code/AGENTS.md · memories/', mcp: true,  cnt: 3 },
  { letter: 'Z',  name: 'ZCode',       paths: '~/.zcode/AGENTS.md · cli/memories/ · agent-memory/', mcp: false, cnt: 3 },
];

export const OPS: OrganizeOp[] = [
  { st: 'M', files: 'memory/user/profile-lt43c8a2.md', to: null,
    why: '把 zcode 的 user_profile 与 codex 的 preference 合并进同一份用户画像文件，内容互补。' },
  { st: 'R', files: 'memory/reference/mcp-notes-lt46f3c0.md', to: 'memory/project/mcp-notes-lt46f3c0.md',
    why: '内容只与 tememory 项目相关 —— 重分类就是把文件从 reference/ 移到 project/。' },
  { st: 'M', files: 'memory/feedback/build-before-test-lt3bc422.md', to: null,
    why: '仅更新 frontmatter：tags 增加 monorepo，与 Node 版本约束归入同一主题簇。' },
  { st: '!', files: 'memory/user/pnpm-preference-lt3a9x01.md  ↔  memory/project/legacy-npm-lock-lt45e1b8.md', to: null,
    why: '两个文件对包管理器的说法相反。文件没有"冲突"这回事 —— 只提示，不改任何文件，你自己看着办。' },
];

export const ACT: ActivityEntry[] = [
  { t: '09-29 11:42', what: [['watch', true], [' 触发 · kimi-code/memories 变化', false]], p: 3, u: 1, s: 19 },
  { t: '09-29 09:15', what: [['手动 ', false], ['sync', true]], p: 0, u: 0, s: 23 },
  { t: '09-28 22:03', what: [['watch', true], [' 触发 · claude-code/projects 变化', false]], p: 1, u: 2, s: 20 },
  { t: '09-28 10:31', what: [['手动 ', false], ['sync --classify', true]], p: 2, u: 0, s: 21 },
  { t: '09-27 08:20', what: [['首次全量同步', true]], p: 21, u: 0, s: 0 },
];
