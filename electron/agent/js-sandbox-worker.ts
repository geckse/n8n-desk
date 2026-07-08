/**
 * Worker-thread entry for js_compute.
 *
 * Runs the vm sandbox OFF the Electron main thread so an async microtask bomb
 * (e.g. `Promise.resolve().then(function b(){ Promise.resolve().then(b) })`)
 * only starves THIS worker — the host enforces a wall-clock deadline and
 * terminates the worker, keeping the app responsive.
 *
 * Bundled as its own esbuild entry (see scripts/build-electron.mjs) and
 * spawned by executeInSandbox() in js-sandbox.ts.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { executeInVm } from './js-sandbox-core'

interface WorkerInput {
  code: string
  inputData?: unknown
  timeoutMs?: number
}

const { code, inputData, timeoutMs } = (workerData ?? {}) as WorkerInput

const result = executeInVm(code, inputData, timeoutMs)

// Post the result before any sandbox-created microtasks can starve the loop —
// postMessage is synchronous from this thread's perspective. The host resolves
// on this message and terminates the worker regardless of lingering microtasks.
parentPort?.postMessage(result)

// Force a clean exit even if the sandbox left the microtask queue spinning.
process.exit(0)
