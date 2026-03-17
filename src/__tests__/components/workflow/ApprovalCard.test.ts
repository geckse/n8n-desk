import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ApprovalCard from '@/components/workflow/ApprovalCard.vue'

const stubs = {
  IonButton: { template: '<button><slot /></button>' },
  IonIcon: { template: '<span class="ion-icon" />' },
  WorkflowEmbed: { template: '<div class="workflow-embed" />' },
}

const baseApproval = {
  id: 'appr_1',
  toolName: 'publish_workflow',
  description: 'This will activate the workflow',
}

describe('ApprovalCard', () => {
  it('renders approval title and description', () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('Approval Required')
    expect(wrapper.text()).toContain('This will activate the workflow')
    expect(wrapper.text()).toContain('Publish Workflow')
  })

  it('emits approve with id', async () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval },
      global: { stubs },
    })
    const buttons = wrapper.findAll('button')
    const approveBtn = buttons.find((b) => b.text().includes('Approve'))
    await approveBtn!.trigger('click')
    expect(wrapper.emitted('approve')).toEqual([['appr_1']])
  })

  it('emits reject with id', async () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval },
      global: { stubs },
    })
    const buttons = wrapper.findAll('button')
    const rejectBtn = buttons.find((b) => b.text().includes('Reject'))
    await rejectBtn!.trigger('click')
    expect(wrapper.emitted('reject')).toEqual([['appr_1']])
  })

  it('renders workflow preview when provided', () => {
    const wrapper = mount(ApprovalCard, {
      props: {
        approval: {
          ...baseApproval,
          workflowPreview: { nodes: [], connections: {}, name: 'Test' },
        },
      },
      global: { stubs },
    })
    expect(wrapper.find('.workflow-embed').exists()).toBe(true)
  })

  it('does not render workflow preview when not provided', () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval },
      global: { stubs },
    })
    expect(wrapper.find('.workflow-embed').exists()).toBe(false)
  })
})
