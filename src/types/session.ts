export interface SessionMeta {
  id: string
  title: string
  agentId?: string
  agentName?: string
  agentIcon?: { type: string; value: string } | null
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface ChatSessionMeta extends SessionMeta {
  serverSessionId?: string
  model?: string
  lastSequenceNumber?: number
  syncedAt?: string
}

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system' | 'thinking'
  content: string
  ts: string
  meta?: Record<string, unknown>
}
