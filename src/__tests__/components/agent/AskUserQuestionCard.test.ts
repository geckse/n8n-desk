import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AskUserQuestionCard from '@/components/agent/AskUserQuestionCard.vue'

const stubs = {
  IonButton: {
    props: ['disabled'],
    template: '<button class="ion-button" :disabled="disabled"><slot /></button>',
  },
  IonInput: {
    props: ['value'],
    emits: ['ionInput'],
    template: '<input class="other-input" :value="value" @input="$emit(\'ionInput\', { detail: { value: $event.target.value } })" />',
  },
  IonRadioGroup: { template: '<div class="radio-group"><slot /></div>' },
  IonRadio: { template: '<span class="radio" />' },
  IonCheckbox: { template: '<span class="checkbox" />' },
}

const singleSelectRequest = {
  id: 'toolu_q1',
  questions: [
    {
      id: 'q1',
      question: 'Which format?',
      options: [{ label: 'CSV' }, { label: 'JSON', description: 'structured output' }],
    },
  ],
}

const multiSelectRequest = {
  id: 'toolu_q2',
  questions: [
    {
      id: 'q1',
      question: 'Which sources?',
      options: [{ label: 'Gmail' }, { label: 'Slack' }],
      multiSelect: true,
    },
  ],
}

const twoStepRequest = {
  id: 'toolu_q3',
  questions: [
    { id: 'q1', question: 'A?', options: [{ label: 'x' }] },
    { id: 'q2', question: 'B?', options: [{ label: 'y' }, { label: 'z' }] },
  ],
}

function optionRows(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[role="radio"], [role="checkbox"]')
}

function stepTabs(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[role="tab"]')
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button.ion-button').find((b) => b.text().includes(text))
}

