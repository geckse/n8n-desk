import { describe, it, expect, beforeAll } from 'vitest'
import { mount } from '@vue/test-utils'
import WorkflowEmbed from '@/components/workflow/WorkflowEmbed.vue'

// Polyfill IntersectionObserver for jsdom
beforeAll(() => {
  globalThis.IntersectionObserver = class IntersectionObserver {
    constructor(private cb: IntersectionObserverCallback) {}
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
  } as unknown as typeof globalThis.IntersectionObserver
})

const stubs = {
  IonCard: { template: '<div class="ion-card"><slot /></div>' },
  IonCardHeader: { template: '<div><slot /></div>' },
  IonCardTitle: { template: '<div class="card-title"><slot /></div>' },
  IonCardContent: { template: '<div class="card-content"><slot /></div>' },
  'n8n-demo': { template: '<div class="n8n-demo" />', props: ['workflow', 'theme', 'tidyup', 'disableinteractivity', 'clicktointeract', 'frame', 'collapseformobile', 'mode'] },
}

const sampleWorkflow = {
  nodes: [
    { name: 'Start', type: 'n8n-nodes-base.start' },
    { name: 'HTTP', type: 'n8n-nodes-base.httpRequest' },
  ],
  connections: {},
  name: 'My Workflow',
}

describe('WorkflowEmbed', () => {
  it('renders placeholder initially (not visible)', () => {
    const wrapper = mount(WorkflowEmbed, {
      props: { workflow: sampleWorkflow },
      global: { stubs },
    })
    // Before IntersectionObserver fires, shows placeholder
    expect(wrapper.find('.ion-card').exists()).toBe(true)
    expect(wrapper.text()).toContain('Start') // first node name
    expect(wrapper.text()).toContain('2 nodes')
  })

  it('shows node count correctly for single node', () => {
    const wrapper = mount(WorkflowEmbed, {
      props: { workflow: { nodes: [{ name: 'Solo' }], connections: {}, name: 'W' } },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('1 node')
    expect(wrapper.text()).not.toContain('1 nodes')
  })

  it('applies compact class when compact prop is true', () => {
    const wrapper = mount(WorkflowEmbed, {
      props: { workflow: sampleWorkflow, compact: true },
      global: { stubs },
    })
    const container = wrapper.find('[class*="container"]')
    expect(container.exists()).toBe(true)
    // The compact class should be applied
    const classes = container.classes()
    expect(classes.some((c) => c.includes('compact'))).toBe(true)
  })

  it('does not apply compact class by default', () => {
    const wrapper = mount(WorkflowEmbed, {
      props: { workflow: sampleWorkflow },
      global: { stubs },
    })
    const container = wrapper.find('[class*="container"]')
    const classes = container.classes()
    expect(classes.some((c) => c.includes('compact'))).toBe(false)
  })

  it('emits click when compact and clicked', async () => {
    const wrapper = mount(WorkflowEmbed, {
      props: { workflow: sampleWorkflow, compact: true },
      global: { stubs },
    })
    const container = wrapper.find('[class*="container"]')
    await container.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('does not emit click when not compact', async () => {
    const wrapper = mount(WorkflowEmbed, {
      props: { workflow: sampleWorkflow },
      global: { stubs },
    })
    const container = wrapper.find('[class*="container"]')
    await container.trigger('click')
    expect(wrapper.emitted('click')).toBeUndefined()
  })
})
