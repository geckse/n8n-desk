import vm from 'node:vm'

// --- Types ---

/** Result from executing code in the JS sandbox. */
export interface SandboxResult {
  /** The completion value of the executed code. */
  result: unknown
  /** Captured console output lines. */
  stdout: string[]
  /** Error details if execution failed. */
  error?: {
    message: string
    type: 'runtime' | 'timeout' | 'security' | 'cancelled'
  }
}

// --- Constants ---

/** Default execution timeout in milliseconds (10 seconds). */
export const DEFAULT_TIMEOUT_MS = 10_000

/** Maximum allowed timeout in milliseconds (30 seconds). */
export const MAX_TIMEOUT_MS = 30_000

/**
 * JavaScript code that freezes all built-in prototypes inside the sandbox context.
 *
 * Prevents prototype pollution from user code. In strict mode, modification
 * attempts throw TypeError; in non-strict they fail silently.
 *
 * Captures `Object.freeze` into a local before freezing to ensure it remains
 * callable even after `Object` is frozen.
 */
const FREEZE_PROTOTYPES_CODE = `
'use strict';
const __freeze__ = Object.freeze;
__freeze__(Object.prototype);
__freeze__(Array.prototype);
__freeze__(Function.prototype);
__freeze__(String.prototype);
__freeze__(Number.prototype);
__freeze__(Boolean.prototype);
__freeze__(Symbol.prototype);
__freeze__(RegExp.prototype);
__freeze__(Date.prototype);
__freeze__(Map.prototype);
__freeze__(Set.prototype);
__freeze__(WeakMap.prototype);
__freeze__(WeakSet.prototype);
__freeze__(Promise.prototype);
__freeze__(Error.prototype);
__freeze__(TypeError.prototype);
__freeze__(RangeError.prototype);
__freeze__(ReferenceError.prototype);
__freeze__(SyntaxError.prototype);
__freeze__(URIError.prototype);
__freeze__(EvalError.prototype);
__freeze__(ArrayBuffer.prototype);
__freeze__(DataView.prototype);
__freeze__(Float32Array.prototype);
__freeze__(Float64Array.prototype);
__freeze__(Int8Array.prototype);
__freeze__(Int16Array.prototype);
__freeze__(Int32Array.prototype);
__freeze__(Uint8Array.prototype);
__freeze__(Uint16Array.prototype);
__freeze__(Uint32Array.prototype);
__freeze__(Uint8ClampedArray.prototype);
__freeze__(JSON);
__freeze__(Math);
__freeze__(Reflect);
`

// --- Helpers ---

/** Format a single console argument for output. */
function formatConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

/**
 * Create a console-like object that captures output to a string array.
 * Supports log, warn, error, info, and debug methods.
 */
function createCapturedConsole(stdout: string[]): Record<string, (...args: unknown[]) => void> {
  const format = (...args: unknown[]): string => args.map(formatConsoleArg).join(' ')
  return {
    log: (...args: unknown[]) => stdout.push(format(...args)),
    warn: (...args: unknown[]) => stdout.push(`[warn] ${format(...args)}`),
    error: (...args: unknown[]) => stdout.push(`[error] ${format(...args)}`),
    info: (...args: unknown[]) => stdout.push(`[info] ${format(...args)}`),
    debug: (...args: unknown[]) => stdout.push(`[debug] ${format(...args)}`),
  }
}

/**
 * Collect stdout entries from a DONT_CONTEXTIFY context's internal array.
 * Returns silently if retrieval fails.
 */
function collectInternalStdout(context: vm.Context, stdout: string[]): void {
  try {
    const entries = vm.runInContext('globalThis.__stdout__', context) as unknown
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        stdout.push(String(entry))
      }
    }
  } catch {
    // Retrieval failed — ignore (stdout may be partial)
  }
}

/**
 * Check if an unknown value is error-like (has name and message string properties).
 *
 * Errors thrown inside a DONT_CONTEXTIFY vm context are NOT `instanceof Error`
 * from the host's perspective — they originate from a separate V8 context with
 * its own Error prototype chain. This helper detects error-like objects by
 * duck-typing so that `classifyError` can inspect their properties.
 */
function isErrorLike(err: unknown): err is { name: string; message: string; code?: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as Record<string, unknown>).name === 'string' &&
    typeof (err as Record<string, unknown>).message === 'string'
  )
}

/**
 * Classify a vm execution error into a typed error result.
 *
 * Handles both host-native Error instances and cross-context error objects
 * from DONT_CONTEXTIFY vm contexts (where `instanceof Error` is false).
 */
function classifyError(
  err: unknown,
  timeoutMs: number,
): NonNullable<SandboxResult['error']> {
  if (!isErrorLike(err)) {
    return { message: String(err), type: 'runtime' }
  }

  // Timeout: vm throws with code ERR_SCRIPT_EXECUTION_TIMEOUT
  if (
    err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ||
    err.message.includes('Script execution timed out')
  ) {
    return {
      message: `Execution timed out (${timeoutMs / 1000}s limit)`,
      type: 'timeout',
    }
  }

  // eval()/Function() blocked by codeGeneration: { strings: false }
  if (
    err.name === 'EvalError' ||
    err.message.includes('Code generation from strings disallowed')
  ) {
    return {
      message: 'eval() and Function() are not allowed in the sandbox',
      type: 'security',
    }
  }

  // All other errors (SyntaxError, TypeError, ReferenceError, etc.)
  return { message: err.message, type: 'runtime' }
}

