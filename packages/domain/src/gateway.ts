import type {
  CreditQuote,
  CreditItem,
  CreditCatalog,
  CreditWallet,
  CreditLedger,
  CreativeTextOptimizeRequest,
  CreativeTextOptimizeResponse,
} from "./index";
import type { CommerceGateway } from "./commerce";
import type { SkillTask } from "./skill-contracts";
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
  getCreditQuote?(items: CreditItem[]): Promise<CreditQuote>;
  getCreditCatalog?(): Promise<CreditCatalog>;
  getCreditWallet?(): Promise<CreditWallet>;
  getCreditLedger?(cursor?: string): Promise<CreditLedger>;
  optimizeText?(
    input: CreativeTextOptimizeRequest,
  ): Promise<CreativeTextOptimizeResponse>;

  readonly commerce?: CommerceGateway;
  getActiveTasks?(sessionId: string): Promise<SkillTask[]>;
  cancelTask?(
    task: SkillTask,
    action?: "cancel" | "replace",
  ): Promise<SkillTask>;

  listSessions(): Promise<Session[]>;
  createSession(title?: string): Promise<Session>;
  renameSession(sessionId: string, title: string): Promise<Session>;
  deleteSession(sessionId: string): Promise<void>;
  getTimeline(sessionId: string): Promise<TimelineItem[]>;
  streamChat(
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ChatEvent>;
  submitImage(request: ImageRequest): Promise<GenerationBatch>;
  getGenerationBatch(batchId: string): Promise<GenerationBatch>;
  recreateGeneration(request: RecreateRequest): Promise<GenerationBatch>;
  getSkills(): Promise<Skill[]>;
  getQuota(): Promise<Quota>;
  getProviderCapabilities(): Promise<ProviderCapability[]>;
  getProviderHealth(): Promise<ProviderHealth[]>;
}
