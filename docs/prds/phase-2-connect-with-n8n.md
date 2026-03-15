# PRD: Phase 2 — Connect with n8n Instance

## Overview

Implement the complete "Connect with n8n Account" experience: OAuth2 PKCE authentication against n8n's built-in OAuth server, secure token storage via Electron `safeStorage`, a 3-step onboarding wizard, multi-instance support with full context switching, role-based UI adaptation, and a connection monitoring service. This is the foundational auth layer that every future feature (Chat mode, Cowork mode, Workflow mode) depends on.

## Problem Statement

n8n-desk currently has no way to connect to an n8n instance. The Electron IPC handlers for auth and keychain are stubs returning `{ error: 'not implemented' }`. The Pinia stores for instances and auth are empty shells. The onboarding view is a placeholder. Without this phase, no real functionality can be built — every API call to n8n requires authentication.

## Goals

- Users can connect to one or more n8n instances via OAuth2 PKCE + credential login in under 60 seconds
- Tokens are stored securely using Electron `safeStorage` (encrypted at rest): `tokens.enc` for MCP OAuth, `session.enc` for REST API session
- The app detects the user's role (chatUser vs member+) and adapts the UI accordingly
- Dual auth: MCP OAuth for MCP tools + credential login (email+password) for REST API and user profile
- Users can switch between multiple connected n8n instances with full context swap
- A connection monitoring service tracks online/offline state per instance
- The onboarding wizard validates the n8n URL, handles OAuth, and discovers available agents
- Token refresh happens transparently on 401 responses
- The auth infrastructure is reusable by all future features (Chat-Hub API, MCP tools, Deep Agents)

## Non-Goals

- No Chat-Hub WebSocket streaming implementation (separate phase)
- No MCP tool invocations beyond agent discovery (separate phase)
- No Deep Agents SDK integration (separate phase)
- No mobile (Capacitor) auth flow — desktop (Electron) only in this phase
- No Anthropic Keychain or local model LLM config — this is n8n instance auth only
- No chat UI or message sending — only the plumbing to make it possible

## Technical Design

### Data Model Changes

**Expand `src/types/auth.ts`** — Add OAuth-specific types alongside existing `UserRole` and `AuthState`:

```ts
// OAuth discovery metadata (from /.well-known/oauth-authorization-server)
interface OAuthServerMetadata {
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

// Dynamic client registration (RFC 7591)
interface OAuthClientInfo {
  client_id: string
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  token_endpoint_auth_method: string
}

// Token response from /mcp-oauth/token
interface OAuthTokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope?: string
}

// Persisted to auth.json (non-secret metadata only)
interface AuthMetadata {
  clientId: string
  clientName: string
  scopes: string[]
  expiresAt: string
  userRole: UserRole
  registeredAt: string
  serverMetadata: OAuthServerMetadata
}

// IPC result types
type AuthLoginResult =
  | { success: true; instanceId: string; userRole: UserRole; scopes: string[]; expiresAt: string }
  | { success: false; error: string; errorCode: AuthErrorCode }

type AuthErrorCode =
  | 'discovery_failed'
  | 'registration_failed'
  | 'auth_cancelled'
  | 'auth_timeout'
  | 'token_exchange_failed'
  | 'network_error'

type AuthRefreshResult =
  | { success: true; expiresAt: string; accessToken: string }
  | { success: false; error: string }
```

**Expand `src/types/instance.ts`** — Add config type for disk persistence:

```ts
interface InstanceConfig extends Instance {
  oauthServerMetadata?: OAuthServerMetadata
}
```

**New file: `src/types/connection.ts`**:

```ts
type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting'
```

### Disk Storage Layout

Per-instance storage under `~/.n8n-desk/instances/{id}/`:

```
instances/
├── index.json                 # Array of instance IDs ["inst_abc", "inst_def"]
├── inst_abc123/
│   ├── instance.json          # InstanceConfig (url, label, color, metadata)
│   ├── auth.json              # AuthMetadata (clientId, scopes, role, hasSessionToken — NO tokens)
│   ├── tokens.enc             # safeStorage-encrypted JSON: { access_token, refresh_token } (MCP OAuth)
│   ├── session.enc            # safeStorage-encrypted JSON: { session_token } (REST API n8n-auth JWT)
│   └── sessions/              # (future phases)
└── inst_def456/
    └── ...
```

### Dual Auth Architecture

