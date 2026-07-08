import { defineStore } from 'pinia'
import { createAgentSessionsStore } from './agent-sessions'
import { i18n } from '@/i18n'

/**
 * Workflow-mode sessions. All session/event logic lives in the shared
 * agent-sessions factory — the Cowork and Workflow stores are the same
 * implementation scoped to different session directories.
 */
export const useWorkflowSessionsStore = defineStore(
  'workflow-sessions',
  createAgentSessionsStore('workflow', () => i18n.global.t('workflow.sessions.new')),
)