// --- Core ---

/**
 * Execute JavaScript code in a sandboxed vm context with zero I/O access.
 *
 * IMPORTANT: the `timeout` here bounds only SYNCHRONOUS execution. An async
 * microtask bomb returns instantly and then drains microtasks forever — which
 * is why this function must run inside a worker thread that the host
 * hard-terminates on a wall-clock deadline (see js-sandbox.ts). Never call
 * this directly on the Electron main thread.
 *
 * **Safe globals available in the sandbox:**
 * - Built-in V8: JSON, Math, Date, Array, Object, String, Number, Boolean,
 *   RegExp, Map, Set, Promise, Symbol, WeakMap, WeakSet, parseInt, parseFloat,
 *   isNaN, isFinite, NaN, Infinity, undefined, encodeURI, decodeURI,
 *   encodeURIComponent, decodeURIComponent, ArrayBuffer, DataView, typed arrays
 * - Injected: console (captured), inputData (deep-cloned), structuredClone
 *
 * **Blocked:**
 * - require, import, process, fs, child_process, Buffer
 * - setTimeout, setInterval, setImmediate, fetch, XMLHttpRequest
 * - eval() and Function() constructor (via codeGeneration restriction)
 * - Prototype pollution (all built-in prototypes frozen before user code)
 *
 * Uses `vm.constants.DONT_CONTEXTIFY` when available (Node 20.18.0+ / Electron 33+)
 * for a vanilla V8 context with reliable prototype freezing. Falls back to regular
 * `vm.createContext()` on older Node.js versions.
 */
export function executeInVm(
  code: string,
  inputData?: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): SandboxResult {
  const stdout: string[] = []
  const effectiveTimeout = Math.min(Math.max(timeoutMs, 1), MAX_TIMEOUT_MS)
  let context: vm.Context | undefined
  let useInternalStdout = false

  try {
    // Deep-clone inputData to prevent reference leaks between host and sandbox
    const clonedInput = inputData !== undefined ? structuredClone(inputData) : undefined

    // Detect vm.constants.DONT_CONTEXTIFY (Node 20.18.0+ / Electron 33+)
    const vmConstants = (vm as Record<string, unknown>).constants as
      | Record<string, symbol>
      | undefined
    const DONT_CONTEXTIFY = vmConstants?.DONT_CONTEXTIFY

    if (DONT_CONTEXTIFY) {
      // Vanilla V8 context — prototypes freeze reliably, no proxy on global.
      // The context has default V8 built-ins but no Node.js APIs.
      context = vm.createContext(
        DONT_CONTEXTIFY as unknown as object,
        { codeGeneration: { strings: false, wasm: false } },
      )

      // Create console capture entirely inside the context.
      // Host functions can't be passed directly to DONT_CONTEXTIFY contexts,
      // so we build the capture mechanism in-context and retrieve stdout after.
      vm.runInContext(`
        const __stdout__ = [];
        const __fmt__ = (a) => {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch(e) { return String(a); }
        };
        const __join__ = (...args) => args.map(__fmt__).join(' ');
        globalThis.console = {
          log: (...a) => __stdout__.push(__join__(...a)),
          warn: (...a) => __stdout__.push('[warn] ' + __join__(...a)),
          error: (...a) => __stdout__.push('[error] ' + __join__(...a)),
          info: (...a) => __stdout__.push('[info] ' + __join__(...a)),
          debug: (...a) => __stdout__.push('[debug] ' + __join__(...a)),
        };
        globalThis.__stdout__ = __stdout__;
      `, context)
      useInternalStdout = true

      // Inject inputData via JSON serialization (safe for agent tool data)
      if (clonedInput !== undefined) {
        try {
          const serialized = JSON.stringify(clonedInput)
          vm.runInContext(`globalThis.inputData = ${serialized};`, context)
        } catch {
          // If inputData can't be JSON-serialized, inject undefined
          vm.runInContext('globalThis.inputData = undefined;', context)
        }
      }
    } else {
      // Regular contextified approach — works on all Node.js versions.
      // The context object becomes the global, with its own V8 built-ins
      // (Object, Array, etc.) that are separate from the host's.
      const sandbox: Record<string, unknown> = {
        console: createCapturedConsole(stdout),
        structuredClone,
      }
      if (clonedInput !== undefined) {
        sandbox.inputData = clonedInput
      }

      context = vm.createContext(sandbox, {
        codeGeneration: { strings: false, wasm: false },
      })
    }

    // Freeze all built-in prototypes before user code runs.
    // This prevents prototype pollution attacks.
    vm.runInContext(FREEZE_PROTOTYPES_CODE, context)

    // Run user code in strict mode.
    // Strict mode ensures modification of frozen prototypes throws TypeError
    // (rather than failing silently), and prevents undeclared variable assignment.
    const strictCode = `'use strict';\n${code}`
    const result = vm.runInContext(strictCode, context, {
      timeout: effectiveTimeout,
      filename: 'sandbox.js',
    })

    // Retrieve stdout from DONT_CONTEXTIFY context's internal array
    if (useInternalStdout) {
      collectInternalStdout(context, stdout)
    }

    return { result, stdout }
  } catch (err) {
    // Attempt to collect any stdout captured before the error
    if (useInternalStdout && context) {
      collectInternalStdout(context, stdout)
    }

    return {
      result: undefined,
      stdout,
      error: classifyError(err, effectiveTimeout),
    }
  }
}
