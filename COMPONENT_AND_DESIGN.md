# n8n-desk Component & Design Analysis

> What we can reuse, fork, or draw inspiration from in n8n's design system (`@n8n/design-system`) — mapped to n8n-desk's needs.

---

## Source Overview

The n8n design system is a **mature, enterprise-grade Vue 3 + TypeScript component library** with 84 components, comprehensive theming via CSS variables, accessibility-first design, and a clear migration path from legacy (Element Plus) to modern (reka-ui) patterns.

**Key tech:** Vue 3 `<script setup>`, TypeScript, SCSS with CSS variables, CSS Modules, reka-ui (headless UI), Vite, Storybook.

---

## Directly Reusable

### 1. Design Tokens & Theming

The entire CSS variable system gives us n8n's color palette, spacing scale, typography, and border radius — all with dark mode support via `[data-theme="dark"]`.

| Token Category | Variables | Example |
|---|---|---|
| Colors | Primary, Secondary, Success, Warning, Danger + neutral palette (50–950) | `--color--primary` |
| Spacing | 5xs (2px) through 5xl (256px) | `--spacing--m` |
| Typography | Font sizes 3xs–2xl, weights, line heights | `--font-size--s` |
| Borders | Radius sm (2px) to xl (12px), widths, styles | `--radius--m` |
| Dark mode | Full dark palette via `[data-theme="dark"]` selector | Automatic swap |

**Why reuse:** n8n-desk should feel like an n8n companion. Importing these tokens ensures visual consistency without manually matching colors. We can import just the SCSS token files without pulling in components.

**Source files:**
- `design-system/src/css/_primitives.scss` — base color/spacing variables
- `design-system/src/css/_tokens.scss` — semantic tokens with backwards compatibility
- `design-system/src/css/fonts.scss` — typography (InterVariable)

### 2. Chat-Specific Components (AskAssistant Family)

n8n already has a full chat/assistant UI component family — this is the most directly relevant code for n8n-desk:

| Component | Purpose | n8n-desk Use |
|---|---|---|
| `AskAssistantChat` | Full chat container | Core chat view template |
| `AskAssistantAvatar` | Agent/user avatar | Identity in chat bubbles |
| `AskAssistantButton` | Chat action button | Message actions |
| `AskAssistantText` | Styled text in chat | Message content rendering |
| `AskAssistantIcon` | Chat-specific icons | Status indicators |
| `AskAssistantInlineButton` | Inline action in messages | Quick actions within responses |

**Source:** `design-system/src/components/AskAssistant*/`

### 3. Conversation UI Components

| Component | Purpose | n8n-desk Use |
|---|---|---|
| `N8nMarkdown` | Markdown rendering with emoji/link support | Agent response rendering |
| `N8nSendStopButton` | Send/stop toggle button | Chat input send/cancel |
| `N8nPromptInput` | Text input with suggestions | Chat input field |
| `N8nPromptInputSuggestions` | Suggestion chips | Suggested prompts from Chat-Hub agents |
| `BlinkingCursor` | Typing indicator | Agent "thinking" state |
| `N8nScrollArea` | Styled scrollable container | Chat message list |
| `N8nAvatar` | User/agent identity | Chat bubble avatars |
| `N8nUserInfo` | User display info | Agent identity display |

### 4. Status & Feedback Components

| Component | Purpose | n8n-desk Use |
|---|---|---|
| `N8nSpinner` / `N8nLoading` | Loading states | Waiting for n8n executions |
| `N8nCallout` | System messages | Execution status, warnings |
| `N8nNotice` | Notices/alerts | Connection status, errors |
| `N8nBadge` | Status badges | Agent online/offline, execution state |
| `N8nTag` / `N8nTags` | Labels | Workflow tags, agent categories |

### 5. Utility Functions & Directives

| Utility | Purpose | n8n-desk Use |
|---|---|---|
| `cn()` | Class name merging (clsx wrapper) | Conditional styling |
| `v-n8n-html` | Sanitized HTML rendering (XSS prevention) | Safe agent response display |
| `markdown()` | Markdown-to-HTML parsing | Agent response processing |
| `uid()` | Unique ID generation | Message/session IDs |
| `v-n8n-truncate` | Text truncation | Long workflow names in lists |

**Source:** `design-system/src/utils/`, `design-system/src/directives/`

---

## Strong Inspiration (Adapt the Pattern)

### 6. Component Architecture Patterns

n8n's component patterns translate directly to Ionic Vue:

