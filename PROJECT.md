# n8n-desk

> A cross-platform agent that brings your n8n automation workflows into a conversational interface — on desktop and mobile.

---

## What is n8n-desk?

**n8n-desk** is a cross-platform application that acts as a conversational front-end to your n8n instance. It operates in three distinct **modes** — Chat, Cowork, and Workflow — each providing a different level of agency and capability. Instead of navigating workflow editors or triggering webhooks manually, you interact through the mode that fits your task.

A personal automation operator that lives on your desktop or in your pocket. Built with Ionic Vue, it ships as a native-feeling app on desktop (Electron) and mobile (iOS/Android) from a single codebase — using true platform-adaptive Ionic components styled to match n8n-desk's own design language.

---

## Core Concept — Three Modes

n8n-desk is organized around a **top-level tab switch** with three modes. Each mode has its own set of chat sessions, its own capabilities, and its own relationship to your n8n instance and local environment.

```
┌──────────┬──────────┬──────────┐
│   Chat   │  Cowork  │ Workflow │   ← tab switch at top
└──────────┴──────────┴──────────┘
```

### Chat Mode — Talk to your agents

Pure conversational interface. Chat with your n8n ChatHub assistants and Workflow Agents. No local file access, no workflow editing — just messaging.

```
You  ──chat──▶  n8n ChatHub / Workflow Agent  ──▶  Response
```

- Talk to any n8n workflow that has a **Chat Trigger** node.
- Talk to n8n ChatHub assistants.
- The sidebar lists **all available chat-enabled agents** so you can pick which one to talk to.
- Each agent has its own conversation threads.
- **No file writes.** This mode is a pure chat client for your n8n conversational endpoints.
- Works identically on desktop and mobile.

### Cowork Mode — Local agent powered by n8n workflows

A deep, multi-step **local agent** that uses your n8n workflows as tools to accomplish tasks. Inspired by Claude Code / Claude Cowork — this is the power mode.

```
You  ──task──▶  Local Agent  ──executes──▶  n8n Workflows  ──▶  Results
                    │                                              │
                    └──── reads/writes local files ◀───────────────┘
```

- The local agent **plans, reasons, and executes multi-step tasks** — like a deep agent.
- It **reuses existing n8n workflows** as tools to fulfill tasks. It does **not** create or edit workflows.
- It **can read and write local files** in the working directory — process data, export results, work with documents.
- It calls n8n workflows on purpose as part of a plan, chains their results, and synthesizes final output.
- Think: "Use my n8n 'Extract Invoice Data' workflow on these 50 PDFs in my folder, then compile a summary spreadsheet."
- Each Cowork session has its own conversation history and task context.

### Workflow Mode — Edit n8n workflows with a local agent

Full workflow editing power. A local agent connected to Claude that can **modify, create, and manage n8n workflows** on your instance. Uses the `<n8n-demo>` web component (see [WORKFLOW_EMBED.md](WORKFLOW_EMBED.md)) to render interactive workflow previews, diffs, and builder previews inline.

```
You  ──intent──▶  Local Agent + Claude  ──n8n MCP──▶  Create/Edit Workflows
                        │                                     │
                        └──── optional local folder       workflow JSON
                                                              │
                                                    <n8n-demo> renders inline
```

- The local agent has **full edit power** over workflows on your n8n instance.
- Can create new workflows, modify existing ones, add/remove nodes, change configurations.
- **Visual workflow rendering** — uses `<n8n-demo>` to show workflow previews inline after edits, diff comparisons (before/after), and builder previews before saving. See [WORKFLOW_EMBED.md](WORKFLOW_EMBED.md) for component API and integration patterns.
- Optionally works with a **local folder** for enhanced capabilities (templates, reference files, exports).
- Powered by Claude + n8n MCP server tools (search, build, validate, create, update, etc.).
- Each Workflow session has its own conversation history.

---

## Mode Summary

