import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

// Node 18 无 import.meta.dirname，统一从 import.meta.url 推导
const pkgDir = dirname(fileURLToPath(import.meta.url));

/**
 * CSP 注入（安全基线第 2 条）：
 * - prod：default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
 *   img-src 'self' data:; connect-src 'none'; font-src 'self'
 * - dev：额外放宽 connect-src 'self' ws: http://localhost:*（vite dev server / HMR），
 *   且 script-src 加 'unsafe-inline'（@vitejs/plugin-react 的 refresh preamble 是内联脚本，
 *   不加 dev 下 React 热更新直接白屏）。
 */
function cspPlugin(mode: string): Plugin {
  const prod =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'none'; font-src 'self'";
  const dev =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self' ws: http://localhost:*; font-src 'self'";
  const content = mode === 'development' ? dev : prod;
  return {
    name: 'folio-csp',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `  <meta http-equiv="Content-Security-Policy" content="${content}" />\n  </head>`,
      );
    },
  };
}

export default defineConfig(({ mode }) => ({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(pkgDir, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['zod'] })],
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(pkgDir, 'src/preload/index.ts') },
      rollupOptions: {
        output: {
          // sandbox: true 的 preload 必须是单文件 CJS
          format: 'cjs',
          inlineDynamicImports: true,
        },
      },
    },
  },
  renderer: {
    root: resolve(pkgDir, 'src/renderer'),
    plugins: [react(), cspPlugin(mode)],
    resolve: {
      alias: {
        '@': resolve(pkgDir, 'src/renderer/src'),
      },
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(pkgDir, 'src/renderer/index.html'),
      },
    },
  },
}));
