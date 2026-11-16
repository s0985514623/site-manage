import path from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * 測試只跑服務層、route handler 與純函式（Next.js 官方指引：async Server Component
 * 不做單元測試）。全部共用一個本機測試資料庫，所以檔案之間不平行。
 */
export default defineConfig({
  resolve: {
    // 讀 tsconfig 的 paths（@/* → src/*）
    tsconfigPaths: true,
    alias: {
      // server-only 在 Next 之外 import 會直接拋錯；測試裡換成空模組
      'server-only': path.resolve(import.meta.dirname, 'tests/setup/empty.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup/global-setup.ts'],
    setupFiles: ['tests/setup/per-test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