n8n has two completely separate auth domains:
- **MCP server** (`/mcp-server/http/*`): Bearer token with `aud: "mcp-server-api"`, validated by `McpServerMiddlewareService`
- **REST API** (`/rest/*`, `/chat/*`): `n8n-auth` cookie (HttpOnly JWT), validated by `AuthService`

No single token works for both. n8n-desk uses dual auth:
1. **MCP OAuth** (Step 2 of onboarding) → `tokens.enc` → MCP tool calls
2. **Credential login** (Step 3 of onboarding) → `session.enc` → REST API + user profile

The `N8nApiClient` selects auth per endpoint: `Cookie: n8n-auth=...` for `/rest/*` and `/chat/*`, `Authorization: Bearer` for `/mcp-server/*`.

**Important: REST API prefix is `/rest/`** (configurable via `N8N_ENDPOINT_REST`, defaults to `"rest"`). Login endpoint is `POST /rest/login`, NOT `/api/v1/auth/login`. The public API at `/api/v1/` is a separate system using `X-N8N-API-KEY` header auth.

### Interface Changes

**`electron/preload.ts`** — Update IPC signatures:

```ts
auth: {
  login: (instanceUrl: string) => Promise<AuthLoginResult>
  logout: (instanceId: string) => Promise<void>
  refresh: (instanceId: string) => Promise<AuthRefreshResult>
}
```

**New composables:**
- `useAuth()` — orchestrates login/logout/refresh via IPC
- `useConnection()` — monitors n8n instance reachability

**New service:**
- `n8n-api.ts` — base HTTP client with bearer token and auto-refresh

### New Commands / API / UI

| Surface | What | Description |
|---|---|---|
| Onboarding wizard | `OnboardingView.vue` | 3-step flow: URL → OAuth → Connected |
| Instance switcher | `InstanceSwitcher.vue` | Popover in sidebar footer to switch/add instances |
| Auth guard | Router `beforeEach` | Redirects to `/onboarding` if no authenticated instance |
| Connection indicator | Header | Subtle dot showing connected/disconnected/reconnecting |

### Migration Strategy

No migration needed — this is greenfield. All existing stubs are replaced with real implementations. The existing type interfaces (`UserRole`, `AuthState`, `Instance`) remain compatible; we only add new types.

## Implementation Steps

### Step 1: Type Foundation

**Expand `src/types/auth.ts`** with `OAuthServerMetadata`, `OAuthClientInfo`, `OAuthTokenResponse`, `AuthMetadata`, `AuthLoginResult`, `AuthRefreshResult`, and `AuthErrorCode` as shown above.

**Add `src/types/connection.ts`** with `ConnectionStatus` type.

**Update `env.d.ts`** to type the `window.n8nDesk` bridge with proper return types for `auth.login`, `auth.logout(instanceId)`, `auth.refresh(instanceId)`.

### Step 2: Electron Keychain — safeStorage Implementation

**Replace `electron/ipc/keychain.ts`** stub with real implementation:

- `keychain:get(key)` — Read `~/.n8n-desk/instances/{id}/tokens.enc`, decrypt with `safeStorage.decryptString()`, return JSON string
- `keychain:set(key, value)` — Encrypt with `safeStorage.encryptString()`, write Buffer to `tokens.enc`
- `keychain:delete(key)` — Delete `tokens.enc` file

Check `safeStorage.isEncryptionAvailable()` at startup. If unavailable (Linux without keyring), fall back to plaintext file with `0600` permissions and log a warning.

Key format: `n8n-desk:{instanceId}` maps to `~/.n8n-desk/instances/{instanceId}/tokens.enc`.

### Step 3: OAuth2 PKCE Engine

**Create `electron/oauth.ts`** — Pure functions, no IPC registration:

1. `discoverServer(baseUrl: string): Promise<OAuthServerMetadata>` — GET `{baseUrl}/.well-known/oauth-authorization-server`, validate required fields
2. `registerClient(metadata, redirectUri): Promise<OAuthClientInfo>` — POST to `registration_endpoint` with `client_name: "n8n-desk"`, `redirect_uris`, `grant_types: ["authorization_code", "refresh_token"]`, `token_endpoint_auth_method: "none"`
3. `buildAuthorizationUrl(metadata, clientId, redirectUri, state, codeVerifier): string` — Generate S256 `code_challenge` from `code_verifier`, build URL with all OAuth params
4. `exchangeCodeForTokens(metadata, clientId, code, redirectUri, codeVerifier): Promise<OAuthTokenResponse>` — POST `grant_type=authorization_code` to `token_endpoint`
5. `refreshTokens(metadata, clientId, refreshToken): Promise<OAuthTokenResponse>` — POST `grant_type=refresh_token`
6. `revokeToken(metadata, clientId, token, tokenTypeHint): Promise<void>` — POST to `revocation_endpoint`
7. `detectRole(scopes: string[]): UserRole` — If scopes include any `tool:*` or `mcp:oauth`, return `'member'`. If only `chatHub:message` + `chatHubAgent:*`, return `'chatUser'`. Default to `'member'` if full scope set is returned.

