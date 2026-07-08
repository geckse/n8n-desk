/**
 * Ollama tool-capability probe (audit #28) against a real local HTTP server
 * mimicking Ollama's /api/show endpoint.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import type { AddressInfo } from 'net'

import { checkOllamaToolSupport } from '../ollama-capabilities'

let httpServer: http.Server
let baseUrl: string

/** Per-model responses the fake Ollama serves. */
const models: Record<string, { status: number; body?: unknown }> = {
  'qwen3': { status: 200, body: { capabilities: ['completion', 'tools'] } },
  'gemma-embed': { status: 200, body: { capabilities: ['completion'] } },
  'old-server-model': { status: 200, body: { modelfile: '...' } }, // pre-0.4: no capabilities
  'broken': { status: 500 },
}

beforeAll(async () => {
  httpServer = http.createServer((req, res) => {
    if (req.url !== '/api/show' || req.method !== 'POST') {
      res.writeHead(404).end()
      return
    }
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const { model } = JSON.parse(raw) as { model: string }
      const entry = models[model]
      if (!entry) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: `model "${model}" not found` }))
        return
      }
      res.writeHead(entry.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(entry.body ?? {}))
    })
  })
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())))
})

describe('checkOllamaToolSupport (audit #28)', () => {
  it('reports support for a tool-capable model', async () => {
    expect(await checkOllamaToolSupport(baseUrl, 'qwen3')).toEqual({ supported: true })
  })

  it('reports NO support with an actionable message for a non-tool model', async () => {
    const result = await checkOllamaToolSupport(baseUrl, 'gemma-embed')
    expect(result.supported).toBe(false)
    expect(result.detail).toMatch(/does not support tool calling/)
    expect(result.detail).toMatch(/gemma-embed/)
  })

  it('fails open (unknown) on servers without capability reporting', async () => {
    const result = await checkOllamaToolSupport(baseUrl, 'old-server-model')
    expect(result.supported).toBe('unknown')
  })

  it('fails open (unknown) on server errors', async () => {
    expect((await checkOllamaToolSupport(baseUrl, 'broken')).supported).toBe('unknown')
  })

  it('hints at ollama pull for missing models', async () => {
    const result = await checkOllamaToolSupport(baseUrl, 'never-pulled')
    expect(result.supported).toBe('unknown')
    expect(result.detail).toMatch(/ollama pull never-pulled/)
  })

  it('fails open on an unreachable server', async () => {
    const result = await checkOllamaToolSupport('http://127.0.0.1:1', 'qwen3')
    expect(result.supported).toBe('unknown')
  })
})
