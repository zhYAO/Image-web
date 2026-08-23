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
  | 'UNKNOWN';

export interface SafeError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface Session {
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

export interface GenerationBatch {
  id: string;
  sessionId: string;
  source: GenerationSource;
  status: GenerationBatchStatus;
  prompt: string;
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
  promptTemplate: string;
  requiresImageTool: boolean;
  fields: SkillField[];
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
  name: string;
  size: number;
  mimeType: string;
  previewUrl?: string;
  status?: UploadStatus;
}

export interface ChatRequest {
  sessionId?: string;
  message: string;
  imageToolEnabled: boolean;
  skillId?: string;
  skillValues?: Record<string, string>;
  scenario?: MockScenario;
}

export type ChatEvent =
  | { type: 'session.created'; session: Session }
  | { type: 'message.delta'; messageId: string; delta: string }
  | { type: 'message.completed'; messageId: string; content: string }
  | { type: 'tool.queued'; batch: GenerationBatch }
  | { type: 'stream.failed'; error: SafeError };

export interface ImageRequest {
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
  batchId: string;
  scope: RecreateScope;
  generationId?: string;
}

export type ValidationResult = { ok: true } | { ok: false; error: SafeError };