PKCE utilities (using Node.js `crypto`):
- `generateCodeVerifier()` — 43-char base64url random string
- `generateCodeChallenge(verifier)` — SHA-256 hash, base64url encoded
- `generateState()` — 32-byte hex random string

### Step 4: OAuth Redirect Listener

**Create `electron/oauth-redirect.ts`** — Handles the OAuth callback:

**Primary: Custom protocol `n8ndesk://`**
- Register in `electron/main.ts` via `app.setAsDefaultProtocolClient('n8ndesk')` **before** `app.whenReady()`
- macOS: Handle `app.on('open-url', (event, url) => ...)` to extract `code` and `state` from `n8ndesk://callback?code=...&state=...`
- Windows/Linux: Handle via `app.on('second-instance', (event, commandLine) => ...)` — parse the URL from `commandLine`

**Fallback: Localhost HTTP server**
- `createServer()` on port 0 (random), listen for `GET /callback`
- Extract `code` and `state` from query params
- Respond with HTML: "Authentication successful. You can close this window."
- Auto-shutdown after callback or 5-minute timeout

Export: `startOAuthRedirectListener(): Promise<{ redirectUri: string; waitForCallback: () => Promise<{ code: string; state: string }>; cleanup: () => void }>`

Strategy: Try custom protocol first. If `app.isDefaultProtocolClient('n8ndesk')` returns false (registration failed), fall back to localhost server.

### Step 5: Update `electron/main.ts`

- Add `app.setAsDefaultProtocolClient('n8ndesk')` before `app.whenReady()`
- Handle `open-url` event (macOS) and `second-instance` event (Windows/Linux) by forwarding the URL to the auth handler
- Request single-instance lock (`app.requestSingleInstanceLock()`) for Windows/Linux protocol handling
- Export `mainWindow` reference for auth handlers to use `shell.openExternal()`

### Step 6: Full Auth IPC Implementation

**Replace `electron/ipc/auth.ts`** stub:

**`auth:login(instanceUrl: string)`:**
1. Normalize URL (strip trailing slash, validate format)
2. Generate instance ID: `'inst_' + crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)`
3. `discoverServer(url)` — fail with `discovery_failed` if unreachable or not n8n
4. Start redirect listener (protocol primary, localhost fallback)
5. `registerClient(metadata, redirectUri)` — or reuse client from existing `auth.json` if re-authenticating
6. Generate PKCE `code_verifier` + `state`
7. Build authorization URL
8. `shell.openExternal(authUrl)` — opens user's browser
9. `waitForCallback()` — await code + state (5-minute timeout → `auth_timeout`)
10. Validate `state` matches
11. `exchangeCodeForTokens(...)` — fail with `token_exchange_failed` on error
12. `detectRole(scopes)` from token response
13. Store tokens encrypted via keychain IPC
14. Write `auth.json` (clientId, scopes, expiresAt, userRole, serverMetadata)
15. Write `instance.json` (url, label from hostname, generated color, addedAt)
16. Update `instances/index.json` (add instance ID if new)
17. Cleanup redirect listener
18. Return `AuthLoginResult` to renderer

**`auth:logout(instanceId: string)`:**
1. Read `auth.json` for clientId + server metadata
2. Read tokens from keychain
3. Revoke both tokens (access + refresh) — swallow errors (already expired is fine)
4. Delete keychain entry (tokens.enc)
5. Optionally clear `auth.json` (keep `instance.json` for re-login)

**`auth:refresh(instanceId: string)`:**
1. Read `auth.json` for clientId + server metadata
2. Read tokens from keychain
3. `refreshTokens(metadata, clientId, refreshToken)`
4. **Atomically** update keychain with new access_token + refresh_token (n8n rotates refresh tokens)
5. Update `auth.json` with new expiresAt
6. Return new `accessToken` + `expiresAt` to renderer

### Step 7: Update Preload Script

