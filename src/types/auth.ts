export type UserRole = 'owner' | 'admin' | 'member' | 'chatUser' | 'unknown'

export interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  userRole: UserRole
  scopes: string[]
  expiresAt: string | null
}

// --- OAuth2 Types ---

/** OAuth discovery metadata from /.well-known/oauth-authorization-server */
export interface OAuthServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  revocation_endpoint: string
  response_types_supported: string[]
  grant_types_supported: string[]
  code_challenge_methods_supported: string[]
  scopes_supported: string[]
}

/** Dynamic client registration response (RFC 7591) */
export interface OAuthClientInfo {
  client_id: string
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  token_endpoint_auth_method: string
}

/** Token response from /mcp-oauth/token */
export interface OAuthTokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope?: string
}

/** User profile info from n8n /me endpoint */
export interface UserProfile {
  firstName: string
  lastName: string
  email: string
}

/** Persisted to auth.json — non-secret metadata only, NO tokens */
export interface AuthMetadata {
  clientId: string
  clientName: string
  scopes: string[]
  expiresAt: string
  userRole: UserRole
  registeredAt: string
  serverMetadata: OAuthServerMetadata
  userProfile?: UserProfile
  /** Whether a REST API session token is stored in keychain */
  hasSessionToken?: boolean
}

// --- IPC Result Types ---

export type AuthErrorCode =
  | 'discovery_failed'
  | 'registration_failed'
  | 'auth_cancelled'
  | 'auth_timeout'
  | 'token_exchange_failed'
  | 'network_error'

export type AuthLoginResult =
  | { success: true; instanceId: string; userRole: UserRole; scopes: string[]; expiresAt: string }
  | { success: false; error: string; errorCode: AuthErrorCode }

export type AuthRefreshResult =
  | { success: true; expiresAt: string; accessToken: string }
  | { success: false; error: string }

// --- Credential Login (REST API access via n8n session cookie) ---

export type CredentialLoginErrorCode =
  | 'invalid_credentials'
  | 'mfa_required'
  | 'user_disabled'
  | 'network_error'

export type CredentialLoginResult =
  | { success: true; userProfile: UserProfile }
  | { success: false; error: string; errorCode: CredentialLoginErrorCode }
