export interface Instance {
  id: string
  label: string
  url: string
  color: string
  addedAt: string
  /** Optional custom MCP HTTP endpoint. If absent, defaults to `${url}/mcp-server/http`. */
  mcpServerUrl?: string
}

/** Extended instance config stored on disk, includes OAuth metadata */
export interface InstanceConfig extends Instance {
  oauthServerMetadata?: import('./auth').OAuthServerMetadata
  /** OAuth discovery metadata for the custom MCP URL (only set when `mcpServerUrl` is configured). */
  mcpOAuthServerMetadata?: import('./auth').OAuthServerMetadata
}