| Aspect | Chat | Cowork | Workflow |
|---|---|---|---|
| **Purpose** | Talk to agents | Execute tasks using workflows | Edit workflows |
| **Local files** | No | Yes (read/write) | Optional |
| **Workflow editing** | No | No | Yes |
| **Agent depth** | Pass-through | Deep multi-step agent | Deep multi-step agent |
| **n8n interaction** | Chat Trigger messaging | Execute workflows as tools | Full MCP CRUD |
| **Own sessions** | Yes | Yes | Yes |
| **Sidebar** | Lists available agents | Task/session list | Session list |
| **Platforms** | Desktop + Mobile | Desktop only | Desktop only |

---

## Shared Principles

- **n8n does the heavy lifting.** All workflow execution, integrations, and automation logic live in your n8n instance.
- **The LLM is the brain.** Claude (recommended), OpenAI, or a local model interprets your intent, plans actions, and communicates results.
- **Authenticated user.** All modes operate under the authenticated n8n user's permissions and scope.

---

## Design Philosophy

n8n-desk is inspired by the principles behind **Claude Cowork**, adapted for automation orchestration.

### Mode-First Architecture
The three modes (Chat, Cowork, Workflow) are the primary organizing principle. Each mode is a distinct experience with its own sessions, capabilities, and UI affordances. Users switch modes based on intent — not based on platform or settings.

### Working Directory Model (Desktop — Cowork & Workflow)
On desktop, Cowork and Workflow modes operate from a **dedicated local directory** — just like Claude Code. This directory is the agent's workspace: it holds context, data files, and exports. The agent can **read and write files** within this directory. Everything stays local, portable, and inspectable.

### Mobile-First Chat (Mobile)
On mobile, **Chat mode is the only mode**. Cowork and Workflow modes are desktop-only — the local agent (Deep Agents SDK) requires Node.js, which is not available in Capacitor's native shell. Mobile shows only the Chat tab, not disabled tabs. Configuration and session state are stored within the app's sandboxed storage.

### Conversational Delegation
You describe what you want in plain language. In Chat mode, your message goes directly to the target agent. In Cowork mode, the local agent plans and executes using workflows as tools. In Workflow mode, the local agent builds and modifies workflows on your behalf.

---

## Workflow Agents (Chat Mode)

Any n8n workflow with a **Chat Trigger** node is automatically surfaced in Chat mode as a **Workflow Agent** — a dedicated, conversational endpoint you can chat with directly.

```
n8n workflow with Chat Trigger  ──▶  appears in Chat mode sidebar
```

- n8n-desk discovers all Chat Trigger workflows via the MCP server and lists them in the **Chat mode sidebar** as available agents.
- Each Workflow Agent has its own conversation threads — you talk to it like a specialized assistant.
- The Chat Trigger receives your messages, the workflow processes them, and the response flows back into the chat.
- ChatHub assistants also appear alongside Workflow Agents in the sidebar.

**Example:** A workflow called "IT Helpdesk" with a Chat Trigger becomes an "IT Helpdesk" agent in the Chat sidebar. You open it, ask "My VPN isn't connecting", and the workflow handles triage, lookups, and responses — all through the chat interface.

---

## Key Features

- **Three Distinct Modes** — Chat, Cowork, and Workflow modes each serve a different purpose with their own sessions and capabilities.
- **Workflow Agents** — Every n8n workflow with a Chat Trigger becomes a chattable agent in Chat mode, listed in the sidebar with its own conversation threads.
- **Deep Local Agent** — Cowork and Workflow modes feature a multi-step planning agent (inspired by Claude Code) that reasons, plans, and executes autonomously.
- **Workflow-as-Tool Execution** — In Cowork mode, the agent reuses existing n8n workflows as tools to accomplish complex tasks without modifying them.
- **Full Workflow Editing** — In Workflow mode, the agent can create, modify, and manage n8n workflows through the MCP server.
- **Local File Access** — Desktop Cowork and Workflow modes can read/write files in the working directory for data processing, exports, and context.
- **n8n MCP Integration** — Structured, reliable access to workflows, executions, and node configurations via the n8n MCP server.
- **Execution Awareness** — Query the status of running or past executions, surface errors, and report results without leaving the chat.
- **Per-Mode Sessions** — Each mode maintains its own independent chat sessions and history.

