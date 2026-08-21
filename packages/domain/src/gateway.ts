import type {
  ChatEvent,
  ChatRequest,
  GenerationBatch,
  ImageRequest,
  ProviderCapability,
  ProviderHealth,
  Quota,
  RecreateRequest,
  Session,
  Skill,
  TimelineItem,
} from './types';

export interface WorkspaceGateway {
  listSessions(): Promise<Session[]>;
  createSession(title?: string): Promise<Session>;
  renameSession(sessionId: string, title: string): Promise<Session>;
  deleteSession(sessionId: string): Promise<void>;
  getTimeline(sessionId: string): Promise<TimelineItem[]>;
  streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent>;
  submitImage(request: ImageRequest): Promise<GenerationBatch>;
  getGenerationBatch(batchId: string): Promise<GenerationBatch>;
  recreateGeneration(request: RecreateRequest): Promise<GenerationBatch>;
  getSkills(): Promise<Skill[]>;
  getQuota(): Promise<Quota>;
  getProviderCapabilities(): Promise<ProviderCapability[]>;
  getProviderHealth(): Promise<ProviderHealth[]>;
}
