import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolCallCard from '@/components/workflow/ToolCallCard.vue'
import type { AgentToolCall } from '@/types/agent'

// Stub child components
const stubs = {
  IonIcon: { template: '<span class="ion-icon" />' },
  IonSpinner: { template: '<span class="ion-spinner" />' },
  WorkflowEmbed: { template: '<div class="workflow-embed" />' },
}

function makeToolCall(overrides: Partial<AgentToolCall> = {}): AgentToolCall {
  return {
    id: 'tc_1',
    name: 'execute_workflow',
    args: { workflowId: '42' },
    status: 'completed',
    ...overrides,
  }
}

describe('ToolCallCard', () => {
  it('renders tool name formatted', () => {
    const wrapper = mount(ToolCallCard, {
      props: { toolCall: makeToolCall({ name: 'search_workflows' }) },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('Search Workflows')
  })

  it('shows spinner for running status', () => {
    const wrapper = mount(ToolCallCard, {
      props: { toolCall: makeToolCall({ status: 'running' }) },
      global: { stubs },
    })
    expect(wrapper.find('.ion-spinner').exists()).toBe(true)
  })

  it('shows spinner for pending status', () => {
    const wrapper = mount(ToolCallCard, {
      props: { toolCall: makeToolCall({ status: 'pending' }) },
      global: { stubs },
    })
    expect(wrapper.find('.ion-spinner').exists()).toBe(true)
  })

  it('shows icon for completed status (no spinner)', () => {
    const wrapper = mount(ToolCallCard, {
      props: { toolCall: makeToolCall({ status: 'completed' }) },
      global: { stubs },
    })
    expect(wrapper.find('.ion-spinner').exists()).toBe(false)
  })

  it('shows icon for failed status (no spinner)', () => {
    const wrapper = mount(ToolCallCard, {
      props: { toolCall: makeToolCall({ status: 'failed' }) },
      global: { stubs },
    })
    expect(wrapper.find('.ion-spinner').exists()).toBe(false)
  })

  it('expands and collapses on header click', async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: makeToolCall({
          args: { workflowId: '42' },
          result: 'some result',
        }),
      },
      global: { stubs },
    })

    // Initially collapsed - no "Arguments" text
    expect(wrapper.text()).not.toContain('Arguments')

    // Click header to expand
    const header = wrapper.find('[class*="header"]')
    await header.trigger('click')
    expect(wrapper.text()).toContain('Arguments')
    expect(wrapper.text()).toContain('Result')

    // Click again to collapse
    await header.trigger('click')
    expect(wrapper.text()).not.toContain('Arguments')
  })
})
