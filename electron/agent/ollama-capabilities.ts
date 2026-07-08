/**
 * Ollama model capability probe (audit #28).
 *
 * Many Ollama models cannot tool-call; binding tools to one produces a
 * confusing provider error (or silent non-calls) deep inside the agent loop.
 * Ollama ≥ 0.4 reports a `capabilities` array from `POST /api/show` — probe it
 * up front and surface a clear error instead.
 */

export interface OllamaToolSupport {
  /** 'unknown' when the server is old or unreachable — callers must not block on it. */
  supported: boolean | 'unknown'
  detail?: string
}

const SHOW_TIMEOUT_MS = 5_000

/**
 * Check whether an Ollama model supports tool calling.
 *
 * Fails open: an unreachable server, older Ollama without the `capabilities`
 * field, or an unexpected payload all return 'unknown' — only an explicit
 * capabilities list missing 'tools' returns false.
 */
export async function checkOllamaToolSupport(
  baseUrl: string | undefined,
  model: string,
  signal?: AbortSignal,
): Promise<OllamaToolSupport> {
  const url = `${(baseUrl || 'http://localhost:11434').replace(/\/+$/, '')}/api/show`

  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), SHOW_TIMEOUT_MS)
  const onOuterAbort = (): void => timeoutController.abort()
  signal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: timeoutController.signal,
    })
    if (res.status === 404) {
      // Model not pulled — a different, equally actionable problem.
      return { supported: 'unknown', detail: `Model "${model}" was not found on the Ollama server. Pull it with \`ollama pull ${model}\`.` }
    }
    if (!res.ok) return { supported: 'unknown' }

    const body = (await res.json()) as { capabilities?: unknown }
    if (!Array.isArray(body.capabilities)) {
      // Pre-0.4 Ollama — no capability reporting; don't block.
      return { supported: 'unknown' }
    }
    if (body.capabilities.includes('tools')) {
      return { supported: true }
    }
    return {
      supported: false,
      detail:
        `The Ollama model "${model}" does not support tool calling — the agent cannot work with it. ` +
        'Pick a tool-capable model (e.g. qwen3, llama3.1, mistral-nemo, devstral) in Settings → AI/Agent.',
    }
  } catch {
    return { supported: 'unknown' }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}
