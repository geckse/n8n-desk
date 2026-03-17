import type { Directive } from 'vue'
import { sanitizeHtml } from '@/utils/sanitize'

export const n8nHtml: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    el.innerHTML = sanitizeHtml(binding.value ?? '')
  },
  updated(el, binding) {
    if (binding.value !== binding.oldValue) {
      el.innerHTML = sanitizeHtml(binding.value ?? '')
    }
  },
}
