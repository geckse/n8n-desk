import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import type { AgentRunner, AgentRunnerConfig, AgentBackend, LlmProviderConfig } from './types'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')
const LLM_CONFIG_PATH = path.join(BASE_DIR, 'llm.json')

// --- LLM Config Persistence ---

interface LlmConfigFile {
  defaultProvider: string
  providers: Record<string, {
    model: string
    apiKey?: string
    baseUrl?: string
  }>
}

/**
 * Read LLM configuration from ~/.n8n-desk/llm.json.
 * Returns null if the file does not exist or is invalid.
 */
export async function readLlmConfig(): Promise<LlmConfigFile | null> {
  try {
    const content = await fs.readFile(LLM_CONFIG_PATH, 'utf-8')
    return JSON.parse(content) as LlmConfigFile
  } catch {
    return null
  }
}

/**
 * Resolve LLM provider config from ~/.n8n-desk/llm.json.
 * Returns the default provider's configuration, or null if not configured.
 */
export async function resolveLlmConfig(): Promise<LlmProviderConfig | null> {
  const config = await readLlmConfig()
  if (!config?.defaultProvider || !config.providers?.[config.defaultProvider]) {
    return null
  }

  const provider = config.defaultProvider as LlmProviderConfig['provider']
  const providerConfig = config.providers[config.defaultProvider]

  return {
    provider,
    model: providerConfig.model,
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.baseUrl,
  }
}

// --- Stub Runners ---

// ClaudeSdkRunner is imported from its own module
import { ClaudeSdkRunner } from './claude-sdk-runner'

/**
 * Placeholder runner for the Deep Agents SDK backend.
 * Will be implemented when the SDK integration is built.
 */
class DeepAgentsRunner implements AgentRunner {
  async *invoke(
    sessionId: string,
    _message: string,
    _config: AgentRunnerConfig,
  ): AsyncIterable<import('./types').AgentStreamEvent> {
    yield {
      type: 'error',
      sessionId,
      data: { message: 'Deep Agents backend is not yet implemented', code: 'NOT_IMPLEMENTED' },
    }
    yield { type: 'done', sessionId, data: { reason: 'error' } }
  }

  async stop(_sessionId: string): Promise<void> {
    // No-op for stub
  }

  async approve(_sessionId: string, _decision: 'approve' | 'reject'): Promise<void> {
    // No-op for stub
  }
}

// --- Factory ---

/**
 * Create an agent runner based on the specified backend.
 * The runner handles agent session lifecycle (invoke, stop, approve).
 */
export function createAgentRunner(backend: AgentBackend): AgentRunner {
  switch (backend) {
    case 'claude-sdk':
      return new ClaudeSdkRunner()
    case 'deep-agents':
      return new DeepAgentsRunner()
    default:
      throw new Error(`Unknown agent backend: ${backend as string}`)
  }
}