---

## Architecture

| Layer | Component | Description |
|---|---|---|
| Interface | Ionic Vue | Single codebase, custom-styled Ionic components. Desktop via Electron, mobile via Capacitor (iOS/Android). |
| Agent | Claude (recommended), OpenAI, or local model | Interprets intent, plans steps, synthesizes responses |
| Bridge | n8n MCP Server | Structured API layer between agent and n8n |
| Execution | n8n Instance | Hosts and runs all workflows and integrations |

---

## LLM Providers

n8n-desk is **Claude-first** but supports multiple providers:

| Provider | Method | Notes |
|---|---|---|
| **Claude** (recommended) | Anthropic API key | Full-featured, primary development target |
| **Claude** | Anthropic Keychain | Uses 5-hour usage window tokens — no long-lived API key needed |
| **OpenAI** | OpenAI API key | Alternative provider |
| **Local models** | Opt-in | For users who want fully offline operation |

---

## What n8n-desk is NOT

- **Not a code runner.** No local execution of Python, Node.js, or shell commands. File read/write is scoped to the working directory only.
- **Not a visual workflow editor.** Workflow mode edits workflows programmatically via the MCP server — it does not replicate n8n's visual canvas.
- **Not a replacement for n8n.** It's a companion layer — n8n remains the engine.

---

## Target Users

- **n8n power users** who want faster, more natural access to their automations
- **Teams** who want non-technical members to trigger and monitor workflows without touching the editor
- **Developers** who want a local agentic interface without spinning up cloud agent infrastructure

---

## Example Interactions

**Chat Mode — talking to a Workflow Agent:**
```
You:            "My VPN keeps disconnecting every 10 minutes."
IT Helpdesk:    I checked your VPN session logs — your token expired yesterday.
                I've triggered a credential refresh. Try reconnecting now.
```

**Chat Mode — talking to a ChatHub assistant:**
```
You:            "Summarize yesterday's sales numbers."
Sales Bot:      Yesterday's revenue was $42,300 across 18 orders. Top product: Widget Pro.
```

**Cowork Mode — local agent using workflows as tools:**
```
You:            "Process all invoices in ./inbox/ and create a summary spreadsheet."
Agent:          Plan: 1) Read PDF files from ./inbox/  2) Run 'Extract Invoice Data' workflow
                on each  3) Compile results  4) Write summary.xlsx

                Executing step 1... Found 12 invoices.
                Executing step 2... Extracted data from 12/12 invoices.
                Executing step 3-4... Done. Summary written to ./output/invoice_summary.xlsx
```

**Workflow Mode — editing workflows with the agent:**
```
You:            "Add a Slack notification step to my 'New Lead' workflow."
Agent:          I found 'New Lead Notification' (ID: 42). Currently it receives a webhook
                and writes to the CRM. I'll add a Slack message node after the CRM write.

                Done. Added 'Send Slack Message' node → #leads channel. Workflow validated
                and saved.
```

---

## Technical Requirements

- A running **n8n instance** (self-hosted or cloud)
- The **n8n MCP server** configured and accessible
- An LLM provider key (Anthropic API key recommended, or OpenAI / local model)
- macOS, Windows, Linux, iOS, or Android

---

## Roadmap

### MVP
Ship the three-mode experience end-to-end on desktop:

