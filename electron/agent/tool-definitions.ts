import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { ToolMessage } from '@langchain/core/messages'
import {
  callToolWithUrl,
  listToolsWithUrl,
  defaultTimeoutForTool,
  McpUnauthorizedError,
  type McpToolInfo,
} from '../mcp-client'

// --- Types ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LangChainTool = any

/** Result of discovering the n8n MCP server's tool surface. */
export interface N8nToolDiscovery {
  /** LangChain tool wrappers with BARE names (search_nodes, execute_workflow, ...) */
  tools: LangChainTool[]
  /** Raw tool infos as returned by tools/list */
  toolInfos: McpToolInfo[]
  /**
   * Tool names the server marks as non-read-only (annotations.readOnlyHint === false).
   * Callers ADD these to the approval set — annotations can only ever add
   * gating on top of the static DESTRUCTIVE_TOOLS floor, never remove it.
   */
  mutatingToolNames: string[]
}

// --- Mid-session token refresh (audit #41) ---

/**
 * Mutable bearer-token state shared by all tool wrappers of one discovery.
 *
 * Access tokens must not be frozen at invoke time: a long session outlives
 * the token TTL and every later tool call dies with a silent 401. On
 * McpUnauthorizedError the session refreshes ONCE (single-flight across
 * concurrent tool calls) and retries; if that fails the user gets an
 * actionable re-auth message instead of a dead session.
 */
class McpAuthState {
  private refreshPromise: Promise<string | null> | null = null

  constructor(
    private headersValue: Record<string, string>,
    private readonly refreshToken?: () => Promise<string | null>,
  ) {}

  static bearer(token: string, refreshToken?: () => Promise<string | null>): McpAuthState {
    return new McpAuthState({ Authorization: `Bearer ${token}` }, refreshToken)
  }

  headers(): Record<string, string> {
    return { ...this.headersValue }
  }

  get canRefresh(): boolean {
    return this.refreshToken !== undefined
  }

  /** Refresh the token (single-flight). Returns false when refresh is unavailable or failed. */
  async refresh(): Promise<boolean> {
    if (!this.refreshToken) return false
    this.refreshPromise ??= this.refreshToken().finally(() => {
      this.refreshPromise = null
    })
    const newToken = await this.refreshPromise
    if (!newToken) return false
    this.headersValue = { Authorization: `Bearer ${newToken}` }
    return true
  }
}

const REAUTH_MESSAGE =
  'The n8n session has expired and could not be refreshed. Sign in again from Settings → Instances, then retry.'

/** Run an MCP request; on 401 refresh the token once and retry. */
async function withAuthRetry<T>(auth: McpAuthState, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (!(err instanceof McpUnauthorizedError) || !auth.canRefresh) throw err
    const refreshed = await auth.refresh()
    if (!refreshed) throw new Error(REAUTH_MESSAGE)
    try {
      return await fn()
    } catch (retryErr) {
      if (retryErr instanceof McpUnauthorizedError) throw new Error(REAUTH_MESSAGE)
      throw retryErr
    }
  }
}

// --- JSON Schema → Zod Converter ---

/**
 * Convert a JSON Schema object to a Zod schema at runtime.
 *
 * Handles the constructs MCP tool schemas actually use: primitive types,
 * enums (string/number/mixed), const, arrays, objects (incl. additionalProperties),
 * anyOf/oneOf (unions — incl. the n8n discriminated-union execute_workflow inputs),
 * allOf (object merge), nullable type arrays (['string','null']), defaults, and
 * descriptions at every level. Falls back to z.any() only as a last resort.
 */
export function jsonSchemaToZod(schema: unknown): z.ZodTypeAny {
  // Boolean schemas: `true` = anything, `false` = nothing
  if (schema === true || schema === undefined || schema === null) return z.any()
  if (schema === false) return z.never()
  if (typeof schema !== 'object') return z.any()

  const s = schema as Record<string, unknown>
  let result = convertSchemaObject(s)

  if (typeof s.description === 'string') {
    result = result.describe(s.description)
  }
  if (s.default !== undefined) {
    result = result.default(s.default)
  }
  return result
}

