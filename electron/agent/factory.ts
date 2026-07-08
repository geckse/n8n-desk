import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import type { AgentRunner, AgentBackend, LlmProviderConfig } from './types'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')
const LLM_CONFIG_PATH = path.join(BASE_DIR, 'llm.json')

// --- LLM Config Persistence ---

/**
 * The settings UI saves llm.json in one of two shapes:
 *
 * ClaudeSdkConfig:  { backend: 'claude-sdk', apiKey, model }
 * DeepAgentsConfig: { backend: 'deep-agents', provider, model, apiKey?, ollamaBaseUrl? }
 */
interface ClaudeSdkConfigFile {
  backend: 'claude-sdk'
  apiKey: string
  model: string
}

interface DeepAgentsConfigFile {
  backend: 'deep-agents'
  provider: 'anthropic' | 'openai' | 'ollama'
  model: string
  apiKey?: string
  ollamaBaseUrl?: string
}

type LlmConfigFile = ClaudeSdkConfigFile | DeepAgentsConfigFile

/** Thrown when llm.json exists but holds an invalid backend/provider combination. */
export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmConfigError'
  }
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

const DEEP_AGENTS_PROVIDERS = ['anthropic', 'openai', 'ollama'] as const

/**
 * Validate an llm.json shape and normalize it into a provider config.
 * Exported for tests; resolveLlmConfig() is the file-reading wrapper.
 *
 * @throws LlmConfigError with an actionable message on invalid combinations —
 *   a null return is reserved for "not configured at all".
 */
interface RawLlmConfig {
  backend?: string
  provider?: 'anthropic' | 'openai' | 'ollama' | string
  model?: string
  apiKey?: string
  ollamaBaseUrl?: string
}

export function validateLlmConfig(
  config: RawLlmConfig | null,
): (LlmProviderConfig & { backend: AgentBackend }) | null {
  if (!config) return null

  if (config.backend !== 'claude-sdk' && config.backend !== 'deep-agents') {
    throw new LlmConfigError(
      `llm.json has an invalid "backend" value (${JSON.stringify(config.backend ?? null)}). ` +
      'Expected "claude-sdk" or "deep-agents" — re-save your settings in Settings → AI/Agent.',
    )
  }
  if (!config.model) {
    throw new LlmConfigError('llm.json has no "model" configured. Choose a model in Settings → AI/Agent.')
  }

  if (config.backend === 'claude-sdk') {
    // The Claude SDK backend always talks to the Anthropic API — a hand-edited
    // provider field cannot change that, so reject it instead of silently
    // ignoring it.
    if (config.provider && config.provider !== 'anthropic') {
      throw new LlmConfigError(
        `The Claude SDK backend only supports Anthropic models (llm.json has provider "${config.provider}"). ` +
        'Switch the backend to Deep Agents or the provider to Anthropic in Settings → AI/Agent.',
      )
    }
    if (!config.apiKey) {
      throw new LlmConfigError('The Claude SDK backend needs an Anthropic API key. Add one in Settings → AI/Agent.')
    }
    return {
      backend: 'claude-sdk',
      provider: 'anthropic',
      model: config.model,
      apiKey: config.apiKey,
    }
  }

  // deep-agents backend
  const provider = config.provider
  if (!provider || !(DEEP_AGENTS_PROVIDERS as readonly string[]).includes(provider)) {
    throw new LlmConfigError(
      `llm.json has an invalid "provider" value (${JSON.stringify(provider ?? null)}). ` +
      'Expected "anthropic", "openai", or "ollama" — re-save your settings in Settings → AI/Agent.',
    )
  }
  if ((provider === 'anthropic' || provider === 'openai') && !config.apiKey) {
    throw new LlmConfigError(
      `The ${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} provider needs an API key. Add one in Settings → AI/Agent.`,
    )
  }
  return {
    backend: 'deep-agents',
    provider: provider as 'anthropic' | 'openai' | 'ollama',
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: provider === 'ollama' ? config.ollamaBaseUrl : undefined,
  }
}

/**
 * Resolve LLM provider config from ~/.n8n-desk/llm.json.
 * Returns the configured backend + provider configuration, or null if not
 * configured. The `backend` field is authoritative (CLAUDE.md hard rule:
 * never derive the backend from the provider — Anthropic works on both).
 *
 * @throws LlmConfigError when the file exists but holds an invalid combination.
 */
export async function resolveLlmConfig(): Promise<(LlmProviderConfig & { backend: AgentBackend }) | null> {
  return validateLlmConfig(await readLlmConfig())
}

// --- Stub Runners ---

// ClaudeSdkRunner is imported from its own module
import { ClaudeSdkRunner } from './claude-sdk-runner'
import { DeepAgentsRunner } from './deep-agents-runner'

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
