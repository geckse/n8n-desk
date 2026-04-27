<p align="center">
  <img src=".github/assets/logo.svg" width="96" alt="n8n-desk logo" />
</p>

<h1 align="center">n8n-desk</h1>

<p align="center"><strong>Bringing n8n to your Machine</strong></p>

<p align="center">
  <em>A self-harnessed agent for n8n — powerful enough to automate your desktop,<br/>
  constrained enough to stay safe.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-coming%20soon-FF6D5A" alt="Status: Coming Soon" />
  <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="Version 0.1.0" />
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-Sustainable%20Use-green" alt="License: Sustainable Use" /></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20iOS%20%7C%20Android-lightgrey" alt="Platforms" />
</p>

<p align="center">
  <a href="https://n8n-desk.app">
    <img src="https://img.shields.io/badge/Join_the_Waitlist-→-FF6D5A?style=for-the-badge" alt="Join the Waitlist" />
  </a>
  &nbsp;
  <a href="https://github.com/geckse/n8n-desk">
    <img src="https://img.shields.io/github/stars/geckse/n8n-desk?style=for-the-badge&logo=github&label=Star" alt="Star on GitHub" />
  </a>
</p>

---

## Built with

![Vue 3](https://img.shields.io/badge/Vue_3-35495E?logo=vue.js&logoColor=4FC08D)
![Ionic 8](https://img.shields.io/badge/Ionic_8-3880FF?logo=ionic&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-191970?logo=electron&logoColor=white)
![Capacitor](https://img.shields.io/badge/Capacitor-119EFF?logo=capacitor&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![LangChain](https://img.shields.io/badge/LangChain-1C3C3C?logo=langchain&logoColor=white)
![Anthropic](https://img.shields.io/badge/Claude_SDK-D97757?logo=anthropic&logoColor=white)
![Pinia](https://img.shields.io/badge/Pinia-FFD859?logo=pinia&logoColor=black)


---

## What is n8n-desk?

n8n is extraordinarily capable — hundreds of integrations, complex workflow logic,
scheduling, webhooks. But interacting with it still means navigating a visual editor
in a browser tab, manually triggering workflows, and switching contexts to check
results.

**n8n-desk closes that gap.** It's a desktop-native (and mobile-ready) companion app
that lets you talk to your n8n instance instead of clicking through it. Trigger
workflows, build new ones, or let an agent process local files using your existing
automations — all from one conversational interface.

n8n-desk doesn't run arbitrary code. The agent's only hands are n8n workflows and
sandboxed file access. Everything the agent does is auditable, reversible, and
constrained by what your n8n instance already allows.

---

## Three Modes. One App.

### Chat

![Chat mode](.github/assets/screenshot-chat-mode.png)

**Use your Chat Hub Agents directly from the desktop. A thin client to n8n's
conversational AI assistants.**

Zero local agency — n8n-desk just routes messages to your n8n Chat Hub and streams
responses back. No file access, no workflow editing, no surprise actions. The same
agents your team already uses on the web, now native on your machine and in your
pocket.

**Best for:** day-to-day Q&A with your existing Chat Hub agents, on-the-go workflow
triggers, mobile access to team-built assistants.

_Available on: Desktop · Mobile_

---

### Cowork

![Cowork mode](.github/assets/screenshot-cowork-mode.png)

**Work within local project folders and files. Your AI agent reads, writes, and
organizes — powered by n8n workflows as tools.**

Controlled agency — a local planning agent that uses your existing n8n workflows
as tools and reads/writes files in a working directory you choose. It can call
workflows; it cannot create or modify them. Think of it as a power user who knows
your automation library cold and applies it to whatever's on your disk.

**Best for:** processing invoices and documents, preparing reports from local data,
batch-running workflows against folders, organizing files with AI assistance.

_Available on: Desktop only_

---

### Workflow

![Workflow mode](.github/assets/screenshot-workflow-mode.png)

**Build, validate, and manage n8n workflows conversationally using the official
n8n MCP server.**

Structured agency — a local agent with full workflow management capabilities through
n8n's MCP server. It can search nodes, draft workflows, validate them, publish,
execute, and archive — but only through the defined MCP tools, never by injecting
raw code. Inline visual previews show you what the agent built before it goes live.

**Best for:** drafting workflows from a description, refactoring existing automations,
exploring nodes you haven't used before, teaching teammates how to build with n8n.

_Available on: Desktop only_

---

## Powerful through AI. n8n as Execution Layer.

| Feature | What it means |
|---|---|
| **Desktop-Native** | A dedicated app that talks directly to your n8n instances. No browser tab required. |
| **Multi-Instance Support** | Connect and switch between multiple n8n instances — production, staging, local dev. |
| **Official n8n MCP** | Direct integration via n8n's Model Context Protocol server for workflow management. |
| **Anthropic SDK + Open-Source Models** | Supports the official Anthropic SDK, plus any LangChain-compatible model via Deep Agents. |
| **Local Models via Ollama** | Run fully offline with Ollama or any OpenAI-compatible endpoint. No API key required. |
| **No Local Code Execution** | n8n becomes your execution layer. Your machine stays clean — workflows run on your instance. |
| **Full Audit Trails** | Agent actions flow through n8n, giving you complete execution logs and history. |
| **Secure by Design** | Tokens in the OS keychain. OAuth2 PKCE for all connections. No secrets in config files. |
| **Free Open Source** | Released under the Sustainable Use License. Inspect, modify, and contribute — with fair limits to keep it sustainable. |
| **Cross-Platform Ready** | Built with Ionic + Capacitor. Desktop first, mobile follows. One codebase, every platform. |
| **Login with your n8n Account** | Sign in with your n8n account. Role-based access — chat users see Chat, admins see everything. |
| **Conversational Workflow Builder** | Describe what you want in plain language. The agent builds, validates, and deploys the workflow. |

---

## n8n-desk vs. general coding agents

n8n-desk is deliberately **not** a general-purpose coding agent. That's the point.

|  | Coding agents (Claude Code, Cursor, …) | n8n-desk |
|---|---|---|
| **Execution** | Runs arbitrary code | Calls n8n workflows — no code execution |
| **Scope** | Filesystem, shell, network | Working directory + n8n instance |
| **Guardrails** | LLM self-regulation | n8n permissions + structured API |
| **Auditability** | Git diffs after the fact | Every action logged in n8n |
| **Worst-case blast radius** | High (`rm -rf`, force-push) | Low (a workflow you can undo) |

The agent is powerful because n8n is powerful. It's safe by design because n8n is the perimeter.

---

## Who it's for

- **n8n users** who want to interact with their automations conversationally instead
  of through a browser UI.
- **Teams** where non-technical members need to trigger and monitor workflows without
  learning the visual editor.
- **Power users** who want their n8n workflows to reach into their local filesystem —
  processing documents, generating reports, organizing files — without manual
  upload/download cycles.
- **Anyone** who wants an agent that's useful enough to automate real work but
  constrained enough that you don't worry about what it might do unsupervised.

---

## Platform support

|  | Chat | Cowork | Workflow |
|---|:---:|:---:|:---:|
| **macOS / Windows / Linux** | yes | yes | yes |
| **iOS / Android** | yes | — | — |

All three modes are available on desktop. Mobile is Chat-only — Cowork and Workflow
need a local agent runtime that desktop OSes provide and mobile sandboxes don't.

---

## MCP Servers

n8n-desk uses the [Model Context Protocol](https://modelcontextprotocol.io) to give
its agents structured access to your n8n instance. Both built-in agent runtimes —
the **Claude Agent SDK** and the **Deep Agents SDK** — connect to the same MCP
servers, so the capabilities stay identical no matter which one you pick.

| MCP Server | Claude Agent SDK | Deep Agents SDK |
|---|:---:|:---:|
| **Official n8n MCP** — built into n8n. Exposes the workflow lifecycle: search, build, validate, create, execute, publish, archive. | yes | yes |
| **Community n8n MCP** ([czlonkowski/n8n-mcp](https://github.com/czlonkowski/n8n-mcp)) — richer node discovery, schema lookups, validation. | planned | planned |

Internally, the Claude runner exposes tools via a local MCP bridge; the Deep Agents
runner wraps the same tools as LangChain tools directly. Same behavior, two
runtimes — pick whichever fits the model and infrastructure you want.

---

## Tech stack (in one paragraph)

n8n-desk is a single Ionic + Vue 3 codebase compiled to native shells: **Electron**
for desktop, **Capacitor** for iOS and Android. The conversational agent is built on
the **Claude Agent SDK** and **LangChain / Deep Agents**, with the **n8n MCP server**
as the structured tool surface for workflow management. State lives in **Pinia**;
persistent data lives in `~/.n8n-desk/`; secrets live in the OS keychain. For the
full architecture, see [CLAUDE.md](CLAUDE.md).

---

## Status & roadmap

**Status: Coming Soon.** n8n-desk is in pre-release. The waitlist is open at
**[n8n-desk.app](https://n8n-desk.app)** — sign up to be the first to know when
builds are ready.

**Plans (subject to change):**

- **Free** — all three modes, unlimited sessions, multi-instance, dark/light theme,
  every platform. The free tier is the product, not a teaser.

No feature gates on existing free-tier capability. Monetized Features, if any, add convenience,
collaboration, and compliance — they don't lock away the core.

---

## Next Steps

The road to first release:

1. **Native builds** — packaging the Electron desktop app for macOS, Windows, and
   Linux, plus Capacitor builds for iOS and Android.
2. **Alpha release** — first public build, distributed to waitlist members for
   early feedback before the broader open beta.

**You can help shape it:**

- **[Join the waitlist →](https://n8n-desk.app)** Be the first to know when alpha
  builds are ready.
- **[Star the repo →](https://github.com/geckse/n8n-desk)** Support the project and
  keep track of development as it ships.

---

## Open Source. Community Driven.

n8n-desk is an independent, open-source community project. It is **not officially
affiliated with, endorsed by, or maintained by n8n GmbH or n8n.io.** It builds on
n8n's open platform and available APIs.

---

## Built by

<p align="center">
  <img src=".github/assets/geckse.jpg" width="80" alt="Marcel Claus-Ahrens" style="border-radius: 50%;" />
</p>

<p align="center">
  Built by <strong>Marcel "geckse" Claus-Ahrens</strong><br/>
  <sub><em>n8n Ambassador</em></sub>
</p>

<p align="center">
  <a href="https://linkedin.com/in/geckse">LinkedIn</a> ·
  <a href="https://youtube.com/geckse">YouTube</a> ·
  <a href="https://github.com/geckse">GitHub</a>
</p>

---

## License

Released under the **n8n-desk Sustainable Use License** — see [LICENSE.md](LICENSE.md).
n8n-desk stays free for everyone: use it, modify it, fork it, contribute back. Build
and monetize anything **on top of** n8n-desk — consulting, plugins, themes,
templates, integrations, training, support — those are yours. The one ask: don't
repaint n8n-desk and ship it as your own paid app without talking to us first. Same
spirit as n8n's own license.
