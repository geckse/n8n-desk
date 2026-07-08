import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['electron/**/*.test.ts'],
    exclude: ['node_modules', 'n8n-master', 'dist'],
    // Pre-bundles the js_compute worker (worker_threads cannot run TS)
    setupFiles: ['electron/agent/__tests__/setup/build-sandbox-worker.ts'],
    server: {
      deps: {
        // @langchain/langgraph-sdk vendors an ESM copy of p-retry inside a
        // CJS package — native Node require() chokes on it. Inline the whole
        // deepagents/langchain chain so vite transforms it (esbuild handles
        // the same files fine in the production bundle).
        inline: [/deepagents/, /@langchain/, /p-retry/, /is-network-error/, /langsmith/],
      },
    },
  },
})
