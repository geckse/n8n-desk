/**
 * Persistent per-instance "always allow" tool presets.
 *
 * File: ~/.n8n-desk/instances/{instanceId}/tool-approvals.json
 * Shape: { "version": 1, "alwaysAllow": ["execute_workflow", "srv__tool"] }
 *
 * Entries are canonical tool keys (see `canonicalToolName` in approval.ts):
 * bare names for n8n server tools, `{server}__{tool}` for custom servers.
 *
 * The renderer writes this file directly via the storage IPC
 * (ToolApprovalSettings.vue); the main process re-reads it fresh at every
 * `agent:invoke`, so presets apply from the next invoke without a restart.
 * Both sides must agree on this schema — change it here and in
 * src/types/mcp.ts together.
 */
import fs from 'fs/promises'
import path from 'path'

export interface ToolApprovalPresets {
  version: 1
  alwaysAllow: string[]
}

export function toolApprovalsPath(baseDir: string, instanceId: string): string {
  return path.join(baseDir, 'instances', instanceId, 'tool-approvals.json')
}

/**
 * Tolerant read: a missing file, malformed JSON, or an unexpected shape all
 * yield `[]` — a broken presets file must never block agent invocation.
 */
export async function readAlwaysAllowPresets(
  baseDir: string,
  instanceId: string,
): Promise<string[]> {
  try {
    const raw = await fs.readFile(toolApprovalsPath(baseDir, instanceId), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as { alwaysAllow?: unknown }).alwaysAllow)
    ) {
      return []
    }
    return (parsed as { alwaysAllow: unknown[] }).alwaysAllow.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    )
  } catch {
    return []
  }
}
