import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { callToolWithUrl, listToolsWithUrl } from '../mcp-client'

// --- Types ---

interface McpToolContext {
  mcpUrl: string
  mcpAccessToken: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LangChainTool = any

// --- Helper ---

function mcpTool(
  ctx: McpToolContext,
  name: string,
  description: string,
  schema: z.ZodObject<z.ZodRawShape>,
): LangChainTool {
  return tool(
    async (args: Record<string, unknown>) => {
      const result = await callToolWithUrl(
        ctx.mcpUrl,
        { Authorization: `Bearer ${ctx.mcpAccessToken}` },
        name,
        args as Record<string, unknown>,
      )
      if (result.isError) {
        const errorText = result.content
          .map((c) => c.text ?? JSON.stringify(c))
          .join('\n')
        throw new Error(errorText)
      }
      return result.content.map((c) => c.text ?? JSON.stringify(c)).join('\n')
    },
    { name, description, schema },
  )
}

// --- Factory ---

/**
 * Create all 13 LangChain tool wrappers for n8n MCP tools.
 * Each tool calls the resolved MCP server (default n8n MCP or a custom override).
 */
export function createMcpTools(mcpUrl: string, mcpAccessToken: string): LangChainTool[] {
  const ctx: McpToolContext = { mcpUrl, mcpAccessToken }

  return [
    // --- Node Discovery ---

    mcpTool(ctx, 'search_nodes', 'Search n8n nodes by service name, trigger type, or utility function. Returns node IDs and discriminators.', z.object({
      query: z.string().describe('Search query for node name, service, or function'),
    })),

    mcpTool(ctx, 'get_node_types', 'Get TypeScript type definitions for n8n nodes. Returns exact parameter names and structures.', z.object({
      nodeIds: z.array(z.string()).describe('Array of node IDs to get type definitions for'),
    })),

    mcpTool(ctx, 'get_suggested_nodes', 'Get curated node recommendations by workflow technique category (chatbot, notification, scheduling, etc.).', z.object({
      category: z.string().describe('Workflow technique category to get suggestions for'),
    })),

    // --- Workflow Building ---

    mcpTool(ctx, 'validate_workflow', 'Validate n8n Workflow SDK code. Parses and checks for errors before creating.', z.object({
      code: z.string().describe('n8n Workflow SDK code to validate'),
    })),

    mcpTool(ctx, 'create_workflow_from_code', 'Create a new workflow from validated SDK code.', z.object({
      code: z.string().describe('Validated n8n Workflow SDK code'),
      name: z.string().optional().describe('Optional workflow name'),
    })),

    mcpTool(ctx, 'update_workflow', 'Update an existing workflow from validated SDK code.', z.object({
      workflowId: z.string().describe('ID of the workflow to update'),
      code: z.string().describe('Validated n8n Workflow SDK code'),
    })),

    // --- Workflow Discovery ---

    mcpTool(ctx, 'search_workflows', 'Search and filter workflows by name, description, or project.', z.object({
      query: z.string().optional().describe('Search query string'),
      projectId: z.string().optional().describe('Filter by project ID'),
    })),

    mcpTool(ctx, 'get_workflow_details', 'Get detailed info about a workflow, including trigger details.', z.object({
      workflowId: z.string().describe('ID of the workflow to inspect'),
    })),

    // --- Execution ---

    mcpTool(ctx, 'execute_workflow', 'Execute an n8n workflow by ID. Supports chat, form, and webhook input types. Returns execution ID and status.', z.object({
      workflowId: z.string().describe('ID of the workflow to execute'),
      inputData: z.record(z.unknown()).optional().describe('Input data for the workflow'),
    })),

    mcpTool(ctx, 'get_execution', 'Get full execution details and results using execution ID and workflow ID.', z.object({
      executionId: z.string().describe('ID of the execution to inspect'),
      workflowId: z.string().describe('ID of the workflow that was executed'),
    })),

    // --- Lifecycle Management ---

    mcpTool(ctx, 'publish_workflow', 'Activate a workflow for production execution.', z.object({
      workflowId: z.string().describe('ID of the workflow to activate'),
    })),

    mcpTool(ctx, 'unpublish_workflow', 'Deactivate a workflow to stop production execution.', z.object({
      workflowId: z.string().describe('ID of the workflow to deactivate'),
    })),

    mcpTool(ctx, 'archive_workflow', 'Archive a workflow by ID.', z.object({
      workflowId: z.string().describe('ID of the workflow to archive'),
    })),
  ]
}

// --- JSON Schema → Zod Converter ---

/**
 * Convert a JSON Schema object to a Zod schema at runtime.
 *
 * Handles the 6 common JSON Schema types that MCP tools typically use:
 * string, number/integer, boolean, array, object, and enum.
 * Falls back to `z.any()` for unsupported constructs (allOf, anyOf, oneOf, etc.).
 *
 * @see spec: "hand-rolled converter covering the 6 common JSON Schema types"
 */
export function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const type = schema.type as string | undefined
  const enumValues = schema.enum as string[] | undefined

