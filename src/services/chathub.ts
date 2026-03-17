import { N8nApiClient } from '@/services/n8n-api'
import type {
  ChatModelsResponse,
  ChatHubConversationsResponse,
  ChatHubConversationResponse,
  ChatSendMessageResponse,
  ChatReconnectResponse,
  ChatHubSessionDto,
  ChatSessionId,
  ChatMessageId,
  ChatHubConversationModel,
  ChatAttachment,
} from '@/types/chathub'

/**
 * Chat-Hub REST API service.
 * All calls route through N8nApiClient (which uses cookie auth for /chat/* endpoints).
 */
export class ChatHubService {
  constructor(private readonly api: N8nApiClient) {}

  /** Fetch available chat models and agents. */
  async getModels(): Promise<ChatModelsResponse> {
    return this.api.get<ChatModelsResponse>('/chat/models')
  }

  /** List conversation sessions with cursor-based pagination. */
  async listSessions(params?: {
    cursor?: string
    limit?: number
  }): Promise<ChatHubConversationsResponse> {
    const query = new URLSearchParams()
    if (params?.cursor) query.set('cursor', params.cursor)
    if (params?.limit) query.set('limit', String(params.limit))
    const qs = query.toString()
    return this.api.get<ChatHubConversationsResponse>(
      `/chat/conversations${qs ? `?${qs}` : ''}`,
    )
  }

  /** Get a single conversation with all messages. */
  async getSession(sessionId: ChatSessionId): Promise<ChatHubConversationResponse> {
    return this.api.get<ChatHubConversationResponse>(
      `/chat/conversations/${encodeURIComponent(sessionId)}`,
    )
  }

  /** Send a new message in a conversation (creates session if needed). */
  async sendMessage(params: {
    sessionId: ChatSessionId
    message: string
    model: ChatHubConversationModel
    previousMessageId?: ChatMessageId
    attachments?: ChatAttachment[]
  }): Promise<ChatSendMessageResponse> {
    return this.api.post<ChatSendMessageResponse>(
      `/chat/conversations/${encodeURIComponent(params.sessionId)}/send`,
      {
        message: params.message,
        model: params.model,
        previousMessageId: params.previousMessageId ?? null,
        attachments: params.attachments ?? [],
      },
    )
  }

  /** Edit a previously sent user message and regenerate the response. */
  async editMessage(params: {
    sessionId: ChatSessionId
    messageId: ChatMessageId
    message: string
    model: ChatHubConversationModel
    attachments?: ChatAttachment[]
  }): Promise<ChatSendMessageResponse> {
    return this.api.post<ChatSendMessageResponse>(
      `/chat/conversations/${encodeURIComponent(params.sessionId)}/edit`,
      {
        messageId: params.messageId,
        message: params.message,
        model: params.model,
        attachments: params.attachments ?? [],
      },
    )
  }

  /** Regenerate an AI response from a specific message. */
  async regenerateMessage(params: {
    sessionId: ChatSessionId
    messageId: ChatMessageId
    model: ChatHubConversationModel
  }): Promise<ChatSendMessageResponse> {
    return this.api.post<ChatSendMessageResponse>(
      `/chat/conversations/${encodeURIComponent(params.sessionId)}/regenerate`,
      {
        messageId: params.messageId,
        model: params.model,
      },
    )
  }

  /** Stop an in-progress AI generation. */
  async stopGeneration(sessionId: ChatSessionId): Promise<void> {
    await this.api.post(
      `/chat/conversations/${encodeURIComponent(sessionId)}/stop`,
    )
  }

  /** Update session metadata (e.g. title). */
  async updateSession(
    sessionId: ChatSessionId,
    updates: Partial<Pick<ChatHubSessionDto, 'title'>>,
  ): Promise<ChatHubSessionDto> {
    return this.api.patch<ChatHubSessionDto>(
      `/chat/conversations/${encodeURIComponent(sessionId)}`,
      updates,
    )
  }

  /** Delete a conversation session. */
  async deleteSession(sessionId: ChatSessionId): Promise<void> {
    await this.api.delete(
      `/chat/conversations/${encodeURIComponent(sessionId)}`,
    )
  }

  /** Reconnect to an active stream after a WebSocket disconnect. */
  async reconnect(sessionId: ChatSessionId): Promise<ChatReconnectResponse> {
    return this.api.post<ChatReconnectResponse>(
      `/chat/conversations/${encodeURIComponent(sessionId)}/reconnect`,
    )
  }
}
