import type { CreditConfirmation } from './credits';
import type { SkillTask } from './skill-contracts';
export type ComposerMode = 'chat' | 'image';

export type GenerationStatus = 'pending' | 'processing' | 'succeeded' | 'failed';
export type GenerationBatchStatus = GenerationStatus | 'partial';
export type GenerationSource = 'direct' | 'chat_tool';
export type RecreateScope = 'single' | 'failed' | 'all';
export type UploadStatus = 'idle' | 'validating' | 'ready' | 'uploading' | 'failed';
export type MockScenario =
  | 'happy'
  | 'partial'
  | 'provider-unavailable'
  | 'expired'
  | 'delete-retry';

export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
export type ImageResolution = '1K' | '2K';

export type ErrorCode =
  | 'VALIDATION_PROMPT_REQUIRED'
  | 'VALIDATION_IMAGE_COUNT'
  | 'VALIDATION_ASPECT_RATIO'
  | 'VALIDATION_RESOLUTION'
  | 'VALIDATION_UPLOAD_SIZE'
  | 'VALIDATION_UPLOAD_TYPE'
  | 'PROVIDER_UNAVAILABLE'
  | 'STREAM_INTERRUPTED'
  | 'SESSION_NOT_FOUND'
  | 'BATCH_NOT_FOUND'
  | 'DELETE_RETRY_REQUIRED'
  | 'STORAGE_RECOVERED'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'QUOTA_EXCEEDED'
  | 'PROVIDER_ERROR'
  | 'NETWORK'
  | 'MODERATION'
  | 'ASSET_EXPIRED'
  | 'SESSION_DELETING'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export interface SafeError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export type SessionActivityType = 'chat' | 'image' | 'commerce' | 'poster';

export interface Session {
  activityTypes?: SessionActivityType[];
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'deleting';
}

interface TimelineBase {
  id: string;
  sessionId: string;
  sequence: number;
  createdAt: string;
}

export interface MessageTimelineItem extends TimelineBase {
  type: 'message';
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

export interface GenerationAsset {
  id: string;
  status: GenerationStatus;
  url?: string;
  error?: SafeError;
  expiresAt?: string;
  expired?: boolean;
}

export interface GenerationConfigSnapshot {
  aspectRatio: AspectRatio;
  count: number;
  resolution: ImageResolution;
}

export interface GenerationBatch {
  id: string;
  sessionId: string;
  source: GenerationSource;
  status: GenerationBatchStatus;
  prompt: string;
  provider: string;
  model: string;
  config: GenerationConfigSnapshot;
  createdAt: string;
  assets: GenerationAsset[];
}

export interface GenerationTimelineItem extends TimelineBase {
  type: 'generation';
  batch: GenerationBatch;
}

export interface ErrorTimelineItem extends TimelineBase {
  type: 'error';
  error: SafeError;
  actionLabel?: string;
}

export type TimelineItem = MessageTimelineItem | GenerationTimelineItem | ErrorTimelineItem;

export interface SkillField {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

export interface Skill {
  coverImageUrl?: string;
  id: string;
  name: string;
  description: string;
  icon: string;
  defaults: string;
  suggestedInput: string;
  output: string;
  limitations: string;
  requiresImageTool: boolean;
  version: string;

}

export interface ProviderCapability {
  provider: string;
  models: Array<{
    id: string;
    label: string;
    aspectRatios: AspectRatio[];
    resolutions: ImageResolution[];
    maxImages: number;
  }>;
}

export interface Quota {
  used: number;
  limit: number;
  resetsAt: string;
}

export interface ProviderHealth {
  provider: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  checkedAt: string;
  message?: string;
}

export interface UploadReference {
  file?: File;
  id?: string;
  name: string;
  size: number;
  mimeType: string;
  previewUrl?: string;
  status?: UploadStatus;
}

export interface ChatRequest {
  billing?: CreditConfirmation;
  requestId?: string;
  taskId?: string;
  taskRevision?: number;
  targetGenerationId?: string;
  references?: UploadReference[];
  proposal?: string;
  imageSettings?: GenerationConfigSnapshot & { provider: string; model: string };
  chatModel?: string;
  imageProvider?: string;
  images?: string[];
  sessionId?: string;
  message: string;
  imageToolEnabled: boolean;
  skillId?: string;
  skillValues?: Record<string, string>;
  scenario?: MockScenario;
}

export type ChatEvent =
  | { type: 'task.updated'; task: SkillTask }
  | { type: 'session.created'; session: Session }
  | { type: 'message.delta'; messageId: string; delta: string }
  | { type: 'message.completed'; messageId: string; content: string }
  | { type: 'tool.queued'; batchId: string }
  | { type: 'stream.failed'; error: SafeError };

export interface ImageRequest {
  billing?: CreditConfirmation;
  requestId?: string;
  sessionId?: string;
  prompt: string;
  count: number;
  aspectRatio: AspectRatio;
  resolution: ImageResolution;
  provider?: string;
  model?: string;
  references?: UploadReference[];
  skillId?: string;
  skillValues?: Record<string, string>;
  scenario?: MockScenario;
}

export interface RecreateRequest {
  billing?: CreditConfirmation;
  requestId?: string;
  batchId: string;
  scope: RecreateScope;
  generationId?: string;
}

export type ValidationResult = { ok: true } | { ok: false; error: SafeError };