function convertSchemaObject(s: Record<string, unknown>): z.ZodTypeAny {
  // const → literal
  if (s.const !== undefined) {
    return z.literal(s.const as z.Primitive)
  }

  // enum — string-only enums use z.enum, anything else a union of literals
  const enumValues = s.enum as unknown[] | undefined
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    if (enumValues.every((v) => typeof v === 'string')) {
      return z.enum(enumValues as [string, ...string[]])
    }
    if (enumValues.length === 1) return z.literal(enumValues[0] as z.Primitive)
    const literals = enumValues.map((v) => z.literal(v as z.Primitive))
    return z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
  }

  // anyOf / oneOf → union of converted branches
  const unionBranches = (s.anyOf ?? s.oneOf) as unknown[] | undefined
  if (Array.isArray(unionBranches) && unionBranches.length > 0) {
    const converted = unionBranches.map((b) => jsonSchemaToZod(b))
    if (converted.length === 1) return converted[0]
    return z.union(converted as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
  }

  // allOf → merge object schemas where possible, otherwise intersect
  const allOf = s.allOf as unknown[] | undefined
  if (Array.isArray(allOf) && allOf.length > 0) {
    const objectBranches = allOf.filter(
      (b): b is Record<string, unknown> =>
        typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'object',
    )
    if (objectBranches.length === allOf.length) {
      // All branches are objects — merge properties/required into one schema
      const merged: Record<string, unknown> = {
        type: 'object',
        properties: Object.assign({}, ...objectBranches.map((b) => b.properties ?? {})),
        required: objectBranches.flatMap((b) => (b.required as string[] | undefined) ?? []),
      }
      return convertSchemaObject(merged)
    }
    return allOf
      .map((b) => jsonSchemaToZod(b))
      .reduce((acc, cur) => z.intersection(acc, cur))
  }

  // Type arrays: ['string','null'] → nullable; general → union across types
  const type = s.type
  if (Array.isArray(type)) {
    const nonNull = type.filter((t) => t !== 'null')
    const hadNull = nonNull.length !== type.length
    let inner: z.ZodTypeAny
    if (nonNull.length === 0) {
      inner = z.null()
      return inner
    } else if (nonNull.length === 1) {
      inner = convertSchemaObject({ ...s, type: nonNull[0] })
    } else {
      const branches = nonNull.map((t) => convertSchemaObject({ ...s, type: t }))
      inner = z.union(branches as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
    }
    return hadNull ? inner.nullable() : inner
  }

  // OpenAPI-style nullable flag
  const applyNullable = (t: z.ZodTypeAny): z.ZodTypeAny => (s.nullable === true ? t.nullable() : t)

  switch (type) {
    case 'string':
      return applyNullable(z.string())
    case 'number':
      return applyNullable(z.number())
    case 'integer':
      return applyNullable(z.number().int())
    case 'boolean':
      return applyNullable(z.boolean())
    case 'null':
      return z.null()
    case 'array': {
      const items = s.items
      return applyNullable(z.array(items !== undefined ? jsonSchemaToZod(items) : z.any()))
    }
    case 'object':
      return applyNullable(convertObjectSchema(s))
    default:
      // No explicit type but object-ish keywords → treat as object
      if (s.properties || s.additionalProperties !== undefined) {
        return applyNullable(convertObjectSchema(s))
      }
      return z.any()
  }
}

function convertObjectSchema(s: Record<string, unknown>): z.ZodTypeAny {
  const properties = s.properties as Record<string, unknown> | undefined
  const required = (s.required as string[] | undefined) ?? []

  if (!properties || Object.keys(properties).length === 0) {
    // additionalProperties with a schema → typed record
    const ap = s.additionalProperties
    if (ap !== undefined && ap !== true && ap !== false) {
      return z.record(jsonSchemaToZod(ap))
    }
    return z.record(z.any())
  }

  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, propSchema] of Object.entries(properties)) {
    let zodType = jsonSchemaToZod(propSchema)
    // A property with a default is already optional-with-fallback; otherwise
    // non-required properties are optional.
    const hasDefault =
      typeof propSchema === 'object' && propSchema !== null &&
      (propSchema as Record<string, unknown>).default !== undefined
    if (!required.includes(key) && !hasDefault) {
      zodType = zodType.optional()
    }
    shape[key] = zodType
  }
  return z.object(shape)
}

// --- Dynamic MCP Tool Factories ---

/** Coerce a converted schema into the ZodObject LangChain tools expect. */
function toToolSchema(info: McpToolInfo): z.ZodTypeAny {
  if (!info.inputSchema) return z.object({})
  const converted = jsonSchemaToZod(info.inputSchema)
  return converted instanceof z.ZodObject ? converted : z.object({})
}

/**
 * Build the value a failed MCP tool call hands back to the agent loop.
 *
 * Failures MUST come back as a ToolMessage with status 'error', never a
 * throw: with middleware present (deepagents always installs wrapToolCall),
 * LangChain's ToolNode re-raises thrown tool errors instead of converting
 * them, which kills the whole run. Returning the error keeps the run alive so
 * the model can read the server's validation message (e.g. -32602 "String
 * must contain at most 255 character(s)"), fix its arguments, and retry —
 * matching the Claude SDK backend, whose MCP client surfaces the same
 * failures as is_error tool results.
 */
