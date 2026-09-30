import { defineConfig } from 'vitest/config';

// CLI 测试通过 spawnSync 起真实 node 子进程跑 e2e，单个用例可能起多个进程，
// 默认 5s 的 testTimeout 在慢机器上不够
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