**Update `electron/preload.ts`:**
- `auth.logout` takes `instanceId: string` parameter
- `auth.refresh` takes `instanceId: string` parameter
- All return types match the new typed interfaces

### Step 8: Instances Store — Full Implementation

**Replace `src/stores/instances.ts`** stub:

- `hydrate()`: Read `~/.n8n-desk/instances/index.json` via storage IPC. For each instance ID, read `instance.json`. Read `config.json` for `defaultInstanceId`. Set `activeInstanceId`.
- `addInstance(instance)`: Push to array. Write `instance.json`. Add to `index.json`. If first instance, set as active and update `config.json`.
- `removeInstance(id)`: Remove from array and `index.json`. If active, switch to next instance or clear.
- `setActive(id)`: Update `activeInstanceId`. Save to `config.json`.
- `switchInstance(id)`: Full context swap — reset auth store, reset chat store, reset workflows store, set new active, hydrate auth from new instance, start connection monitoring, navigate to last mode.

### Step 9: Auth Store — Full Implementation

**Replace `src/stores/auth.ts`** stub — keep existing interface, fill in methods:

- `hydrate(instanceId)`: Read `auth.json` via storage IPC for role, scopes, expiresAt. Read access token from keychain via `window.n8nDesk.keychain.get('n8n-desk:' + instanceId)`, parse JSON to get `access_token`. Set `accessToken` ref. (Token in renderer memory is acceptable — renderer is sandboxed with `contextIsolation: true`, and the WebSocket needs it for bearer auth.)
- `login(instanceUrl)`: Call `window.n8nDesk.auth.login(instanceUrl)`. On success, populate store from result. Trigger hydrate to load token.
- `logout()`: Call `window.n8nDesk.auth.logout(activeInstanceId)`. Call `reset()`.
- `refresh()`: Call `window.n8nDesk.auth.refresh(activeInstanceId)`. Update `accessToken`, `expiresAt`.

### Step 10: Base HTTP Client

**Create `src/services/n8n-api.ts`:**

```ts
class N8nApiClient {
  constructor(private baseUrl: string, private getToken: () => string | null) {}

  async request<T>(path: string, options?: RequestInit): Promise<T>
  // Attaches Authorization: Bearer header
  // On 401: triggers auth store refresh, retries once with new token
  // On non-200: throws N8nApiError with status + body
  // Convenience: get<T>, post<T>, patch<T>, delete

  // Returns typed error with status code and message
}
```

Instance-scoped: when active instance changes, create a new client pointing to the new base URL. Expose via a `useN8nApi()` composable that reads `instancesStore.activeInstance.url` and `authStore.accessToken`.

### Step 11: Connection Monitoring Composable

**Create `src/composables/useConnection.ts`:**

- `status: Ref<ConnectionStatus>` — `'connected' | 'disconnected' | 'reconnecting'`
- `startMonitoring(baseUrl)`: Ping `{baseUrl}/healthz` every 30s when document is visible. Use `navigator.onLine` as fast hint.
- `stopMonitoring()`: Clear interval.
- `checkHealth(baseUrl): Promise<boolean>`: Single health check with 5s timeout.
- Listen to `document.visibilitychange` — pause monitoring when hidden, resume when visible.
- Listen to `window.addEventListener('online'/'offline')` for immediate status change.

### Step 12: Auth Composable

**Create `src/composables/useAuth.ts`:**

Orchestration layer between the auth store and IPC:

- `login(instanceUrl): Promise<AuthLoginResult>` — calls store method, handles errors
- `logout(): Promise<void>` — calls store, then instance store to potentially switch
- `ensureAuthenticated(): Promise<boolean>` — check if token is expired, trigger refresh if needed
- Exposes `isAuthenticated`, `isFullAccess`, `userRole` as computed refs from the auth store

### Step 13: Onboarding Wizard

**Replace `src/views/OnboardingView.vue`** placeholder with 4-step wizard:

**Step 1 — "Connect to n8n":**
- `ion-input` (`fill="outline"`, `label-placement="stacked"`) for n8n instance URL
- Client-side URL validation (must start with `http://` or `https://`)
- "Connect" `ion-button` triggers `discoverServer` validation via IPC
- `ion-spinner` during validation
- Error states: invalid URL format, unreachable, not an n8n instance (no OAuth metadata)
- On success, store metadata and advance to step 2