describe('AskUserQuestionCard', () => {
  it('renders the question, options, and descriptions', () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { request: singleSelectRequest },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('Which format?')
    expect(wrapper.text()).toContain('CSV')
    expect(wrapper.text()).toContain('JSON')
    expect(wrapper.text()).toContain('structured output')
    // Single-select renders radios, always plus an Other input
    expect(wrapper.findAll('.radio')).toHaveLength(2)
    expect(wrapper.find('.other-input').exists()).toBe(true)
  })

  it('renders checkboxes for multiSelect questions', () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { request: multiSelectRequest },
      global: { stubs },
    })
    expect(wrapper.findAll('.checkbox')).toHaveLength(2)
    expect(wrapper.findAll('.radio')).toHaveLength(0)
  })

  it('hides step tabs and navigation for a single question', () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { request: singleSelectRequest },
      global: { stubs },
    })
    expect(stepTabs(wrapper)).toHaveLength(0)
    expect(buttonByText(wrapper, 'Back')).toBeUndefined()
    expect(buttonByText(wrapper, 'Next')).toBeUndefined()
    expect(buttonByText(wrapper, 'Send answers')).toBeDefined()
  })

  it('shows ONE question per step with tabs and a step counter', () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { request: twoStepRequest },
      global: { stubs },
    })
    expect(stepTabs(wrapper)).toHaveLength(2)
    expect(wrapper.text()).toContain('1 of 2')
    // Only the first question is rendered
    expect(wrapper.text()).toContain('A?')
    expect(wrapper.text()).not.toContain('B?')
    // Not the last step → Next, no submit
    expect(buttonByText(wrapper, 'Next')).toBeDefined()
    expect(buttonByText(wrapper, 'Send answers')).toBeUndefined()
  })

  it('jumps between questions via the step tabs', async () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { request: twoStepRequest },
      global: { stubs },
    })
    await stepTabs(wrapper)[1].trigger('click')
    expect(wrapper.text()).toContain('B?')
    expect(wrapper.text()).not.toContain('A?')
    expect(wrapper.text()).toContain('2 of 2')

    await stepTabs(wrapper)[0].trigger('click')
    expect(wrapper.text()).toContain('A?')
  })

  it('navigates with Next and Back, keeping answers per step', async () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { request: twoStepRequest },
      global: { stubs },
    })
    // Back is disabled on the first step
    expect(buttonByText(wrapper, 'Back')!.attributes('disabled')).toBeDefined()

    await optionRows(wrapper)[0].trigger('click') // answer A? with x
    await buttonByText(wrapper, 'Next')!.trigger('click')
    expect(wrapper.text()).toContain('B?')

    await buttonByText(wrapper, 'Back')!.trigger('click')
    // The answer on step 1 is still selected
    expect(optionRows(wrapper)[0].attributes('aria-checked')).toBe('true')
  })

  it('marks answered steps in the tab row', async () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { request: twoStepRequest },
      global: { stubs },
    })
    expect(stepTabs(wrapper)[0].text()).toBe('1')

    await optionRows(wrapper)[0].trigger('click')
    // Answered tab shows the check icon instead of the number
    expect(stepTabs(wrapper)[0].text()).toBe('')
    expect(stepTabs(wrapper)[0].find('svg').exists()).toBe(true)
    expect(stepTabs(wrapper)[1].text()).toBe('2')
  })

  it('disables submit until every question has an answer', async () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { request: twoStepRequest },
      global: { stubs },
    })
    await optionRows(wrapper)[0].trigger('click')
    await buttonByText(wrapper, 'Next')!.trigger('click')

    expect(buttonByText(wrapper, 'Send answers')!.attributes('disabled')).toBeDefined()

    await optionRows(wrapper)[0].trigger('click') // answer B? with y
    expect(buttonByText(wrapper, 'Send answers')!.attributes('disabled')).toBeUndefined()
  })

  it('emits submit with the answers from all steps', async () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { request: twoStepRequest },
      global: { stubs },
    })
    await optionRows(wrapper)[0].trigger('click')
    await buttonByText(wrapper, 'Next')!.trigger('click')
    await optionRows(wrapper)[1].trigger('click') // pick z on B?
    await buttonByText(wrapper, 'Send answers')!.trigger('click')

    expect(wrapper.emitted('submit')).toEqual([
      ['toolu_q3', { q1: { selected: ['x'] }, q2: { selected: ['z'] } }],
    ])
  })

  it('single-select replaces the selection; multi-select accumulates', async () => {
    const single = mount(AskUserQuestionCard, {
      props: { request: singleSelectRequest },
      global: { stubs },
    })
    await optionRows(single)[0].trigger('click')
    await optionRows(single)[1].trigger('click')
    await buttonByText(single, 'Send answers')!.trigger('click')
    expect(single.emitted('submit')).toEqual([
      ['toolu_q1', { q1: { selected: ['JSON'] } }],
    ])

    const multi = mount(AskUserQuestionCard, {
      props: { request: multiSelectRequest },
      global: { stubs },
    })
    await optionRows(multi)[0].trigger('click')
    await optionRows(multi)[1].trigger('click')
    await buttonByText(multi, 'Send answers')!.trigger('click')
    expect(multi.emitted('submit')).toEqual([
      ['toolu_q2', { q1: { selected: ['Gmail', 'Slack'] } }],
    ])
  })

  it('Other free text counts as an answer and is included in the payload', async () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { request: singleSelectRequest },
      global: { stubs },
    })
    await wrapper.find('.other-input').setValue('keep both formats')
    expect(buttonByText(wrapper, 'Send answers')!.attributes('disabled')).toBeUndefined()

    await buttonByText(wrapper, 'Send answers')!.trigger('click')
    expect(wrapper.emitted('submit')).toEqual([
      ['toolu_q1', { q1: { selected: [], otherText: 'keep both formats' } }],
    ])
  })

  it('typing Other deselects the radio on single-select', async () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { request: singleSelectRequest },
      global: { stubs },
    })
    await optionRows(wrapper)[0].trigger('click')
    await wrapper.find('.other-input').setValue('something custom')
    await buttonByText(wrapper, 'Send answers')!.trigger('click')

    expect(wrapper.emitted('submit')).toEqual([
      ['toolu_q1', { q1: { selected: [], otherText: 'something custom' } }],
    ])
  })

  it('Other adds to the selection on multi-select', async () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { request: multiSelectRequest },
      global: { stubs },
    })
    await optionRows(wrapper)[0].trigger('click')
    await wrapper.find('.other-input').setValue('the intranet wiki')
    await buttonByText(wrapper, 'Send answers')!.trigger('click')

    expect(wrapper.emitted('submit')).toEqual([
      ['toolu_q2', { q1: { selected: ['Gmail'], otherText: 'the intranet wiki' } }],
    ])
  })
})
