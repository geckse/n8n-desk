import { defineStore } from 'pinia'
import { createAgentSessionsStore } from './agent-sessions'
import { i18n } from '@/i18n'

/**
 * Cowork-mode sessions. All session/event logic lives in the shared
 * agent-sessions factory — the Cowork and Workflow stores are the same
 * implementation scoped to different session directories.
 */
export const useCoworkSessionsStore = defineStore(
  'cowork-sessions',
  createAgentSessionsStore('cowork', () => i18n.global.t('cowork.sessions.new')),
)
