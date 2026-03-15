# Auth Flow & MCP Tools

> Using n8n as the authentication layer for n8n-desk via its existing OAuth2 Authorization Server.

---

## n8n's Existing OAuth2 Server

n8n already ships an **RFC 8414 compliant OAuth2 Authorization Server**, built for MCP integration.

**Location in n8n-master:** `packages/cli/src/modules/mcp/`

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-authorization-server` | Discovery metadata (RFC 8414) |
| `GET /.well-known/oauth-protected-resource/mcp-server/http` | Protected Resource Metadata (RFC 9728) |
| `POST /mcp-oauth/register` | Dynamic Client Registration (RFC 7591) |
| `POST /mcp-oauth/authorize` | Authorization endpoint |
| `POST /mcp-oauth/token` | Token endpoint (auth code + refresh token) |
| `POST /mcp-oauth/revoke` | Token revocation |

### Capabilities

- **Grant types:** `authorization_code`, `refresh_token`
- **PKCE:** Required, S256 only
- **Client registration:** Dynamic (RFC 7591)
- **Token types:** Access token + Refresh token with expiration
- **User consent:** Tracked per client/scope combination
- **Rate limiting:** Applied to all OAuth endpoints (IP-based)
- **CORS:** Enabled for OAuth discovery endpoints **only** (`/.well-known/*`). All other n8n REST endpoints (ChatHub, `/api/v1/*`, `/healthz`) do **not** set CORS headers — n8n-desk must proxy these calls through Electron's main process via `api:fetch` IPC to avoid browser CORS blocks

### Key Source Files

| File | Purpose |
|---|---|
| `packages/cli/src/modules/mcp/mcp.oauth.controller.ts` | OAuth2 endpoints & metadata |
| `packages/cli/src/modules/mcp/mcp-oauth-service.ts` | OAuth2 provider implementation |
| `packages/cli/src/modules/mcp/mcp-oauth-authorization-code.service.ts` | Auth code lifecycle |
| `packages/cli/src/auth/auth.service.ts` | Core JWT, cookie, MFA auth logic |
| `packages/cli/src/controllers/auth.controller.ts` | Login/logout endpoints |
| `packages/cli/src/services/public-api-key.service.ts` | API key validation |

### Database Entities

Located in `packages/cli/src/modules/mcp/database/entities/`:

- `oauth-client.entity.ts`
- `oauth-authorization-code.entity.ts`
- `oauth-access-token.entity.ts`
- `oauth-refresh-token.entity.ts`
- `oauth-user-consent.entity.ts`

---

## Other Auth Mechanisms in n8n

| Method | Details |
|---|---|
| **Session cookies** | `n8n-auth` cookie, JWT-based (HS256), HttpOnly, MFA support. Login at `POST /rest/login`. |
| **API keys** | `X-N8N-API-KEY` header, JWT-based with expiration. For the public API (`/api/v1/`). |
| **OIDC SSO** | Enterprise, endpoints at `/sso/oidc/*` |
| **SAML SSO** | Enterprise, endpoints at `/sso/saml/*` |
| **LDAP** | Enterprise, alternative auth backend (uses same `POST /rest/login` with LDAP username) |

### n8n REST API Endpoint Prefix

n8n's internal REST API uses `/rest/` as its default prefix (configurable via `N8N_ENDPOINT_REST` env var). The `@RestController()` decorator routes controllers to `/{endpoints.rest}/{basePath}`.

| Endpoint | Prefix | Auth method |
|---|---|---|
| Internal REST API | `/rest/*` (e.g., `/rest/login`, `/rest/workflows`) | `n8n-auth` cookie |
| Public API | `/api/v1/*` (e.g., `/api/v1/workflows`) | `X-N8N-API-KEY` header |
| MCP server | `/mcp-server/http/*` | `Authorization: Bearer` (MCP OAuth or MCP API key) |
| Chat-Hub | `/chat/*` (e.g., `/chat/agents`, `/chat/conversations`) | `n8n-auth` cookie |
| OAuth | `/mcp-oauth/*`, `/.well-known/*` | None (public) |
| Health | `/healthz` | None (public) |

---

## n8n User Roles

n8n has 4 global roles that determine what a user can access:

| Role | Description |
|---|---|
| `global:owner` | Full access to everything |
| `global:admin` | Same permissions as owner |
| `global:member` | Limited global scopes, can use MCP OAuth |
| `global:chatUser` | **Chat-only** — no MCP, no workflow management |

Additionally, there are **project-level roles** that further scope access:

| Role | Description |
|---|---|
| `project:admin` | Full control of project resources |
| `project:editor` | Create/edit/delete workflows and credentials |
| `project:viewer` | Read-only access |
| `project:chatUser` | Chat-only access (execute chat workflows in project) |

### Role → Scope Matrix

| Scope | owner/admin | member | chatUser |
|---|---|---|---|
| `mcp:manage` | Yes | No | No |
| `mcp:oauth` | Yes | Yes | No |
| `mcpApiKey:create` | Yes | Yes | No |
| `mcpApiKey:rotate` | Yes | Yes | No |
| `chatHub:manage` | Yes | No | No |
| `chatHub:message` | Yes | Yes | **Yes** |
| `chatHubAgent:create` | Yes | Yes | **Yes** |
| `chatHubAgent:read` | Yes | Yes | **Yes** |
| `chatHubAgent:update` | Yes | Yes | **Yes** |
| `chatHubAgent:delete` | Yes | Yes | **Yes** |
| `chatHubAgent:list` | Yes | Yes | **Yes** |
| `workflow:execute-chat` | Yes | Yes | **Yes** (project-level) |

### Key Source Files for Roles

| File | Purpose |
|---|---|
| `packages/@n8n/permissions/src/roles/all-roles.ts` | Role definitions |
| `packages/@n8n/permissions/src/constants.ee.ts` | Role slugs and scope maps |
| `packages/@n8n/permissions/src/roles/scopes/global-scopes.ee.ts` | Global role scopes |
| `packages/@n8n/permissions/src/roles/scopes/project-scopes.ee.ts` | Project role scopes |
| `packages/cli/src/permissions.ee/check-access.ts` | Permission checking logic |

---

## "Connect with n8n Account" Flow

n8n-desk supports **two access tiers** based on the authenticated user's role.

### Access Tiers

| n8n-desk Mode | Required n8n Role | What They Can Do |
|---|---|---|
| **Chat-only** | `global:chatUser` or `project:chatUser` | Talk to Workflow Agents, manage conversations, manage chat agents |
| **Full automation** | `global:member` or higher | Everything in chat-only + search/create/execute/manage workflows via MCP |

### Dual Auth: MCP OAuth + Credential Login

n8n has **two separate auth domains** — MCP OAuth tokens (`aud: "mcp-server-api"`) cannot access the REST API (`/api/v1/*`), and REST API session cookies cannot access the MCP server. n8n-desk uses **both** to get full access:

**Step 1 — MCP OAuth (automated, browser-based):**
```
n8n-desk app  ──OAuth2 authorize──▶  n8n instance login page (browser)
     ◀──────── auth code callback ──────
     ──────── exchange for tokens ──▶  /mcp-oauth/token
     ◀──────── access_token + refresh_token ──────
     ──────── MCP calls with bearer token ──▶  n8n MCP server
```

**Step 2 — Credential login (email+password, in-app):**
```
n8n-desk app  ──POST email+password──▶  /rest/login
     ◀──────── set-cookie: n8n-auth=<JWT> + user profile ──────
     ──────── REST calls with Cookie header ──▶  n8n REST API (/rest/*)
```

**Why two auth flows:**
- MCP OAuth tokens are scoped ONLY to `/mcp-server/http` — they have `aud: "mcp-server-api"` and `meta: { isOAuth: true }`, validated by `McpServerMiddlewareService`
- REST API only accepts `n8n-auth` cookie (HttpOnly JWT, validated by `AuthService`) or `X-N8N-API-KEY` header
- These are completely separate middleware chains — no single token works for both

**What each token provides:**
| Token | Stored as | Used for | Refresh mechanism |
|---|---|---|---|
| MCP OAuth access token | `tokens.enc` (encrypted) | MCP tool calls (`/mcp-server/http/*`) | Refresh token grant (30-day refresh token) |
| REST API session cookie | `session.enc` (encrypted) | REST API (`/rest/*`, `/chat/*`) | Auto-refreshed by n8n in `set-cookie` response headers |

**MFA handling:** If the user has MFA enabled, the credential login step shows a TOTP input field. The `mfaCode` is sent in the POST body alongside email+password. n8n returns error code `998` when MFA is required but no code was provided.

**n8n login endpoint details:**
- **URL:** `POST /rest/login` (NOT `/api/v1/auth/login`)
- **Body:** `{ emailOrLdapLoginId, password, mfaCode? }`
- **Success (200):** Returns `{ data: { firstName, lastName, email, ... } }` + sets `n8n-auth` cookie
- **Error (401):** Returns `{ message, code }` — code `998` = MFA required, other = invalid credentials
- **Error (400):** Invalid email format

**REST API prefix:** n8n's internal REST API uses `/rest/` prefix (configurable via `N8N_ENDPOINT_REST` env var, defaults to `"rest"`). The `@RestController()` decorator routes to `/{endpoints.rest}/{basePath}`. This is separate from the public API (`/api/v1/`) which uses `X-N8N-API-KEY` auth.

**Session cookie refresh:** The `api:fetch` IPC proxy in Electron's main process intercepts `set-cookie` headers from n8n responses. When n8n auto-refreshes the JWT (at ~75% of expiry), the proxy transparently updates `session.enc` so the session stays alive without user interaction.

### Auth Flow (Chat-only — chatUser)

chatUser cannot use MCP OAuth (`mcp:oauth` scope missing), so n8n-desk must either:
1. Use a **separate OAuth flow** that grants ChatHub REST API access, or
2. Extend the MCP OAuth server to support ChatHub scopes alongside MCP tool scopes

### ChatHub REST API (chatUser endpoints)

These endpoints require only `chatHub:message` scope:

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/chat/models` | Get available models |
| `GET` | `/chat/conversations` | List conversations |
| `GET` | `/chat/conversations/:sessionId` | Get a conversation |
| `GET` | `/chat/conversations/:sessionId/messages/:id/attachments/:index` | Get attachment |
| `POST` | `/chat/conversations/send` | Send a message |
| `POST` | `/chat/conversations/:sessionId/messages/:id/edit` | Edit a message |
| `POST` | `/chat/conversations/:sessionId/messages/:id/regenerate` | Regenerate response |
| `POST` | `/chat/conversations/:sessionId/messages/:id/stop` | Stop generation |
| `POST` | `/chat/conversations/:sessionId/reconnect` | Reconnect to stream |
| `PATCH` | `/chat/conversations/:sessionId` | Update conversation |
| `DELETE` | `/chat/conversations/:sessionId` | Delete conversation |

ChatHub Agent management (requires `chatHubAgent:*` scopes):

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/chat/agents` | List agents |
| `POST` | `/chat/agents` | Create agent |
| `PATCH` | `/chat/agents/:id` | Update agent |
| `DELETE` | `/chat/agents/:id` | Delete agent |

### Post-Auth Role Detection

After OAuth completes, n8n-desk must detect the user's role and adapt the UI:

1. **Check scopes** returned in the token response
2. **If chatUser** → show only Workflow Agent conversations, hide workflow management features
3. **If member+** → show full UI with MCP-powered workflow search, creation, execution, and management

### Platform-Specific Redirects

| Platform | Redirect Strategy |
|---|---|
| Desktop (Electron) | `http://localhost:{port}/callback` |
| Mobile (iOS/Android) | Deep link / custom URL scheme (`n8ndesk://callback`) |

### What Needs to Change

1. **n8n side:** Extend OAuth scopes from 2 → 13+ to cover all MCP tools and ChatHub access
2. **n8n side:** Ensure chatUsers can authenticate via OAuth (may need `mcp:oauth` or a parallel auth path)
3. **n8n-desk side:** Implement OAuth2 PKCE flow, secure token storage (Keychain/Credential Manager)
4. **n8n-desk side:** Role-aware UI that adapts features based on granted scopes

---

## n8n MCP Server Tools (13 Total)

Full workflow lifecycle coverage: search, build, validate, create, execute, inspect, and manage.

### Node Discovery

| Tool | Description |
|---|---|
| `search_nodes` | Search nodes by service name, trigger type, or utility function. Returns node IDs and discriminators. |
| `get_node_types` | Get TypeScript type definitions for nodes. Returns exact parameter names and structures. |
| `get_suggested_nodes` | Get curated node recommendations by workflow technique category (chatbot, notification, scheduling, etc.). |

### Workflow Building

| Tool | Description |
|---|---|
| `validate_workflow` | Validate n8n Workflow SDK code. Parses and checks for errors before creating. |
| `create_workflow_from_code` | Create a new workflow from validated SDK code. |
| `update_workflow` | Update an existing workflow from validated SDK code. |

### Workflow Discovery

| Tool | Description |
|---|---|
| `search_workflows` | Search/filter workflows by name, description, project. |
| `get_workflow_details` | Get detailed info about a workflow, including trigger details. |

### Execution

| Tool | Description |
|---|---|
| `execute_workflow` | Execute a workflow by ID. Supports chat, form, and webhook input types. Returns execution ID and status. |
| `get_execution` | Get full execution details and results using execution ID and workflow ID. |

### Lifecycle Management

| Tool | Description |
|---|---|
| `publish_workflow` | Activate a workflow for production execution. |
| `unpublish_workflow` | Deactivate a workflow to stop production execution. |
| `archive_workflow` | Archive a workflow by ID. |

---

## OAuth Scope Mapping

| MCP Tool | OAuth Scope | Status |
|---|---|---|
| `search_nodes` | `tool:searchNodes` | **new** |
| `get_node_types` | `tool:getNodeTypes` | **new** |
| `get_suggested_nodes` | `tool:getSuggestedNodes` | **new** |
| `validate_workflow` | `tool:validateWorkflow` | **new** |
| `create_workflow_from_code` | `tool:createWorkflow` | **new** |
| `update_workflow` | `tool:updateWorkflow` | **new** |
| `get_workflow_details` | `tool:getWorkflowDetails` | exists |
| `search_workflows` | `tool:listWorkflows` | exists |
| `execute_workflow` | `tool:executeWorkflow` | **new** |
| `get_execution` | `tool:getExecution` | **new** |
| `publish_workflow` | `tool:publishWorkflow` | **new** |
| `unpublish_workflow` | `tool:unpublishWorkflow` | **new** |
| `archive_workflow` | `tool:archiveWorkflow` | **new** |

---

## Summary

n8n **is** the auth server. n8n-desk uses **dual auth** to bridge the two separate auth domains:

1. **MCP OAuth** (browser-based PKCE) → MCP tool access via Bearer token
2. **Credential login** (email+password to `/rest/login`) → REST API access via `n8n-auth` cookie + user profile

**Implemented:**
- MCP OAuth2 PKCE flow with dynamic client registration
- Credential login with MFA support (TOTP code `998` detection)
- Secure token storage (`tokens.enc` for OAuth, `session.enc` for session) via Electron `safeStorage`
- Dual auth in `N8nApiClient` — auto-selects Cookie vs Bearer per endpoint path
- Session cookie auto-refresh via `api:fetch` IPC proxy intercepting `set-cookie` headers
- 4-step onboarding: URL → OAuth → Credentials → Connected

**Remaining gaps:**
1. Extend MCP OAuth scopes from 2 → 13 for full MCP tool coverage (n8n side)
2. Add ChatHub scopes (`chatHub:message`, `chatHubAgent:*`) to the OAuth server so chatUsers can authenticate (n8n side)
3. chatUser auth path — chatUsers can't use MCP OAuth, need credential login only or a parallel OAuth flow