**Step 2 — "Sign in" (MCP OAuth):**
- Show "Signing in to {hostname}..." with spinner
- Call `useAuth().login(url)` which opens browser via IPC
- On success, auto-advance to step 3
- On error: show inline error with "Try again" button. Do NOT restart wizard.
- On timeout (5 min): show "Authentication timed out" with retry
- "Having trouble?" link for localhost fallback

**Step 3 — "Full Access" (Credential Login):**
- `ion-input` fields for email and password (`fill="outline"`, `label-placement="stacked"`)
- On submit: `POST /rest/login` via `auth:credential-login` IPC
- If n8n returns error code `998`: show MFA input field (6-digit TOTP code), resubmit with `mfaCode`
- On invalid credentials: show n8n's error message (e.g., "Wrong username or password. Do you have caps lock on?")
- On success: user profile is stored, session token saved to `session.enc`, advance to step 4
- Credential login is **mandatory** — provides REST API access and user profile

**Step 4 — "You're connected!":**
- Editable `ion-input` for instance label (defaults to hostname)
- Color preset dots (5-6 preset colors) for instance color
- Agent count: call `GET /chat/agents` via HTTP client to show "Found {n} agents"
- For member+: also call `search_workflows` to find Chat Trigger workflows
- "Get started" `ion-button` navigates to `/chat`

Use `ref<1 | 2 | 3 | 4>(1)` for step tracking with `v-if` conditional rendering (no slider).

### Step 14: Router Auth Guard

**Update `src/router/index.ts`:**

Add `router.beforeEach` navigation guard:
- If no instances registered AND not going to `/onboarding` → redirect to `/onboarding`
- If instances exist but active instance not authenticated AND not going to `/onboarding` → redirect to `/onboarding`
- If chatUser role AND going to `/cowork` or `/workflow` → redirect to `/chat`

### Step 15: Startup Hydration

**Update `src/main.ts`:**

After `settingsStore.hydrate()`, also:
1. `await instancesStore.hydrate()`
2. If `instancesStore.activeInstance` exists, `await authStore.hydrate(instancesStore.activeInstanceId!)`
3. If authenticated, start connection monitoring
4. Mount app

### Step 16: Instance Switcher Component

**Create `src/components/instance/InstanceSwitcher.vue`:**

- Triggered from sidebar footer (replaces hardcoded "Marcel" / "n8n Cloud")
- Uses `ion-popover` containing `ion-list` of instances
- Each instance: color dot + label + URL subtitle
- Active instance highlighted with checkmark
- "Add instance" item at bottom → navigates to `/onboarding`
- Selecting a different instance calls `instancesStore.switchInstance(id)`

### Step 17: Update MenuLayout Sidebar Footer

**Update `src/views/MenuLayout.vue`:**

- Replace hardcoded "Marcel" with `authStore` user display (role label)
- Replace hardcoded "n8n Cloud" with `instancesStore.activeInstance.label`
- Show instance color dot from `activeInstance.color`
- Click opens InstanceSwitcher popover (keep settings icon separate)
- Gate Cowork/Workflow segment buttons with `authStore.isFullAccess` in addition to `!isMobile`

### Step 18: Connection Indicator

**Update `src/views/MenuLayout.vue` header toolbar:**

Add a small status dot next to the instance label or in the toolbar:
- Green dot = connected
- Yellow dot (pulsing) = reconnecting
- Red dot = disconnected for >3 seconds (show subtle banner: "Reconnecting to {instance}...")
- Use `useConnection()` composable reactive state

## Validation Criteria