- Ionic Vue app with custom-styled Ionic components and top-level mode tab switch
- Desktop build via Electron, mobile builds via Capacitor (iOS/Android)
- Claude integration via Anthropic API key
- **Multiple n8n instance support** — connect to one or more n8n instances, each with its own auth, agents, and workflows
- **Chat Mode:** Auto-discover Chat Trigger workflows and ChatHub assistants, list in sidebar, dedicated conversation threads
- **Cowork Mode:** Deep local agent that plans multi-step tasks, executes n8n workflows as tools, reads/writes local files
- **Workflow Mode:** Local agent with full n8n MCP CRUD — create, edit, validate, and manage workflows
- Per-mode session management and history (JSONL-based local storage)
- Local working directory with configuration and session state (`~/.n8n-desk/`)
- **Onboarding flow:** Enter n8n URL → OAuth login → agent discovery → land in Chat mode (under 30 seconds)
- **Mobile:** Chat mode only (Cowork/Workflow tabs hidden — agent requires Node.js)

### Future

- Multi-provider LLM support (OpenAI, Anthropic Keychain, local models)
- Server-side agent proxy for mobile Cowork/Workflow modes
- Workflow discovery and introspection improvements

---

## Documentation Map

The companion docs each deep-dive into one aspect of this spec. Here's how they connect:

```
                    ┌──────────────┐
                    │  PROJECT.md  │  ← Master spec (the "what")
                    │  Vision/Arch │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
┌─────────────────┐ ┌────────────┐ ┌──────────────────┐
│ AUTHFLOW_AND_   │ │ CHATHUB.md │ │ COMPONENT_AND_   │
│ MCPTOOLS.md     │ │            │ │ DESIGN.md        │
│ (Auth + API)    │ │ (Backend)  │ │ (UI/Components)  │
└────────┬────────┘ └─────┬──────┘ └────────┬─────────┘
         │                │                  │
         └────────┬───────┘                  │
                  ▼                          │
         ┌────────────────┐                  │
         │ WORKFLOW_      │◀─────────────────┘
         │ EMBED.md       │
         │ (Visual layer) │
         └────────────────┘
```

| Doc | Answers | Connects To |
|---|---|---|
| [AUTHFLOW_AND_MCPTOOLS.md](AUTHFLOW_AND_MCPTOOLS.md) | How n8n-desk authenticates and what it can do | Maps Chat mode → chatUser/ChatHub REST, Cowork/Workflow → member+/13 MCP tools. Defines the two-tier access model that gates available modes. |
| [CHATHUB.md](CHATHUB.md) | How Chat mode works under the hood | Details the backend API (REST + WebSocket streaming) for conversations and two agent types (Workflow Agents + Custom Agents). n8n-desk becomes a thin client — Chat-Hub handles 14 LLM providers server-side. |
| [COMPONENT_AND_DESIGN.md](COMPONENT_AND_DESIGN.md) | What it looks like and what we can reuse | Maps n8n's 84-component design system to n8n-desk: fork AskAssistant chat components, copy design tokens, use Ionic for platform-adaptive layout/forms. |
| [WORKFLOW_EMBED.md](WORKFLOW_EMBED.md) | How workflows render visually in chat | The `<n8n-demo>` web component renders workflow previews, diffs, and builder previews inline. Bridges Workflow mode and MCP tools. |

### Key Design Notes

1. **LLM provider split** — Chat mode delegates LLM handling entirely to Chat-Hub (14 providers server-side). The LLM provider config in this spec applies only to Cowork and Workflow modes (the local agent).

2. **Auth gap for chatUsers** — chatUser lacks `mcp:oauth` scope, so n8n must either extend MCP OAuth or provide a parallel auth path for Chat-Hub access. Unsolved.

3. **Dual API surface** — n8n-desk talks to n8n via two channels: MCP (workflow CRUD/execution) and Chat-Hub REST+WebSocket (conversations/streaming). These need unified error handling, auth token management, and connection state.

4. **Agent architecture** — The local agent for Cowork and Workflow modes is defined in `CLAUDE.md` under "Local Agent — Deep Agents SDK". Both modes use `deepagents` with different tool sets — Cowork gets workflow execution + local files, Workflow gets full MCP CRUD.

---

## Name & Identity

**n8n-desk** — where your automation workflows come to talk.

Inspired by the working-directory-first, conversational-delegation model pioneered by Claude Cowork, reimagined as an automation orchestration layer for n8n.