  if (enumValues) return z.enum(enumValues as [string, ...string[]])

  switch (type) {
    case 'string': return z.string()
    case 'number': case 'integer': return z.number()
    case 'boolean': return z.boolean()
    case 'array': {
      const items = schema.items as Record<string, unknown> | undefined
      return z.array(items ? jsonSchemaToZod(items) : z.any())
    }
    case 'object': {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
      const required = schema.required as string[] | undefined
      if (!properties) return z.record(z.any())
      const shape: Record<string, z.ZodTypeAny> = {}
      for (const [key, propSchema] of Object.entries(properties)) {
        const zodType = jsonSchemaToZod(propSchema)
        shape[key] = required?.includes(key) ? zodType : zodType.optional()
        if (propSchema.description) shape[key] = shape[key].describe(propSchema.description as string)
      }
      return z.object(shape)
    }
    default: return z.any()
  }
}

// --- Dynamic MCP Tool Factory ---

/**
 * Create LangChain tool wrappers for all tools discovered from custom MCP servers.
 *
 * For each server, calls `listToolsWithUrl()` to discover available tools, then
 * wraps each as a LangChain `tool()` with a Zod schema built from the JSON Schema
 * `inputSchema` returned by the server. Tool names are namespaced as
 * `{serverName}__{toolName}` to avoid collisions across servers.
 *
 * Graceful degradation: if a server is unreachable or returns an error, its tools
 * are skipped and the remaining servers continue processing.
 */
export async function createDynamicMcpTools(
  servers: Record<string, { url: string; headers: Record<string, string> }>,
): Promise<LangChainTool[]> {
  const allTools: LangChainTool[] = []

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    try {
      const toolInfos = await listToolsWithUrl(serverConfig.url, serverConfig.headers)
      for (const info of toolInfos) {
        const namespacedName = `${serverName}__${info.name}`
        const schema = info.inputSchema
          ? jsonSchemaToZod(info.inputSchema) as z.ZodObject<z.ZodRawShape>
          : z.object({})

        allTools.push(tool(
          async (args: Record<string, unknown>) => {
            const result = await callToolWithUrl(serverConfig.url, serverConfig.headers, info.name, args)
            if (result.isError) {
              throw new Error(result.content.map((c) => c.text ?? JSON.stringify(c)).join('\n'))
            }
            return result.content.map((c) => c.text ?? JSON.stringify(c)).join('\n')
          },
          { name: namespacedName, description: info.description ?? '', schema },
        ))
      }
    } catch (err) {
      // Graceful degradation — skip this server, continue with others
      const errMessage = err instanceof Error ? err.message : String(err)
      console.error(`[n8n-desk] Failed to discover tools from ${serverName}: ${errMessage}`)
    }
  }

  return allTools
}
