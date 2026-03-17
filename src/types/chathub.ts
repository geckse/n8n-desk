/**
 * Chat-Hub type definitions mirroring n8n's API types.
 * No Zod dependency — pure TypeScript types and interfaces.
 *
 * Source: n8n-master/packages/@n8n/api-types/src/chat-hub.ts
 *         n8n-master/packages/@n8n/api-types/src/push/chat-hub.ts
 */

// ---------------------------------------------------------------------------
// LLM Providers
// ---------------------------------------------------------------------------

export const CHAT_HUB_LLM_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'azureOpenAi',
  'azureEntraId',
  'ollama',
  'awsBedrock',
  'vercelAiGateway',
  'xAiGrok',
  'groq',
  'openRouter',
  'deepSeek',
  'cohere',
  'mistralCloud',
] as const;

export type ChatHubLLMProvider = (typeof CHAT_HUB_LLM_PROVIDERS)[number];

export const CHAT_HUB_VECTOR_STORE_PROVIDERS = ['pgvector', 'qdrant', 'pinecone'] as const;
export type ChatHubVectorStoreProvider = (typeof CHAT_HUB_VECTOR_STORE_PROVIDERS)[number];

export const CHAT_HUB_PROVIDERS = [...CHAT_HUB_LLM_PROVIDERS, 'n8n', 'custom-agent'] as const;
export type ChatHubProvider = (typeof CHAT_HUB_PROVIDERS)[number];

export type ChatHubSessionType = 'production' | 'manual';

// ---------------------------------------------------------------------------
// Agent Icon / Emoji
// ---------------------------------------------------------------------------

export type AgentIconOrEmoji =
  | { type: 'icon'; value: string }
  | { type: 'emoji'; value: string };

// ---------------------------------------------------------------------------
// Conversation Models (discriminated union on `provider`)
// ---------------------------------------------------------------------------

interface LLMModelBase<P extends ChatHubLLMProvider> {
  provider: P;
  model: string;
}

export type ChatHubOpenAIModel = LLMModelBase<'openai'>;
export type ChatHubAnthropicModel = LLMModelBase<'anthropic'>;
export type ChatHubGoogleModel = LLMModelBase<'google'>;
export type ChatHubAzureOpenAIModel = LLMModelBase<'azureOpenAi'>;
export type ChatHubAzureEntraIdModel = LLMModelBase<'azureEntraId'>;
export type ChatHubOllamaModel = LLMModelBase<'ollama'>;
export type ChatHubAwsBedrockModel = LLMModelBase<'awsBedrock'>;
export type ChatHubVercelAiGatewayModel = LLMModelBase<'vercelAiGateway'>;
export type ChatHubXAiGrokModel = LLMModelBase<'xAiGrok'>;
export type ChatHubGroqModel = LLMModelBase<'groq'>;
export type ChatHubOpenRouterModel = LLMModelBase<'openRouter'>;
export type ChatHubDeepSeekModel = LLMModelBase<'deepSeek'>;
export type ChatHubCohereModel = LLMModelBase<'cohere'>;
export type ChatHubMistralCloudModel = LLMModelBase<'mistralCloud'>;

export type ChatHubBaseLLMModel =
  | ChatHubOpenAIModel
  | ChatHubAnthropicModel
  | ChatHubGoogleModel
  | ChatHubAzureOpenAIModel
  | ChatHubAzureEntraIdModel
  | ChatHubOllamaModel
  | ChatHubAwsBedrockModel
  | ChatHubVercelAiGatewayModel
  | ChatHubXAiGrokModel
  | ChatHubGroqModel
  | ChatHubOpenRouterModel
  | ChatHubDeepSeekModel
  | ChatHubCohereModel
  | ChatHubMistralCloudModel;

export interface ChatHubN8nModel {
  provider: 'n8n';
  workflowId: string;
}

export interface ChatHubCustomAgentModel {
  provider: 'custom-agent';
  agentId: string;
}

export type ChatHubConversationModel =
  | ChatHubBaseLLMModel
  | ChatHubN8nModel
  | ChatHubCustomAgentModel;

// ---------------------------------------------------------------------------
// Provider Credential Map
// ---------------------------------------------------------------------------

export const PROVIDER_CREDENTIAL_TYPE_MAP: Record<ChatHubLLMProvider, string> = {
  openai: 'openAiApi',
  anthropic: 'anthropicApi',
  google: 'googlePalmApi',
  ollama: 'ollamaApi',
  azureOpenAi: 'azureOpenAiApi',
  azureEntraId: 'azureEntraCognitiveServicesOAuth2Api',
  awsBedrock: 'aws',
  vercelAiGateway: 'vercelAiGatewayApi',
  xAiGrok: 'xAiApi',
  groq: 'groqApi',
  openRouter: 'openRouterApi',
  deepSeek: 'deepSeekApi',
  cohere: 'cohereApi',
  mistralCloud: 'mistralCloudApi',
};

