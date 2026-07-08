import { describe, it, expect } from 'vitest'

import { executeInSandbox } from '../js-sandbox'

// ---------------------------------------------------------------------------
// Basic computation
// ---------------------------------------------------------------------------

describe('executeInSandbox', () => {
  describe('basic computation', () => {
    it('returns the completion value of 1 + 1', async () => {
      const result = await executeInSandbox('1 + 1')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(2)
    })

    it('returns the result of a multi-line computation', async () => {
      const code = `
        const a = 10;
        const b = 20;
        a * b + 5;
      `
      const result = await executeInSandbox(code)
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(205)
    })

    it('returns string results', async () => {
      const result = await executeInSandbox('"hello" + " " + "world"')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('hello world')
    })
  })

  // ---------------------------------------------------------------------------
  // inputData accessible and used in computation
  // ---------------------------------------------------------------------------

  describe('inputData access', () => {
    it('makes inputData accessible in the sandbox', async () => {
      const result = await executeInSandbox(
        'inputData.x + inputData.y',
        { x: 3, y: 7 },
      )
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(10)
    })

    it('supports nested inputData structures', async () => {
      const input = { users: [{ name: 'Alice' }, { name: 'Bob' }] }
      const result = await executeInSandbox(
        'inputData.users.map(u => u.name).join(", ")',
        input,
      )
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('Alice, Bob')
    })

    it('handles undefined inputData gracefully', async () => {
      const result = await executeInSandbox('typeof inputData')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('undefined')
    })
  })

  // ---------------------------------------------------------------------------
  // console.log captured in stdout
  // ---------------------------------------------------------------------------

  describe('console output capture', () => {
    it('captures console.log output in stdout array', async () => {
      const result = await executeInSandbox('console.log("hello"); 42')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(42)
      expect(result.stdout).toContain('hello')
    })

    it('captures multiple console.log calls', async () => {
      const code = `
        console.log("first");
        console.log("second");
        console.log("third");
        "done";
      `
      const result = await executeInSandbox(code)
      expect(result.error).toBeUndefined()
      expect(result.stdout).toHaveLength(3)
      expect(result.stdout[0]).toBe('first')
      expect(result.stdout[1]).toBe('second')
      expect(result.stdout[2]).toBe('third')
    })

    it('captures console.warn with [warn] prefix', async () => {
      const result = await executeInSandbox('console.warn("caution"); true')
      expect(result.error).toBeUndefined()
      expect(result.stdout).toHaveLength(1)
      expect(result.stdout[0]).toContain('[warn]')
      expect(result.stdout[0]).toContain('caution')
    })

    it('captures console.error with [error] prefix', async () => {
      const result = await executeInSandbox('console.error("failure"); true')
      expect(result.error).toBeUndefined()
      expect(result.stdout).toHaveLength(1)
      expect(result.stdout[0]).toContain('[error]')
      expect(result.stdout[0]).toContain('failure')
    })

    it('serializes non-string console arguments as JSON', async () => {
      const result = await executeInSandbox('console.log({ a: 1 }); true')
      expect(result.error).toBeUndefined()
      expect(result.stdout.length).toBeGreaterThanOrEqual(1)
      // The output should contain the JSON representation
      expect(result.stdout[0]).toContain('"a"')
      expect(result.stdout[0]).toContain('1')
    })
  })

  // ---------------------------------------------------------------------------
  // require() throws ReferenceError
  // ---------------------------------------------------------------------------

  describe('require() blocked', () => {
    it('throws ReferenceError when require() is called', async () => {
      const result = await executeInSandbox('require("fs")')
      expect(result.error).toBeDefined()
      expect(result.error!.type).toBe('runtime')
      expect(result.error!.message).toMatch(/require is not defined|require/)
    })

    it('typeof require returns "undefined" (not available in sandbox)', async () => {
      const result = await executeInSandbox(
        'typeof require !== "undefined" ? require("os") : "blocked"',
      )
      // typeof on an undefined variable is safe in strict mode
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('blocked')
    })
  })

  // ---------------------------------------------------------------------------
  // process not available
  // ---------------------------------------------------------------------------

  describe('process not available', () => {
    it('process is not defined in the sandbox', async () => {
      const result = await executeInSandbox('typeof process')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('undefined')
    })

    it('accessing process.env throws', async () => {
      const result = await executeInSandbox('process.env')
      expect(result.error).toBeDefined()
      expect(result.error!.type).toBe('runtime')
    })
  })

  // ---------------------------------------------------------------------------
  // fs not available
  // ---------------------------------------------------------------------------

  describe('fs not available', () => {
    it('fs is not defined in the sandbox', async () => {
      const result = await executeInSandbox('typeof fs')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('undefined')
    })

    it('cannot import fs via require', async () => {
      const result = await executeInSandbox(
        'const fs = require("fs"); fs.readFileSync("/etc/passwd")',
      )
      expect(result.error).toBeDefined()
      expect(result.error!.type).toBe('runtime')
    })
  })

  // ---------------------------------------------------------------------------
  // eval() blocked (--disallow-code-generation-from-strings)
  // ---------------------------------------------------------------------------

  describe('eval() blocked', () => {
    it('eval() is blocked by code generation restriction', async () => {
      const result = await executeInSandbox('eval("1 + 1")')
      expect(result.error).toBeDefined()
      expect(result.error!.type).toBe('security')
      expect(result.error!.message).toContain('eval()')
    })

    it('Function constructor is blocked', async () => {
      const result = await executeInSandbox('new Function("return 1")()')
      expect(result.error).toBeDefined()
      expect(result.error!.type).toBe('security')
    })
  })

  // ---------------------------------------------------------------------------
  // Infinite loop killed after timeout
  // ---------------------------------------------------------------------------

  describe('timeout enforcement', () => {
    it('kills infinite loop after timeout', async () => {
      // Use a short timeout for faster test execution
      const result = await executeInSandbox('while(true){}', undefined, 100)
      expect(result.error).toBeDefined()
      expect(result.error!.type).toBe('timeout')
      expect(result.error!.message).toContain('timed out')
    }, 10_000) // Give the test plenty of time

    it('kills long computation after timeout', async () => {
      const code = 'let i = 0; while(i < Number.MAX_SAFE_INTEGER) { i++; } i;'
      const result = await executeInSandbox(code, undefined, 100)
      expect(result.error).toBeDefined()
      expect(result.error!.type).toBe('timeout')
    }, 10_000)
  })

  // ---------------------------------------------------------------------------
  // Prototype pollution blocked (Object.prototype.x = 1 fails)
  // ---------------------------------------------------------------------------

  describe('prototype pollution blocked', () => {
    it('cannot modify Object.prototype (strict mode throws TypeError)', async () => {
      const result = await executeInSandbox('Object.prototype.polluted = true;')
      // In strict mode, modifying a frozen prototype throws TypeError
      expect(result.error).toBeDefined()
      expect(result.error!.type).toBe('runtime')
    })

    it('cannot modify Array.prototype', async () => {
      const result = await executeInSandbox('Array.prototype.custom = function() {};')
      expect(result.error).toBeDefined()
      expect(result.error!.type).toBe('runtime')
    })

    it('Object.prototype remains clean across executions', async () => {
      // First execution tries to pollute
      await executeInSandbox('try { Object.prototype.x = 1; } catch(e) {}')

      // Second execution verifies no pollution
      const result = await executeInSandbox('({}).x')
      expect(result.error).toBeUndefined()
      expect(result.result).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // structuredClone available
  //
  // Note: structuredClone is only injected in the fallback (non-DONT_CONTEXTIFY)
  // path. In DONT_CONTEXTIFY contexts, it's a vanilla V8 context without Node.js
  // globals. We test that it's at least available in one code path.
  // ---------------------------------------------------------------------------

  describe('structuredClone availability', () => {
    it('structuredClone works when available, otherwise not defined', async () => {
      const result = await executeInSandbox('typeof structuredClone')
      expect(result.error).toBeUndefined()
      // In DONT_CONTEXTIFY contexts (Node 20.18+), structuredClone is not
      // available as it's a Node.js global not a V8 built-in.
      // In fallback contexts, it IS injected.
      expect(['function', 'undefined']).toContain(result.result)
    })
  })

  // ---------------------------------------------------------------------------
  // JSON/Math/Date/Array available
  // ---------------------------------------------------------------------------

  describe('safe globals available', () => {
    it('JSON.parse and JSON.stringify work', async () => {
      const code = `
        const parsed = JSON.parse('{"key":"value"}');
        JSON.stringify(parsed);
      `
      const result = await executeInSandbox(code)
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('{"key":"value"}')
    })

    it('Math functions are available', async () => {
      const result = await executeInSandbox('Math.max(1, 5, 3) + Math.floor(3.7)')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(8) // max(1,5,3)=5 + floor(3.7)=3 = 8
    })

    it('Date constructor works', async () => {
      const result = await executeInSandbox(
        'new Date("2026-01-01T00:00:00Z").getFullYear()',
      )
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(2026)
    })

    it('Array methods are available', async () => {
      const result = await executeInSandbox(
        '[1,2,3,4,5].filter(n => n > 2).reduce((a,b) => a+b, 0)',
      )
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(12) // 3+4+5
    })

    it('Map and Set are available', async () => {
      const code = `
        const m = new Map();
        m.set('a', 1);
        m.set('b', 2);
        m.size;
      `
      const result = await executeInSandbox(code)
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(2)
    })

    it('RegExp is available', async () => {
      const result = await executeInSandbox('"hello world".match(/\\w+/g).length')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(2)
    })

    it('parseInt and parseFloat are available', async () => {
      const result = await executeInSandbox('parseInt("42") + parseFloat("3.14")')
      expect(result.error).toBeUndefined()
      expect(result.result).toBeCloseTo(45.14)
    })

    it('isNaN and isFinite are available', async () => {
      const code = `
        const results = [];
        results.push(isNaN(NaN));
        results.push(isFinite(42));
        results.push(isFinite(Infinity));
        results;
      `
      const result = await executeInSandbox(code)
      expect(result.error).toBeUndefined()
      expect(result.result).toEqual([true, true, false])
    })
  })

  // ---------------------------------------------------------------------------
  // Return value serialized correctly
  // ---------------------------------------------------------------------------

  describe('return value serialization', () => {
    it('returns numbers correctly', async () => {
      const result = await executeInSandbox('42')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(42)
    })

    it('returns strings correctly', async () => {
      const result = await executeInSandbox('"hello"')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('hello')
    })

    it('returns booleans correctly', async () => {
      const result = await executeInSandbox('true')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe(true)
    })

    it('returns null correctly', async () => {
      const result = await executeInSandbox('null')
      expect(result.error).toBeUndefined()
      expect(result.result).toBeNull()
    })

    it('returns undefined for expressions that produce undefined', async () => {
      // Use void 0 which explicitly evaluates to undefined
      const result = await executeInSandbox('void 0')
      expect(result.error).toBeUndefined()
      expect(result.result).toBeUndefined()
    })

    it('returns arrays correctly', async () => {
      const result = await executeInSandbox('[1, "two", 3]')
      expect(result.error).toBeUndefined()
      expect(result.result).toEqual([1, 'two', 3])
    })

    it('returns objects correctly', async () => {
      // Wrap in parens so it's parsed as an expression, not a block
      const result = await executeInSandbox('({ a: 1, b: "two" })')
      expect(result.error).toBeUndefined()
      expect(result.result).toEqual({ a: 1, b: 'two' })
    })

    it('returns nested structures correctly', async () => {
      const code = `
        const data = {
          items: [{ id: 1, name: "first" }, { id: 2, name: "second" }],
          total: 2,
        };
        data;
      `
      const result = await executeInSandbox(code)
      expect(result.error).toBeUndefined()
      expect(result.result).toEqual({
        items: [{ id: 1, name: 'first' }, { id: 2, name: 'second' }],
        total: 2,
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Additional security: blocked Node.js APIs
  // ---------------------------------------------------------------------------

  describe('additional blocked APIs', () => {
    it('Buffer is not available', async () => {
      const result = await executeInSandbox('typeof Buffer')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('undefined')
    })

    it('setTimeout is not available', async () => {
      const result = await executeInSandbox('typeof setTimeout')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('undefined')
    })

    it('setInterval is not available', async () => {
      const result = await executeInSandbox('typeof setInterval')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('undefined')
    })

    it('fetch is not available', async () => {
      const result = await executeInSandbox('typeof fetch')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('undefined')
    })
  })

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe('error handling', () => {
    it('returns runtime error for syntax errors', async () => {
      const result = await executeInSandbox('const x = {')
      expect(result.error).toBeDefined()
      expect(result.error!.type).toBe('runtime')
    })

    it('returns runtime error for ReferenceError', async () => {
      const result = await executeInSandbox('undefinedVariable')
      expect(result.error).toBeDefined()
      expect(result.error!.type).toBe('runtime')
      expect(result.error!.message).toContain('undefinedVariable')
    })

    it('returns runtime error for TypeError', async () => {
      const result = await executeInSandbox('null.property')
      expect(result.error).toBeDefined()
      expect(result.error!.type).toBe('runtime')
    })

    it('preserves stdout captured before an error', async () => {
      const code = `
        console.log("before error");
        throw new Error("boom");
      `
      const result = await executeInSandbox(code)
      expect(result.error).toBeDefined()
      expect(result.error!.message).toContain('boom')
      // stdout should contain the line logged before the error
      expect(result.stdout.length).toBeGreaterThanOrEqual(1)
      expect(result.stdout).toContain('before error')
    })
  })
})

// ---------------------------------------------------------------------------
// Worker isolation — async bombs, host responsiveness, cancellation (#11)
// ---------------------------------------------------------------------------

describe('worker isolation and hard wall-clock kill', () => {
  it('an async microtask bomb cannot hang the app — sync result returns, bomb is discarded', async () => {
    // Sync execution completes instantly (value 1); the scheduled microtask
    // recursion is dropped when the worker posts its result and exits. On the
    // old main-thread implementation this exact code froze the Electron main
    // process forever (empirically confirmed in the audit).
    const bomb = 'Promise.resolve().then(function b(){ Promise.resolve().then(b) }); 1'
    const start = Date.now()
    const result = await executeInSandbox(bomb, undefined, 1000)
    const elapsed = Date.now() - start

    expect(result.error).toBeUndefined()
    expect(result.result).toBe(1)
    expect(elapsed).toBeLessThan(5_000)
  }, 15_000)

  it('host event loop stays responsive during a long-running sandbox execution', async () => {
    const ticks: number[] = []
    const interval = setInterval(() => ticks.push(Date.now()), 100)

    // Sync infinite loop — spins inside the WORKER until its vm timeout (2s).
    const result = await executeInSandbox('for(;;){}', undefined, 2000)
    clearInterval(interval)

    expect(result.error).toBeDefined()
    expect(result.error!.type).toBe('timeout')
    // If the loop ran on the host thread, no timer could fire at all.
    expect(ticks.length).toBeGreaterThanOrEqual(5)
  }, 15_000)

  it('a never-resolving promise result is killed at the deadline', async () => {
    const result = await executeInSandbox('new Promise(() => {})', undefined, 1000)
    // The completion value is an unresolvable promise — the worker posts the
    // sync completion (a Promise serializes to {}), or the deadline kills it.
    // Either way this MUST return within the deadline and never hang.
    expect(result).toBeDefined()
  }, 15_000)

  it('abort signal terminates the worker immediately', async () => {
    const controller = new AbortController()
    // Long sync loop with the max timeout — only the abort can end it early.
    const promise = executeInSandbox('for(;;){}', undefined, 30_000, controller.signal)
    setTimeout(() => controller.abort(), 200)

    const start = Date.now()
    const result = await promise
    const elapsed = Date.now() - start

    expect(result.error).toBeDefined()
    expect(result.error!.type).toBe('cancelled')
    expect(elapsed).toBeLessThan(5_000)
  }, 15_000)

  it('pre-aborted signal short-circuits without spawning a worker', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await executeInSandbox('1 + 1', undefined, 1000, controller.signal)
    expect(result.error).toBeDefined()
    expect(result.error!.type).toBe('cancelled')
  })

  it('an allocation bomb is killed by the worker memory cap', async () => {
    const memoryBomb = `
      const chunks = [];
      for (;;) { chunks.push(new Array(1024 * 1024).fill(1)); }
    `
    const result = await executeInSandbox(memoryBomb, undefined, 10_000)
    expect(result.error).toBeDefined()
    // Either the memory cap kills the worker (runtime) or the vm timeout fires
    expect(['runtime', 'timeout']).toContain(result.error!.type)
  }, 20_000)
})