function toolErrorResult(
  errorText: string,
  toolName: string,
  toolCallId: string | undefined,
): ToolMessage | string {
  const content = `Tool ${toolName} failed: ${errorText}\nRead the error, fix the arguments or approach, and try again.`
  // Outside a ToolNode run (no tool_call_id) a ToolMessage cannot be built —
  // fall back to the plain text.
  if (!toolCallId) return content
  return new ToolMessage({
    content,
    name: toolName,
    tool_call_id: toolCallId,
    status: 'error',
  })
}

/**
 * Wrap a discovered MCP tool as a LangChain tool.
 *
 * The handler accepts `(args, config)` and forwards LangChain's per-run
 * `config.signal` into the HTTP request so `stop()` aborts in-flight calls.
 * Timeouts come from the per-tool policy in mcp-client.ts (execution-class
 * tools get the n8n server's 5-minute budget + margin).
 */
function wrapMcpTool(
  info: McpToolInfo,
  exposedName: string,
  serverUrl: string,
  auth: McpAuthState,
): LangChainTool {
  return tool(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: Record<string, unknown>, config?: { signal?: AbortSignal; toolCallId?: string; toolCall?: { id?: string } }): Promise<any> => {
      // ToolNode puts the id at config.toolCallId; a direct tool_call invoke
      // only carries config.toolCall.id.
      const toolCallId = config?.toolCallId ?? config?.toolCall?.id
      try {
        const result = await withAuthRetry(auth, () =>
          callToolWithUrl(serverUrl, auth.headers(), info.name, args, {
            timeoutMs: defaultTimeoutForTool(info.name),
            signal: config?.signal,
          }),
        )
        const text = result.content.map((c) => c.text ?? JSON.stringify(c)).join('\n')
        if (result.isError) {
          return toolErrorResult(text, exposedName, toolCallId)
        }
        return text
      } catch (err) {
        // stop() must still cancel the run — only genuine tool failures are
        // fed back to the model. Everything else (protocol-level McpError like
        // -32602 invalid params, timeouts, re-auth failures) becomes an error
        // result the model can act on.
        if (config?.signal?.aborted) throw err
        const message = err instanceof Error ? err.message : String(err)
        return toolErrorResult(message, exposedName, toolCallId)
      }
    },
    {
      name: exposedName,
      description: info.description ?? '',
      schema: toToolSchema(info),
    },
  )
}

/**
 * Discover the n8n MCP server's full tool surface via tools/list and wrap each
 * tool with its REAL server schema (bare names — no namespace prefix, so
 * system prompts and the approval set stay consistent across backends).
 *
 * Never hardcode this list: the server's tools, schemas, and count drift
 * (the reference snapshot has 14 tools, live cloud ~30). The server is the
 * authority (CLAUDE.md hard invariant).
 */
export async function discoverN8nMcpTools(
  mcpUrl: string,
  mcpAccessToken: string,
  options: {
    signal?: AbortSignal
    /**
     * Force-refresh the MCP access token (audit #41). Called when a tool call
     * hits a 401 mid-session; the wrapper retries once with the new token.
     */
    refreshToken?: () => Promise<string | null>
  } = {},
): Promise<N8nToolDiscovery> {
  const auth = McpAuthState.bearer(mcpAccessToken, options.refreshToken)
  const toolInfos = await withAuthRetry(auth, () =>
    listToolsWithUrl(mcpUrl, auth.headers(), { signal: options.signal }),
  )

  const tools = toolInfos.map((info) => wrapMcpTool(info, info.name, mcpUrl, auth))

  const mutatingToolNames = toolInfos
    .filter((info) => info.annotations?.readOnlyHint === false)
    .map((info) => info.name)

  return { tools, toolInfos, mutatingToolNames }
}

/**
 * Create LangChain tool wrappers for all tools discovered from custom MCP
 * servers. Tool names are namespaced as `{serverName}__{toolName}` to avoid
 * collisions across servers.
 *
 * Graceful degradation: if a server is unreachable or returns an error, its
 * tools are skipped and the remaining servers continue processing.
 */
export async function createDynamicMcpTools(
  servers: Record<string, { url: string; headers: Record<string, string> }>,
): Promise<LangChainTool[]> {
  const allTools: LangChainTool[] = []

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    try {
      const toolInfos = await listToolsWithUrl(serverConfig.url, serverConfig.headers)
      // Custom servers use static headers (no OAuth refresh path here) — the
      // auth state simply carries them unchanged.
      const auth = new McpAuthState({ ...serverConfig.headers })
      for (const info of toolInfos) {
        allTools.push(
          wrapMcpTool(info, `${serverName}__${info.name}`, serverConfig.url, auth),
        )
      }
    } catch (err) {
      // Graceful degradation — skip this server, continue with others
      const errMessage = err instanceof Error ? err.message : String(err)
      console.error(`[n8n-desk] Failed to discover tools from ${serverName}: ${errMessage}`)
    }
  }

  return allTools
}
