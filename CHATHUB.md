# n8n Chat-Hub Integration

> How n8n-desk can use the n8n Chat-Hub API as its conversational backend — for both Workflow Agents and Custom Agents.

---

## What is Chat-Hub?

The `@n8n/chat-hub` package is a utility library (message parsing, artifact processing), but the real value is the **backend Chat-Hub module** (`packages/cli/src/modules/chat-hub/`) — a full REST + WebSocket API for conversational AI built into n8n itself.

It supports **14 LLM providers** out of the box: OpenAI, Anthropic, Google, Azure OpenAI, Azure Entra ID, Ollama, AWS Bedrock, Vercel AI Gateway, xAI/Grok, Groq, OpenRouter, DeepSeek, Cohere, and Mistral.

---

## Architecture with Chat-Hub

```
                          ┌─── n8n MCP ──▶ Workflow CRUD, execution management
n8n-desk ──API──▶ n8n ──┤
                          └─── Chat-Hub API ──▶ Conversational agents (both types)
```

- **n8n MCP** handles workflow discovery, creation, execution management.
- **Chat-Hub API** handles all conversational interactions — sending messages, streaming responses, managing sessions, and working with agents.

---

## Two Agent Types — One API

### 1. Workflow Agents

Any n8n workflow with a **Chat Trigger** node. To chat with one, send a message specifying:

```json
{ "provider": "n8n", "workflowId": "..." }
```

Chat-Hub dynamically builds and executes the workflow behind the scenes.

### 2. Custom Agents

Standalone agents created directly in Chat-Hub with:

- Custom system prompts
- Tool bindings (n8n node-based tools)
- Knowledge base files (embeddings for semantic search)
- Suggested prompts
- Custom icons/emojis

No workflow required — these are configured and managed entirely via the Chat-Hub API.

Both agent types use the same `POST /chat/conversations/send` endpoint.

---

## REST API Endpoints

### Conversations

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/chat/conversations/send` | Send a message (to any agent type) |
| GET | `/chat/conversations` | List conversation sessions |
| GET | `/chat/conversations/:sessionId` | Get conversation history |
| POST | `/chat/conversations/:sessionId/reconnect` | Replay missed stream chunks |
| POST | `/chat/conversations/:sessionId/messages/:id/edit` | Edit a message |
| POST | `/chat/conversations/:sessionId/messages/:id/regenerate` | Regenerate AI response |
| POST | `/chat/conversations/:sessionId/messages/:id/stop` | Stop generation |
| PATCH | `/chat/conversations/:sessionId` | Update session metadata |
| DELETE | `/chat/conversations/:sessionId` | Delete a conversation |

### Models

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/chat/models` | List available LLM models by provider |

### Agents

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/chat/agents/:agentId` | Get agent details |
| POST | `/chat/agents` | Create a custom agent |
| POST | `/chat/agents/:agentId` | Update an agent |
| DELETE | `/chat/agents/:agentId` | Delete an agent |
| POST | `/chat/agents/:agentId/files` | Upload knowledge base files |
| DELETE | `/chat/agents/:agentId/files/:fileKnowledgeId` | Remove a knowledge file |

### Tools

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/chat/tools` | List available tools |
| POST | `/chat/tools` | Create a tool |
| PATCH | `/chat/tools/:toolId` | Update a tool |
| DELETE | `/chat/tools/:toolId` | Delete a tool |

### Settings

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/chat/settings` | Get chat settings |
| GET | `/chat/settings/:provider` | Get provider-specific settings |
| POST | `/chat/settings` | Update chat settings |
| PUT | `/chat/semantic-search` | Configure semantic search |

---

## Streaming via WebSocket

Responses stream in real-time via WebSocket push events:

| Event | Purpose |
|-------|---------|
| `ChatHubStreamBegin` | Stream started |
| `ChatHubStreamChunk` | Incremental text chunk |
| `ChatHubStreamEnd` | Stream completed |
| `ChatHubStreamError` | Stream error |
| `ChatHubExecutionBegin` | Workflow execution started |
| `ChatHubExecutionEnd` | Workflow execution completed |
| `ChatHubHumanMessageCreated` | Message sync across clients |
| `ChatHubMessageEdited` | Edit sync across clients |

Reconnection is supported via `POST /chat/conversations/:sessionId/reconnect` to replay missed chunks.

---

## Key Data Types

### ChatHubSendMessageRequest

```typescript
{
  message: string;
  model: ChatHubConversationModel; // { provider, model, credentialId } or { provider: 'n8n', workflowId }
  sessionId?: string;
  attachments?: File[];
}
```

### ChatHubConversationModel (discriminated union)

```typescript
// LLM provider
{ provider: 'openai' | 'anthropic' | 'google' | ..., model: string, credentialId: string }