- [ ] User can enter an n8n instance URL and it validates against `/.well-known/oauth-authorization-server`
- [ ] Invalid/unreachable URLs show clear inline error messages
- [ ] OAuth flow opens in the user's default browser
- [ ] Auth code callback works via custom protocol (`n8ndesk://callback`)
- [ ] Auth code callback works via localhost fallback when protocol registration fails
- [ ] Tokens are exchanged successfully and stored encrypted via `safeStorage`
- [ ] `auth.json` contains non-secret metadata only (no tokens)
- [ ] `tokens.enc` is encrypted and unreadable without `safeStorage`
- [ ] User role (chatUser vs member+) is correctly detected from scopes
- [ ] chatUser sees only Chat mode tab; Cowork/Workflow tabs are hidden
- [ ] member+ sees all three mode tabs
- [ ] Credential login with email+password succeeds and stores session token in `session.enc`
- [ ] Invalid credentials show n8n's actual error message in the UI
- [ ] MFA flow: when n8n returns code `998`, a TOTP input appears; submitting the code completes login
- [ ] After credential login, user's real name (firstName + lastName) appears in the sidebar
- [ ] REST API calls use the session cookie (`Cookie: n8n-auth=...`), not Bearer token
- [ ] MCP tool calls still use Bearer token (`Authorization: Bearer ...`)
- [ ] Session cookie auto-refreshes when n8n sends a new `set-cookie` header
- [ ] Onboarding step 4 shows discovered agent count
- [ ] "Get started" navigates to Chat mode
- [ ] Token refresh works transparently on 401 (no user interaction needed)
- [ ] Refresh token rotation is handled atomically (old token replaced with new)
- [ ] Logout revokes tokens and clears encrypted storage
- [ ] Multiple instances can be added via "Add instance"
- [ ] Instance switcher shows all registered instances with color dots
- [ ] Switching instances resets auth/chat/workflow stores and rehydrates from new instance
- [ ] Connection indicator shows green when n8n is reachable
- [ ] Connection indicator shows disconnected after n8n goes unreachable for >3 seconds
- [ ] App redirects to onboarding when no instances are configured
- [ ] App redirects to onboarding when tokens are expired and refresh fails
- [ ] Entire flow completes in under 30 seconds on a responsive n8n instance
- [ ] All TypeScript compiles with strict mode (`vue-tsc --noEmit`)

## Anti-Patterns to Avoid

- **Do NOT store tokens in `localStorage` or unencrypted files.** Tokens must be encrypted via `safeStorage`. The `auth.json` file stores metadata only (clientId, scopes, expiry). If `safeStorage` is unavailable, use `0600` file permissions as a fallback with a logged warning.

- **Do NOT keep the refresh token in renderer memory.** The access token is needed in the renderer for WebSocket bearer auth, but the refresh token should only exist in the main process during the refresh operation. The keychain stores both, but only the access token is sent to the renderer via `hydrate()`.

- **Do NOT retry failed OAuth flows automatically.** If the user cancels or the flow times out, show the error and let the user retry manually. No retry loops.

- **Do NOT register IPC handlers multiple times.** The current code calls `registerAuthHandlers()` inside `createWindow()`, which means handlers get re-registered on macOS `activate` events. Move handler registration to `app.whenReady()` before window creation, or guard with a flag.

- **Do NOT use `any` types for IPC results.** Every IPC channel must have typed request and response shapes. The `env.d.ts` bridge types must match exactly.

- **Do NOT use `ion-slides` for the onboarding wizard.** It's deprecated. Use a reactive `currentStep` ref with `v-if` conditionals.

- **Do NOT hardcode the redirect URI.** The port for localhost fallback is dynamic (port 0). The protocol handler URI is always `n8ndesk://callback`. Both are determined at runtime.

- **Do NOT set `mode: 'ios'` globally on `IonicVue`.** Only apply `mode="ios"` on `ion-segment` where the pill style is needed.

## Patterns to Follow

- **IPC handler pattern:** Follow the existing structure in `electron/ipc/storage.ts` — export a `registerXHandlers()` function called from `main.ts`. Each handler uses `ipcMain.handle()` with typed parameters.

- **Store pattern:** Follow `src/stores/settings.ts` — `defineStore` with composition API, `hydrate()` from disk, mutation methods that flush to disk via `local-storage.ts`.

- **Composable pattern:** Follow `src/composables/useTheme.ts` — exported function returning reactive refs and methods. Composables call stores/services, never make direct API calls.

- **Service pattern:** As described in `CLAUDE.md`: `Component → Composable → Service → n8n API`. The `n8n-api.ts` service is the base HTTP layer. Future services (`chathub.ts`, `mcp.ts`) will build on it.

- **View pattern:** Follow `src/views/SettingsView.vue` — `IonPage` > `IonHeader` > `IonToolbar` > `IonTitle` + `IonContent`. All inputs use `fill="outline"` and `label-placement="stacked"`.

- **Error handling:** Use discriminated unions for results (`{ success: true, ... } | { success: false, error, errorCode }`). Never throw across IPC boundaries — always return structured errors.

- **File reference for n8n OAuth behavior:** `n8n-master/packages/cli/src/modules/mcp/mcp-oauth-service.ts` — shows exact token exchange format, PKCE validation, and refresh token rotation logic. `n8n-master/packages/cli/src/modules/mcp/mcp.oauth.controller.ts` — shows endpoint routes and rate limiting.
