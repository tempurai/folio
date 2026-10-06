import { defineConfig } from 'tsup';

// 单文件自包含发布：core / mcp-server / 全部依赖都打进 dist/cli.js
// （npm 包 folio-memory 无运行时依赖，全局安装即可用）
export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node18',
  dts: false,
  clean: true,
  splitting: false, // 真·单文件产物（release 制品与 npm 包都只发一个 cli.js）
  noExternal: [
    /^@folio\//,
    /^@modelcontextprotocol\/sdk/,
    'chokidar',
    'commander',
    'gray-matter',
    'smol-toml',
    'zod',
  ],
  banner: {
    // createRequire 兜底：gray-matter 等 CJS 依赖在 ESM bundle 里需要
    js: [
      '#!/usr/bin/env node',
      "import { createRequire } from 'node:module';",
      'const require = createRequire(import.meta.url);',
    ].join('\n'),
  },
});
