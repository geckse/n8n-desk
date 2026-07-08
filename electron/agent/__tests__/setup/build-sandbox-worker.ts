/**
 * Vitest setup for the electron suite: pre-bundle the js_compute worker.
 *
 * worker_threads cannot execute TypeScript, so tests (which run TS through
 * vitest's transform) build the worker entry once per test process into a
 * unique temp file and point N8N_DESK_SANDBOX_WORKER at it. Production uses
 * the copy that scripts/build-electron.mjs emits next to main.js instead.
 */
import { buildSync } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const setupDir = path.dirname(fileURLToPath(import.meta.url))
const outDir = mkdtempSync(path.join(tmpdir(), 'n8n-desk-sandbox-worker-'))
const outfile = path.join(outDir, 'js-sandbox-worker.cjs')

buildSync({
  entryPoints: [path.resolve(setupDir, '../../js-sandbox-worker.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
})

process.env.N8N_DESK_SANDBOX_WORKER = outfile
