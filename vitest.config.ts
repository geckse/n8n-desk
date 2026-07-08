import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'n8n-master', 'dist', 'electron', 'src/__tests__/setup/**'],
    setupFiles: ['src/__tests__/setup/vue-test-utils.ts'],
  },
})
