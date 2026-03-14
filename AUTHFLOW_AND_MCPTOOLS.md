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
- **CORS:** Enabled for discovery endpoints

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
| **Session cookies** | `n8n-auth` cookie, JWT-based, HttpOnly, MFA support |
| **API keys** | `X-N8N-API-KEY` header, JWT-based with expiration |
| **OIDC SSO** | Enterprise, endpoints at `/sso/oidc/*` |
| **SAML SSO** | Enterprise, endpoints at `/sso/saml/*` |
| **LDAP** | Enterprise, alternative auth backend |

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

### Auth Flow (Full Automation — member/admin/owner)

```
n8n-desk app  ──OAuth2 authorize──▶  n8n instance login page
     ◀──────── auth code callback ──────
     ──────── exchange for tokens ──▶  /mcp-oauth/token
     ◀──────── access_token + refresh_token ──────
     ──────── MCP calls with bearer token ──▶  n8n MCP server
```

### Auth Flow (Chat-only — chatUser)

```
n8n-desk app  ──OAuth2 authorize──▶  n8n instance login page
     ◀──────── auth code callback ──────
     ──────── exchange for tokens ──▶  /mcp-oauth/token (chat scopes only)
     ◀──────── access_token + refresh_token ──────
     ──────── REST calls with bearer token ──▶  n8n ChatHub API
```

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

n8n **is** the auth server. No custom auth infrastructure needed. The existing MCP OAuth2 server handles authorization code + PKCE, dynamic client registration, and token lifecycle.

**Gaps to close:**
1. Extend MCP OAuth scopes from 2 → 13 for full MCP tool coverage
2. Add ChatHub scopes (`chatHub:message`, `chatHubAgent:*`) to the OAuth server so chatUsers can authenticate
3. n8n-desk must be **role-aware** — detecting whether the user is a chatUser or member+ and adapting the UI accordingly
4. chatUsers use the **ChatHub REST API** directly; members+ use **MCP tools** via bearer token

This two-tier model means n8n-desk works for everyone: power users who manage workflows AND team members who just need to chat with Workflow Agents.