- **Compound components** — Dialog → DialogContent/Title/Footer maps to ChatMessage → MessageContent/MessageActions/MessageMeta
- **CSS Modules** — `<style lang="scss" module>` for scoped, themeable styles
- **Headless + styled** — reka-ui primitives with n8n styling on top; same approach works with Ionic's component primitives
- **Accessibility-first** — ARIA attributes, focus management, keyboard support built into every component

### 7. Form Components (Settings & Config Screens)

n8n-desk needs settings screens for API keys, n8n instance URL, LLM provider selection:

| Component | Inspiration For |
|---|---|
| `N8nFormBox` / `N8nFormInputs` | Settings form layout |
| `N8nSelect` / `N8nRadioButtons` | Provider selection |
| `N8nInput` | API key / URL entry |
| `N8nSwitch` | Feature toggles |
| `N8nInputLabel` | Labels with helper text |

**Note:** Ionic handles platform-adaptive forms better than n8n's web-only components. Use these for pattern inspiration, not direct reuse.

### 8. Navigation Patterns

| Component | Inspiration For |
|---|---|
| `N8nTabs` | Switching between Workflow Agents |
| `N8nCommandBar` | Quick workflow/agent search |
| `N8nActionDropdown` | Context menus on conversations |
| `N8nBreadcrumbs` | Navigation hierarchy |

**Note:** Ionic's adaptive nav (tabs on mobile, sidebar on desktop) fits n8n-desk's cross-platform needs better. Use these for interaction design reference.

### 9. Data Display (Selective)

| Component | Inspiration For |
|---|---|
| `N8nCard` | Agent cards in agent picker |
| `CodeDiff` | Showing workflow changes |
| `N8nInfoAccordion` | Expandable execution details |
| `N8nSuggestedActions` | Quick action chips |

---

## What NOT to Reuse

| Component/Area | Reason |
|---|---|
| `N8nDatatable` / table components | n8n-desk is chat-first, not data-grid-first |
| Element Plus dependencies | Legacy baggage; Ionic handles this layer |
| Node/workflow editor components (`N8nNodeIcon`, `N8nNodeCreatorNode`) | n8n-desk is not a workflow builder |
| Full plugin system | Cherry-pick instead of registering the entire design system |
| `@tanstack/vue-table` | No complex table needs |
| Storybook configuration | n8n-desk will have its own dev tooling |

---

## Recommended Integration Strategy

| Layer | Source | Rationale |
|---|---|---|
| Design tokens (colors, spacing, type) | **Copy** SCSS variables | Visual consistency with n8n ecosystem |
| Chat UI | **Fork** AskAssistant components | Already solves the core UX problem |
| Markdown rendering | **Reuse** N8nMarkdown + markdown util | Agent responses need rich rendering |
| Input sanitization | **Reuse** v-n8n-html directive | Security for rendered content |
| Utility functions | **Copy** cn(), uid(), markdown() | Small, dependency-free helpers |
| Form/settings screens | **Use Ionic** components | Platform-adaptive forms |
| Layout/navigation | **Use Ionic** components | Adaptive nav (tabs mobile, sidebar desktop) |

### Integration Approach

```
n8n-desk (Ionic Vue)
  ├── /src/theme/n8n-tokens.scss     ← Copied design tokens
  ├── /src/components/chat/          ← Forked AskAssistant components, adapted for Ionic
  ├── /src/utils/markdown.ts         ← Copied markdown utility
  ├── /src/utils/cn.ts               ← Copied class name helper
  ├── /src/directives/n8n-html.ts    ← Copied sanitization directive
  └── /src/components/ui/            ← Ionic components for everything else
```

---

## Source Code References

| Component | Location in n8n-master |
|---|---|
| Design system root | `packages/frontend/@n8n/design-system/` |
| All components | `packages/frontend/@n8n/design-system/src/components/` |
| V2 components (reka-ui) | `packages/frontend/@n8n/design-system/src/v2/` |
| CSS tokens & primitives | `packages/frontend/@n8n/design-system/src/css/` |
| Utilities | `packages/frontend/@n8n/design-system/src/utils/` |
| Directives | `packages/frontend/@n8n/design-system/src/directives/` |
| Composables | `packages/frontend/@n8n/design-system/src/composables/` |
| Type definitions | `packages/frontend/@n8n/design-system/src/types/` |
| AskAssistant components | `packages/frontend/@n8n/design-system/src/components/AskAssistant*/` |
| Chat-Hub utility package | `packages/@n8n/chat-hub/src/` |
| Chat-Hub message parser | `packages/@n8n/chat-hub/src/parser.ts` |
| Chat-Hub artifact collector | `packages/@n8n/chat-hub/src/artifact.ts` |
