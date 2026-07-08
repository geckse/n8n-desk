import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatInput from '@/components/chat/ChatInput.vue'

describe('ChatInput', () => {
  // ---------------------------------------------------------------------------
  // Send behavior
  // ---------------------------------------------------------------------------
  describe('send', () => {
    it('emits send with trimmed text on button click', async () => {
      const wrapper = mount(ChatInput)
      const textarea = wrapper.find('textarea')
      await textarea.setValue('  Hello  ')
      await wrapper.find('button[aria-label="Send"]').trigger('click')

      expect(wrapper.emitted('send')).toEqual([['Hello', [], []]])
    })

    it('emits send on Enter key', async () => {
      const wrapper = mount(ChatInput)
      const textarea = wrapper.find('textarea')
      await textarea.setValue('Test message')
      await textarea.trigger('keydown', { key: 'Enter', shiftKey: false })

      expect(wrapper.emitted('send')).toEqual([['Test message', [], []]])
    })

    it('does not emit send on Shift+Enter', async () => {
      const wrapper = mount(ChatInput)
      const textarea = wrapper.find('textarea')
      await textarea.setValue('Test')
      await textarea.trigger('keydown', { key: 'Enter', shiftKey: true })

      expect(wrapper.emitted('send')).toBeUndefined()
    })

    it('does not emit send when message is empty', async () => {
      const wrapper = mount(ChatInput)
      await wrapper.find('button[aria-label="Send"]').trigger('click')

      expect(wrapper.emitted('send')).toBeUndefined()
    })

    it('clears textarea after sending', async () => {
      const wrapper = mount(ChatInput)
      const textarea = wrapper.find('textarea')
      await textarea.setValue('Hello')
      await wrapper.find('button[aria-label="Send"]').trigger('click')

      expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
    })
  })

  // ---------------------------------------------------------------------------
  // Stop behavior
  // ---------------------------------------------------------------------------
  describe('stop', () => {
    it('shows stop button when streaming', () => {
      const wrapper = mount(ChatInput, { props: { isStreaming: true } })
      expect(wrapper.find('button[aria-label="Stop generating"]').exists()).toBe(true)
      expect(wrapper.find('button[aria-label="Send"]').exists()).toBe(false)
    })

    it('emits stop on click', async () => {
      const wrapper = mount(ChatInput, { props: { isStreaming: true } })
      await wrapper.find('button[aria-label="Stop generating"]').trigger('click')

      expect(wrapper.emitted('stop')).toHaveLength(1)
    })

    it('shows send button when not streaming', () => {
      const wrapper = mount(ChatInput, { props: { isStreaming: false } })
      expect(wrapper.find('button[aria-label="Send"]').exists()).toBe(true)
      expect(wrapper.find('button[aria-label="Stop generating"]').exists()).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Disabled states
  // ---------------------------------------------------------------------------
  describe('disabled states', () => {
    it('disables textarea when offline', () => {
      const wrapper = mount(ChatInput, { props: { isOffline: true } })
      expect((wrapper.find('textarea').element as HTMLTextAreaElement).disabled).toBe(true)
    })

    it('shows offline placeholder when offline', () => {
      const wrapper = mount(ChatInput, { props: { isOffline: true } })
      expect((wrapper.find('textarea').element as HTMLTextAreaElement).placeholder).toBe('Reconnect to continue…')
    })

    it('disables textarea when disabled prop is set', () => {
      const wrapper = mount(ChatInput, { props: { disabled: true } })
      expect((wrapper.find('textarea').element as HTMLTextAreaElement).disabled).toBe(true)
    })

    it('disables send button when offline', async () => {
      const wrapper = mount(ChatInput, { props: { isOffline: true } })
      const textarea = wrapper.find('textarea')
      await textarea.setValue('Hello')
      const sendBtn = wrapper.find('button[aria-label="Send"]')
      expect((sendBtn.element as HTMLButtonElement).disabled).toBe(true)
    })

    it('disables send button when message is empty', () => {
      const wrapper = mount(ChatInput)
      const sendBtn = wrapper.find('button[aria-label="Send"]')
      expect((sendBtn.element as HTMLButtonElement).disabled).toBe(true)
    })

    it('shows default placeholder when online', () => {
      const wrapper = mount(ChatInput)
      expect((wrapper.find('textarea').element as HTMLTextAreaElement).placeholder).toBe('Type a message…')
    })
  })
})
