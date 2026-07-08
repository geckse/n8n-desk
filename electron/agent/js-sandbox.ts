import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  type SandboxResult,
} from './js-sandbox-core'

export type { SandboxResult } from './js-sandbox-core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LangChainTool = any

// --- Worker resolution ---

/**
 * Extra wall-clock allowance on top of the vm timeout: worker spawn + module
 * load overhead. The vm timeout inside the worker bounds synchronous code;
 * this host-side deadline bounds EVERYTHING (async microtask bombs included).
 */
const WORKER_GRACE_MS = 1_500

/** Worker heap cap — a sandbox allocation bomb kills the worker, not the app. */
const WORKER_MAX_OLD_SPACE_MB = 256

/**
 * Resolve the compiled worker entry.
 *
 * - Production/dev-electron: esbuild emits `js-sandbox-worker.js` next to the
 *   main bundle (see scripts/build-electron.mjs) — resolve via __dirname.
 * - Tests: vitest transforms TS in-process and cannot spawn TS workers, so the
 *   test setup pre-bundles the worker and points N8N_DESK_SANDBOX_WORKER at it.
 */
function resolveWorkerPath(): string {
  const override = process.env.N8N_DESK_SANDBOX_WORKER
  if (override) return override
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const baseDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd()
  return path.join(baseDir, 'js-sandbox-worker.js')
}

// --- Public API ---

/**
 * Execute JavaScript code in a sandboxed worker thread with zero I/O access.
 *
 * The vm-level timeout (inside the worker) bounds synchronous code; the
 * worker itself is hard-terminated at a wall-clock deadline so async
 * microtask bombs cannot starve the Electron main process (they starve the
 * disposable worker instead). A memory cap kills allocation bombs.
 *
 * @param code - JavaScript code to execute. The completion value of the last
 *   expression is returned as the result.
 * @param inputData - Optional data accessible as `inputData` in the sandbox.
 *   Must be structured-cloneable (it crosses the worker boundary).
 * @param timeoutMs - Execution timeout in milliseconds (default: 10000, max: 30000).
 * @param signal - Optional abort signal — terminates the worker immediately
 *   (used by agent stop()).
 */
export async function executeInSandbox(
  code: string,
  inputData?: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<SandboxResult> {
  const effectiveTimeout = Math.min(Math.max(timeoutMs, 1), MAX_TIMEOUT_MS)

  if (signal?.aborted) {
    return {
      result: undefined,
      stdout: [],
      error: { message: 'Execution cancelled', type: 'cancelled' },
    }
  }

  let worker: Worker
  try {
    worker = new Worker(resolveWorkerPath(), {
      workerData: { code, inputData, timeoutMs: effectiveTimeout },
      resourceLimits: {
        maxOldGenerationSizeMb: WORKER_MAX_OLD_SPACE_MB,
        maxYoungGenerationSizeMb: 64,
      },
    })
  } catch (err) {
    // Non-cloneable inputData or missing worker bundle
    const message = err instanceof Error ? err.message : String(err)
    return {
      result: undefined,
      stdout: [],
      error: { message: `Failed to start sandbox worker: ${message}`, type: 'runtime' },
    }
  }

  return new Promise<SandboxResult>((resolve) => {
    let settled = false

    function settle(result: SandboxResult, terminate: boolean): void {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      signal?.removeEventListener('abort', onAbort)
      if (terminate) {
        void worker.terminate()
      }
      resolve(result)
    }

    function onAbort(): void {
      settle(
        {
          result: undefined,
          stdout: [],
          error: { message: 'Execution cancelled', type: 'cancelled' },
        },
        true,
      )
    }

    // Hard wall-clock kill — covers async work the vm timeout cannot see.
    const killTimer = setTimeout(() => {
      settle(
        {
          result: undefined,
          stdout: [],
          error: {
            message: `Execution timed out (${effectiveTimeout / 1000}s limit)`,
            type: 'timeout',
          },
        },
        true,
      )
    }, effectiveTimeout + WORKER_GRACE_MS)

    signal?.addEventListener('abort', onAbort, { once: true })

    worker.once('message', (result: SandboxResult) => {
      settle(result, true)
    })

    worker.once('error', (err: Error) => {
      settle(
        {
          result: undefined,
          stdout: [],
          error: { message: err.message, type: 'runtime' },
        },
        true,
      )
    })

    worker.once('exit', (exitCode: number) => {
      // Exit without a message: memory-cap kill or crash.
      settle(
        {
          result: undefined,
          stdout: [],
          error: {
            message: `Sandbox worker exited unexpectedly (code ${exitCode}) — possibly exceeded the ${WORKER_MAX_OLD_SPACE_MB}MB memory limit`,
            type: 'runtime',
          },
        },
        false,
      )
    })
  })
}

// --- LangChain Tool ---

/**
 * LangChain tool wrapper for the JS compute sandbox.
 *
 * Executes agent-generated JavaScript in a zero-I/O worker-thread vm context.
 * Does NOT require human-in-the-loop approval (not in DESTRUCTIVE_TOOLS).
 * Forwards LangChain's per-run config.signal so agent stop() terminates the
 * worker mid-run.
 *
 * Returns a JSON string with `{ result, stdout, error? }` shape.
 */
export const jsComputeTool: LangChainTool = tool(
  async (
    { code, inputData, timeoutMs }: {
      code: string
      inputData?: unknown
      timeoutMs?: number
    },
    config?: { signal?: AbortSignal },
  ) => {
    const result = await executeInSandbox(code, inputData, timeoutMs, config?.signal)
    return JSON.stringify(result)
  },
  {
    name: 'js_compute',
    description:
      'Execute JavaScript code in a sandboxed environment with no I/O access. ' +
      'Use for data transformation, calculation, text processing, and algorithmic tasks. ' +
      'Available globals: JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set, structuredClone. ' +
      'Input data is available via the `inputData` variable. ' +
      'Console output (console.log/warn/error) is captured in the `stdout` array. ' +
      'The completion value of the last expression is returned as `result`. ' +
      'eval() and Function() are blocked. No filesystem, network, or process access.',
    schema: z.object({
      code: z.string().describe(
        'JavaScript code to execute. The completion value of the last expression is returned. ' +
        'Use console.log() for intermediate output.',
      ),
      inputData: z.unknown().optional().describe(
        'Optional data accessible as the `inputData` variable inside the sandbox. Must be JSON-serializable.',
      ),
      timeoutMs: z.number().optional().describe(
        'Execution timeout in milliseconds (default: 10000, max: 30000)',
      ),
    }),
  },
)
