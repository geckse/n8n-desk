# n8n Workflow Embed Component

> How n8n-desk can use the `<n8n-demo>` web component to render interactive workflow previews inline — in chat responses, agent cards, and workflow discovery.

---

## What is `<n8n-demo>`?

`<n8n-demo>` is an official n8n web component (`@n8n_io/n8n-demo-component`) built with LitElement and TypeScript. It renders a fully interactive n8n workflow canvas — nodes, connections, and settings — directly in HTML. No iframe setup or n8n editor required.

It supports single workflow preview, side-by-side diff comparison, theming, auto-layout, and mobile-friendly collapsing.

**Package:** `@n8n_io/n8n-demo-component` (npm, v1.0.20)

---

## Why This Matters for n8n-desk

n8n-desk is a conversational interface to n8n. When the agent discusses, discovers, or builds workflows, showing them visually — not just describing them — makes the experience dramatically better.

### Use Cases

| Context | How `<n8n-demo>` Helps |
|---|---|
| **Workflow discovery** | "What workflows do I have?" — show previews alongside descriptions |
| **Execution results** | Render the workflow that just ran, with node states visible |
| **Workflow building** | When the agent creates a workflow via MCP, show it inline for review before saving |
| **Diff view** | "What changed in this workflow?" — use diff mode to compare before/after |
| **Workflow Agents** | Show the underlying workflow structure of any Chat Trigger agent |
| **Onboarding** | Display example workflows during setup or tutorials |

---

## Integration in n8n-desk

### Installation

Load via CDN — no build step required:

```html
<script src="https://cdn.jsdelivr.net/npm/@webcomponents/webcomponentsjs@2.0.0/webcomponents-loader.js"></script>
<script src="https://www.unpkg.com/lit@2.0.0-rc.2/polyfill-support.js"></script>
<script type="module" src="https://cdn.jsdelivr.net/npm/@n8n_io/n8n-demo-component/n8n-demo.bundled.js"></script>
```

Or install locally:

```bash
npm i @n8n_io/n8n-demo-component
```

### Basic Usage

```html
<n8n-demo
  workflow='{"nodes":[...],"connections":{...}}'
  theme="dark"
  frame="true"
  tidyup="true"
></n8n-demo>
```

### Vue/Ionic Integration

Works with declarative rendering in Vue — pass workflow JSON as a property:

```vue
<template>
  <n8n-demo
    :workflow="workflowJson"
    :theme="currentTheme"
    frame="true"
    tidyup="true"
    disableinteractivity="true"
  />
</template>
```

**Note:** Since `<n8n-demo>` is a web component (custom element), Vue treats it as a native element. Register it in the Vue/Vite config with `compilerOptions.isCustomElement` to suppress unknown component warnings.

---

## Component API

### Key Attributes

| Attribute | Type | Default | Purpose |
|---|---|---|---|
| `workflow` | string (JSON) | `'{}'` | Workflow JSON to render |
| `frame` | string | `'false'` | Show frame with code viewer and copy button |
| `theme` | `'light'` \| `'dark'` \| undefined | — | Force light or dark theme |
| `mode` | `'demo'` \| `'diff'` | `'demo'` | Single view or diff comparison |
| `workflowbefore` | string (JSON) | `'{}'` | "Before" workflow for diff mode |
| `tidyup` | string | `'false'` | Auto-layout nodes on load |
| `disableinteractivity` | string | `'false'` | Fully disable user interaction |
| `clicktointeract` | string | `'false'` | Require click before interaction (scroll-friendly) |
| `collapseformobile` | string | `'true'` | Collapse on mobile for easier scrolling |
| `hidecanvaserrors` | string | `'false'` | Hide node error indicators |
| `src` | string | n8n preview service URL | URL for n8n instance to load workflow |

### Relevant Properties (Read-Only State)