// n8n workflow agent
{ provider: 'n8n', workflowId: string }

// Custom agent
{ provider: 'custom-agent', agentId: string }
```

### ChatHubAgentDto

```typescript
{
  id: string;
  name: string;
  systemPrompt: string;
  tools: ChatHubToolDto[];
  knowledgeFiles: FileKnowledgeDto[];
  suggestedPrompts: string[];
  icon: { type: 'emoji' | 'icon', value: string };
}
```

### ChatHubSessionDto

```typescript
{
  id: string;
  title: string;
  model: ChatHubConversationModel;
  messages: ChatHubMessageDto[];
  createdAt: string;
  updatedAt: string;
}
```

---

## What This Means for n8n-desk

### Advantages of Using Chat-Hub API

- **Unified conversation interface** for both workflow agents and custom agents
- **Built-in streaming** via WebSocket — no polling
- **Server-side session management** — conversation history, editing, regeneration handled by n8n
- **14 LLM providers** already integrated — n8n-desk doesn't need its own LLM connections
- **Tool binding** — attach n8n node-based tools to any agent
- **Knowledge base** — upload files for semantic search per agent
- **Artifact support** — structured code/document generation with edit commands

### Simplified n8n-desk Architecture

Instead of n8n-desk managing its own LLM integration:

1. **n8n-desk becomes a thin client** — sends messages to `POST /chat/conversations/send`, streams responses via WebSocket
2. **Custom agents created via API** — build specialized agents without needing n8n workflows
3. **Workflow agents discovered automatically** — query for Chat Trigger workflows and present alongside custom agents
4. **Session state lives in n8n** — no client-side conversation persistence needed

### Integration Pattern

```
n8n-desk (Ionic Vue)
  ├── REST client → n8n Chat-Hub API (conversations, agents, tools)
  ├── WebSocket client → n8n push events (streaming responses)
  └── MCP client → n8n MCP server (workflow CRUD, execution management)
```

---

## Source Code References

| Component | Location |
|-----------|----------|
| Chat-Hub utility package | `n8n-master/packages/@n8n/chat-hub/src/` |
| Message parser | `n8n-master/packages/@n8n/chat-hub/src/parser.ts` |
| Artifact collector | `n8n-master/packages/@n8n/chat-hub/src/artifact.ts` |
| LLM provider constants | `n8n-master/packages/@n8n/chat-hub/src/constants.ts` |
| Backend module | `n8n-master/packages/cli/src/modules/chat-hub/` |
| REST controller | `n8n-master/packages/cli/src/modules/chat-hub/chat-hub.controller.ts` |
| Settings controller | `n8n-master/packages/cli/src/modules/chat-hub/chat-hub.settings.controller.ts` |
| Main service | `n8n-master/packages/cli/src/modules/chat-hub/chat-hub.service.ts` |
| Agent service | `n8n-master/packages/cli/src/modules/chat-hub/chat-hub-agent.service.ts` |
| Workflow builder | `n8n-master/packages/cli/src/modules/chat-hub/chat-hub-workflow.service.ts` |
| Execution service | `n8n-master/packages/cli/src/modules/chat-hub/chat-hub-execution.service.ts` |
| Stream service | `n8n-master/packages/cli/src/modules/chat-hub/chat-stream.service.ts` |
| API types | `n8n-master/packages/@n8n/api-types/src/chat-hub.ts` |
| Push event types | `n8n-master/packages/@n8n/api-types/src/push/chat-hub.ts` |
