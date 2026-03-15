export interface Instance {
  id: string
  label: string
  url: string
  color: string
  addedAt: string
}

/** Extended instance config stored on disk, includes OAuth metadata */
export interface InstanceConfig extends Instance {
  oauthServerMetadata?: import('./auth').OAuthServerMetadata
}
