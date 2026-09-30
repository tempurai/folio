import { defineConfig } from 'tsup';

export default defineConfig({
  // adapters/index 必须是独立入口：sync.ts 的 loadBuiltinAdapters 会在运行时
  // 动态 import('./adapters/index.js')，单文件打包会让该路径不存在
  entry: ['src/index.ts', 'src/adapters/index.ts'],
  format: ['esm'],
  target: 'node18',
  dts: true,
  clean: true,
});