// ---------------------------------------------------------------------------
// Chat Models DTO
// ---------------------------------------------------------------------------

export interface ChatModelMetadataDto {
  allowFileUploads: boolean;
  allowedFilesMimeTypes: string;
  priority?: number;
  capabilities: {
    functionCalling: boolean;
  };
  available: boolean;
  scopes?: string[];
}

export interface ChatModelDto {
  model: ChatHubConversationModel;
  name: string;
  description: string | null;
  icon: AgentIconOrEmoji | null;
  updatedAt: string | null;
  createdAt: string | null;
  metadata: ChatModelMetadataDto;
  groupName: string | null;
  groupIcon: AgentIconOrEmoji | null;
  suggestedPrompts?: Array<{ text: string; icon?: AgentIconOrEmoji }>;
}

export type ChatModelsResponse = Record<
  ChatHubProvider,
  {
    models: ChatModelDto[];
    error?: string;
  }
>;

// ---------------------------------------------------------------------------
// Suggested Prompts
// ---------------------------------------------------------------------------

export interface SuggestedPrompt {
  text: string;
  icon?: AgentIconOrEmoji;
}

// ---------------------------------------------------------------------------
// Agent Knowledge
// ---------------------------------------------------------------------------

export interface ChatHubAgentKnowledgeItem {
  id: string;
  type: 'embedding';
  provider: ChatHubLLMProvider;
  fileName: string;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// Agent DTO
// ---------------------------------------------------------------------------

export interface ChatHubAgentDto {
  id: string;
  name: string;
  description: string | null;
  icon: AgentIconOrEmoji | null;
  suggestedPrompts: SuggestedPrompt[];
  systemPrompt: string;
  ownerId: string;
  credentialId: string | null;
  provider: ChatHubLLMProvider;
  model: string;
  files: ChatHubAgentKnowledgeItem[];
  toolIds: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Session & Message DTOs
// ---------------------------------------------------------------------------

export type ChatSessionId = string;
export type ChatMessageId = string;

export interface ChatHubSessionDto {
  id: ChatSessionId;
  title: string;
  ownerId: string;
  lastMessageAt: string | null;
  credentialId: string | null;
  provider: ChatHubProvider | null;
  model: string | null;
  workflowId: string | null;
  agentId: string | null;
  agentName: string;
  agentIcon: AgentIconOrEmoji | null;
  type: ChatHubSessionType;
  createdAt: string;
  updatedAt: string;
  toolIds: string[];
}

export type ChatHubMessageType = 'human' | 'ai' | 'system' | 'tool' | 'generic';
export type ChatHubMessageStatus = 'success' | 'error' | 'running' | 'cancelled' | 'waiting';

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export interface ChatArtifact {
  title: string;
  type: string;
  content: string;
}

export interface ChatArtifactCreateCommand {
  title: string;
  type: string;
  content: string;
}

export interface ChatArtifactEditCommand {
  title: string;
  oldString: string;
  newString: string;
  replaceAll: boolean;
}

// ---------------------------------------------------------------------------
// Message Buttons
// ---------------------------------------------------------------------------

export interface ChatHubMessageButton {
  text: string;
  link: string;
  type: 'primary' | 'secondary';
}

// ---------------------------------------------------------------------------
// Message Content Chunks
// ---------------------------------------------------------------------------

export type ChatMessageContentChunk =
  | { type: 'text'; content: string }
  | { type: 'hidden'; content: string }
  | {
      type: 'artifact-create';
      content: string;
      command: ChatArtifactCreateCommand;
      isIncomplete: boolean;
    }
  | {
      type: 'artifact-edit';
      content: string;
      command: ChatArtifactEditCommand;
      isIncomplete: boolean;
    }
  | {
      type: 'with-buttons';
      content: string;
      buttons: ChatHubMessageButton[];
      blockUserInput: boolean;
    };

// ---------------------------------------------------------------------------
// Message DTO
// ---------------------------------------------------------------------------

export interface ChatHubMessageDto {
  id: ChatMessageId;
  sessionId: ChatSessionId;
  type: ChatHubMessageType;
  name: string;
  content: ChatMessageContentChunk[];
  provider: ChatHubProvider | null;
  model: string | null;
  workflowId: string | null;
  agentId: string | null;
  executionId: number | null;
  status: ChatHubMessageStatus;
  createdAt: string;
  updatedAt: string;
  previousMessageId: ChatMessageId | null;
  retryOfMessageId: ChatMessageId | null;
  revisionOfMessageId: ChatMessageId | null;
  attachments: Array<{ fileName?: string; mimeType?: string }>;
}

// ---------------------------------------------------------------------------
// Conversation list / detail responses
// ---------------------------------------------------------------------------

export interface ChatHubConversationsResponse {
  data: ChatHubSessionDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ChatHubConversationDto {
  messages: Record<ChatMessageId, ChatHubMessageDto>;
}

export interface ChatHubConversationResponse {
  session: ChatHubSessionDto;
  conversation: ChatHubConversationDto;
}

// ---------------------------------------------------------------------------
// Send message response
// ---------------------------------------------------------------------------

export interface ChatSendMessageResponse {
  status: 'streaming';
}

// ---------------------------------------------------------------------------
// Reconnect
// ---------------------------------------------------------------------------

export interface ChatReconnectResponse {
  hasActiveStream: boolean;
  currentMessageId: ChatMessageId | null;
  pendingChunks: Array<{
    sequenceNumber: number;
    content: string;
  }>;
  lastSequenceNumber: number;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export interface ChatAttachment {
  data: string;
  mimeType: string;
  fileName: string;
}

// ---------------------------------------------------------------------------
// Chat-Hub Push Event Types
// ---------------------------------------------------------------------------

/**
 * Base metadata included in all chat stream push messages
 */
export interface ChatHubStreamMetadata {
  sessionId: ChatSessionId;
  messageId: ChatMessageId;
  sequenceNumber: number;
  timestamp: number;
}

export interface ChatHubAttachmentInfo {
  id: string;
  fileName: string;
  mimeType: string;
}

/**
 * Sent when a new AI response begins streaming
 */
export interface ChatHubStreamBegin {
  type: 'chatHubStreamBegin';
  data: ChatHubStreamMetadata & {
    previousMessageId: ChatMessageId | null;
    retryOfMessageId: ChatMessageId | null;
    executionId: number | null;
  };
}

/**
 * Sent for each chunk of content during streaming
 */
export interface ChatHubStreamChunk {
  type: 'chatHubStreamChunk';
  data: ChatHubStreamMetadata & {
    content: string;
  };
}

/**
 * Sent when streaming completes successfully
 */
export interface ChatHubStreamEnd {
  type: 'chatHubStreamEnd';
  data: ChatHubStreamMetadata & {
    status: ChatHubMessageStatus;
  };
}

/**
 * Sent when an error occurs during streaming
 */
export interface ChatHubStreamError {
  type: 'chatHubStreamError';
  data: ChatHubStreamMetadata & {
    error: string;
  };
}

/**
 * Sent when a human message is created (for cross-client sync)
 */
export interface ChatHubHumanMessageCreated {
  type: 'chatHubHumanMessageCreated';
  data: {
    sessionId: ChatSessionId;
    messageId: ChatMessageId;
    previousMessageId: ChatMessageId | null;
    content: string;
    attachments: ChatHubAttachmentInfo[];
    timestamp: number;
  };
}

/**
 * Sent when a message is edited (for cross-client sync)
 */
export interface ChatHubMessageEdited {
  type: 'chatHubMessageEdited';
  data: {
    sessionId: ChatSessionId;
    revisionOfMessageId: ChatMessageId;
    messageId: ChatMessageId;
    content: string;
    attachments: ChatHubAttachmentInfo[];
    timestamp: number;
  };
}

/**
 * Sent when a chat execution begins
 */
export interface ChatHubExecutionBegin {
  type: 'chatHubExecutionBegin';
  data: {
    sessionId: ChatSessionId;
    timestamp: number;
  };
}

/**
 * Sent when a chat execution ends
 */
export interface ChatHubExecutionEnd {
  type: 'chatHubExecutionEnd';
  data: {
    sessionId: ChatSessionId;
    status: ChatHubMessageStatus;
    timestamp: number;
  };
}

// ---------------------------------------------------------------------------
// Push Event Union Types
// ---------------------------------------------------------------------------

export type ChatHubStreamEvent =
  | ChatHubStreamBegin
  | ChatHubStreamChunk
  | ChatHubStreamEnd
  | ChatHubStreamError;

export type ChatHubExecutionEvent = ChatHubExecutionBegin | ChatHubExecutionEnd;

export type ChatHubPushMessage =
  | ChatHubStreamEvent
  | ChatHubExecutionEvent
  | ChatHubHumanMessageCreated
  | ChatHubMessageEdited;

// ---------------------------------------------------------------------------
// Provider Settings
// ---------------------------------------------------------------------------

export interface ChatProviderSettingsDto {
  provider: ChatHubLLMProvider;
  enabled?: boolean;
  credentialId: string | null;
  allowedModels: Array<{
    displayName: string;
    model: string;
    isManual?: boolean;
  }>;
  createdAt: string;
  updatedAt: string | null;
}

export interface ChatHubModuleSettings {
  enabled: boolean;
  providers: Record<ChatHubLLMProvider, ChatProviderSettingsDto>;
}
