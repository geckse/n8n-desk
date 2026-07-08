import { writeFileSync, mkdirSync } from 'fs'
import { build } from 'esbuild'

// Bundle Electron TypeScript with esbuild
// Uses CJS output format since Electron's main process requires it
await build({
  entryPoints: {
    main: 'electron/main.ts',
    preload: 'electron/preload.ts',
    // Separate worker bundle — spawned via worker_threads by js-sandbox.ts,
    // resolved as path.join(__dirname, 'js-sandbox-worker.js') at runtime
    'js-sandbox-worker': 'electron/agent/js-sandbox-worker.ts',
  },
  outdir: 'electron/dist',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron', '@anthropic-ai/claude-agent-sdk'],
  sourcemap: true,
  logLevel: 'info',
})

// Add a package.json to the output dir that forces CJS mode,
// overriding the root "type": "module" for Electron's main process
mkdirSync('electron/dist', { recursive: true })
writeFileSync('electron/dist/package.json', JSON.stringify({ type: 'commonjs' }))

console.log('Electron build complete')