| Property | Type | Description |
|---|---|---|
| `showCode` | boolean | Whether code panel is visible |
| `showPreview` | boolean | Whether preview is visible |
| `fullscreen` | boolean | Whether in fullscreen mode |
| `n8nReady` | boolean | Whether the embedded n8n instance is ready |
| `interactive` | boolean | Whether user can interact |
| `error` | boolean | Whether an error occurred |

### Methods

| Method | Description |
|---|---|
| `loadWorkflow()` | Load/reload the workflow |
| `loadDiff()` | Load diff comparison |
| `toggleCode()` | Toggle code panel visibility |
| `copyClipboard()` | Copy workflow JSON to clipboard |
| `toggleView()` | Toggle between code and preview |

---

## n8n-desk Integration Patterns

### 1. Chat Response Embeds

When the agent returns workflow information, render it visually:

```
Agent: "Here's your 'Daily Report' workflow:"
┌──────────────────────────────────────┐
│  <n8n-demo> renders workflow inline  │
│  [Schedule] → [Query DB] → [Email]  │
└──────────────────────────────────────┘
```

- Use `disableinteractivity="true"` for inline previews in chat messages
- Use `clicktointeract="true"` if allowing interaction (prevents scroll hijacking)
- Apply `tidyup="true"` for consistently clean layouts
- Match `theme` to n8n-desk's current theme (light/dark)

### 2. Workflow Diff in Chat

When comparing workflow versions:

```html
<n8n-demo
  mode="diff"
  workflowbefore='<previous version JSON>'
  workflow='<current version JSON>'
  theme="dark"
/>
```

Useful for: "What changed in my last workflow update?" or showing proposed changes before saving.

### 3. Workflow Builder Preview

When the agent creates a workflow via n8n MCP tools, show a preview before committing:

```
Agent: "I've drafted a workflow to sync Slack messages to Notion. Here's the preview:"
┌────────────────────────────────────────────┐
│  <n8n-demo> with frame="true"              │
│  [Slack Trigger] → [Set] → [Notion Create] │
│  [Copy JSON]  [Code View]                   │
└────────────────────────────────────────────┘
Agent: "Want me to save this to your n8n instance?"
```

- Use `frame="true"` to show code panel with copy button
- The user can copy the JSON or inspect the workflow before confirming

### 4. Mobile Considerations

- `collapseformobile="true"` (default) — prevents the canvas from blocking scroll
- `clicktointeract="true"` — adds an overlay tap-to-activate, better for mobile scroll
- Consider showing a static thumbnail on mobile with a "View workflow" expand button

---

## Data Flow

```
n8n MCP (get_workflow_details)  ──▶  workflow JSON  ──▶  <n8n-demo workflow='...'>
                                                          └──▶  rendered canvas in chat
```

The workflow JSON returned by n8n MCP's `get_workflow_details` or `search_workflows` tools can be passed directly to the `<n8n-demo>` component's `workflow` attribute.

---

## Considerations

### Performance
- The component loads an iframe internally — avoid rendering multiple instances simultaneously in a chat thread
- Use `IntersectionObserver` (built into the component) for lazy loading — iframes only load when scrolled into view
- For chat history with many workflows, consider replacing off-screen embeds with static previews

### Security
- The `src` attribute defaults to n8n's internal preview service — for self-hosted n8n instances, this should point to the user's own n8n URL
- Workflow JSON may contain sensitive data (API keys in node parameters) — sanitize before rendering if the workflow hasn't been scrubbed

### Theming
- Sync the `theme` attribute with n8n-desk's theme setting to maintain visual consistency
- The component respects `'light'` and `'dark'` — map from n8n-desk's theme preference

---

## Source & Distribution

| Item | Reference |
|---|---|
| npm package | `@n8n_io/n8n-demo-component` |
| CDN (bundled) | `https://cdn.jsdelivr.net/npm/@n8n_io/n8n-demo-component/n8n-demo.bundled.js` |
| Built with | LitElement, TypeScript |
| Current version | 1.0.20 |
