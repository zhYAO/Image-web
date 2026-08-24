import { z } from 'zod';

const titleSchema = z.string().trim().min(1).max(100);
const providerIdentifierSchema = z.string().trim().min(1).max(200);
const promptSchema = z.string().trim().min(1).max(8000);

export const apiErrorCodeSchema = z.enum([
  'bad_request',
  'unauthorized',
  'quota_exceeded',
  'provider_error',
  'network',
  'moderation',
  'asset_expired',
  'session_deleting',
  'conflict',
  'not_found',
]);

export const apiErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  correlationId: z.uuid(),
  details: z.strictObject({
    batchId: z.uuid().optional(),
    field: z.string().max(100).optional(),
    generationId: z.uuid().optional(),
    provider: providerIdentifierSchema.optional(),
  }).optional(),
  message: z.string().min(1).max(500),
  retryable: z.boolean(),
});

export const sessionSchema = z.strictObject({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  status: z.enum(['active', 'deleting']),
  title: titleSchema,
  updatedAt: z.iso.datetime(),
});

export const createSessionRequestSchema = z.strictObject({
  title: titleSchema.optional(),
});

export const renameSessionRequestSchema = z.strictObject({
  title: titleSchema,
});

export const listSessionsResponseSchema = z.strictObject({
  sessions: z.array(sessionSchema),
});

export const sessionResponseSchema = z.strictObject({
  session: sessionSchema,
});

export const deleteSessionResponseSchema = z.strictObject({
  sessionId: z.uuid(),
  status: z.literal('deleting'),
});

export const safeWorkspaceErrorSchema = z.strictObject({
  code: z.enum([
    'VALIDATION_PROMPT_REQUIRED',
    'VALIDATION_IMAGE_COUNT',
    'VALIDATION_ASPECT_RATIO',
    'VALIDATION_RESOLUTION',
    'VALIDATION_UPLOAD_SIZE',
    'VALIDATION_UPLOAD_TYPE',
    'PROVIDER_UNAVAILABLE',
    'STREAM_INTERRUPTED',
    'SESSION_NOT_FOUND',
    'BATCH_NOT_FOUND',
    'DELETE_RETRY_REQUIRED',
    'STORAGE_RECOVERED',
    'BAD_REQUEST',
    'UNAUTHORIZED',
    'QUOTA_EXCEEDED',
    'PROVIDER_ERROR',
    'NETWORK',
    'MODERATION',
    'ASSET_EXPIRED',
    'SESSION_DELETING',
    'CONFLICT',
    'NOT_FOUND',
    'UNKNOWN',
  ]),
  message: z.string().min(1).max(500),
  retryable: z.boolean(),
});

export const generationAssetSchema = z.strictObject({
  error: safeWorkspaceErrorSchema.optional(),
  expired: z.boolean().optional(),
  expiresAt: z.iso.datetime().optional(),
  id: z.uuid(),
  status: z.enum(['pending', 'processing', 'succeeded', 'failed']),
  url: z.string().optional(),
});

export const generationBatchSchema = z.strictObject({
  assets: z.array(generationAssetSchema).min(1).max(4),
  config: z.strictObject({
    aspectRatio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']),
    count: z.number().int().min(1).max(4),
    resolution: z.enum(['1K', '2K']),
  }),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  model: providerIdentifierSchema,
  prompt: promptSchema,
  provider: providerIdentifierSchema,
  sessionId: z.uuid(),
  source: z.enum(['direct', 'chat_tool']),
  status: z.enum(['pending', 'processing', 'partial', 'succeeded', 'failed']),
});

const timelineBaseSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  sequence: z.number().int().positive(),
  sessionId: z.uuid(),
});

export const timelineItemSchema = z.discriminatedUnion('type', [
  timelineBaseSchema.extend({
    content: z.string(),
    role: z.enum(['user', 'assistant']),
    streaming: z.boolean().optional(),
    type: z.literal('message'),
  }).strict(),
  timelineBaseSchema.extend({
    batch: generationBatchSchema,
    type: z.literal('generation'),
  }).strict(),
  timelineBaseSchema.extend({
    actionLabel: z.string().max(100).optional(),
    error: safeWorkspaceErrorSchema,
    type: z.literal('error'),
  }).strict(),
]);

export const timelineResponseSchema = z.strictObject({
  items: z.array(timelineItemSchema),
  nextCursor: z.number().int().positive().optional(),
});

export const referenceUploadResponseSchema = z.strictObject({
  expiresAt: z.iso.datetime(),
  height: z.number().int().positive(),
  id: z.uuid(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  name: z.string().min(1).max(255),
  size: z.number().int().positive().max(10 * 1024 * 1024),
  width: z.number().int().positive(),
});

export const generationAssetUrlResponseSchema = z.strictObject({
  expiresAt: z.iso.datetime(),
  generationId: z.uuid(),
  url: z.url(),
});

export const quotaSchema = z.strictObject({
  limit: z.number().int().positive(),
  resetsAt: z.iso.datetime(),
  used: z.number().int().nonnegative(),
});

export const providerCapabilitySchema = z.strictObject({
  models: z.array(z.strictObject({
    aspectRatios: z.array(z.enum(['1:1', '3:4', '4:3', '9:16', '16:9'])),
    id: providerIdentifierSchema,
    label: z.string().min(1).max(200),
    maxImages: z.number().int().min(1).max(4),
    resolutions: z.array(z.enum(['1K', '2K'])),
  })).min(1),
  provider: providerIdentifierSchema,
});

export const providerHealthSchema = z.strictObject({
  checkedAt: z.iso.datetime(),
  message: z.string().max(500).optional(),
  provider: providerIdentifierSchema,
  status: z.enum(['healthy', 'degraded', 'unavailable']),
});

export const providerStatusResponseSchema = z.strictObject({
  capabilities: z.array(providerCapabilitySchema),
  health: z.array(providerHealthSchema),
  registryVersion: z.string().min(1),
});

export const skillSchema = z.strictObject({
  coverImageUrl: z.string().optional(),
  description: z.string().min(1).max(500),
  fields: z.array(z.strictObject({
    key: z.string().min(1).max(100),
    label: z.string().min(1).max(100),
    placeholder: z.string().max(200).optional(),
    required: z.boolean(),
  })),
  icon: z.string().min(1).max(20),
  id: providerIdentifierSchema,
  name: z.string().min(1).max(100),
  promptTemplate: z.string().min(1).max(2000),
  requiresImageTool: z.boolean(),
  version: z.string().min(1).max(50),
});

export const skillsResponseSchema = z.strictObject({
  registryVersion: z.string().min(1),
  skills: z.array(skillSchema),
});

export const generationBatchResponseSchema = z.strictObject({
  batch: generationBatchSchema,
});

export const imageParamsSchema = z.strictObject({
  aspectRatio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']),
  count: z.number().int().min(1).max(4),
  referenceIds: z.array(z.uuid()).max(4).optional(),
  resolution: z.enum(['1K', '2K']),
});

export const imageRequestSchema = z.strictObject({
  model: providerIdentifierSchema.optional(),
  params: imageParamsSchema,
  prompt: promptSchema,
  provider: providerIdentifierSchema.optional(),
  sessionId: z.uuid().optional(),
  skillId: providerIdentifierSchema.optional(),
});

export const imageSubmissionResponseSchema = z.strictObject({
  batchId: z.uuid(),
  sessionId: z.uuid(),
  status: z.literal('pending'),
});

export const recreateImageRequestSchema = z.strictObject({
  batchId: z.uuid(),
  generationId: z.uuid().optional(),
  mode: z.enum(['single', 'failed', 'all']),
}).superRefine((request, context) => {
  if (request.mode === 'single' && !request.generationId) {
    context.addIssue({ code: 'custom', message: 'generationId is required for single recreation', path: ['generationId'] });
  }
  if (request.mode !== 'single' && request.generationId) {
    context.addIssue({ code: 'custom', message: 'generationId is only allowed for single recreation', path: ['generationId'] });
  }
});

export const chatRequestSchema = z.strictObject({
  chatModel: providerIdentifierSchema.optional(),
  imageProvider: providerIdentifierSchema.optional(),
  images: z.array(z.uuid()).max(4).optional(),
  message: z.string().trim().min(1).max(16000),
  sessionId: z.uuid().optional(),
  skillId: providerIdentifierSchema.optional(),
  tools: z.array(z.literal('generate_image')).max(1).optional(),
});

export const chatEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ session: sessionSchema, type: z.literal('session.created') }),
  z.strictObject({ delta: z.string().min(1), messageId: z.uuid(), type: z.literal('message.delta') }),
  z.strictObject({ content: z.string().min(1), messageId: z.uuid(), type: z.literal('message.completed') }),
  z.strictObject({ batchId: z.uuid(), type: z.literal('tool.queued') }),
  z.strictObject({ error: safeWorkspaceErrorSchema, type: z.literal('stream.failed') }),
]);

export type ApiError = z.infer<typeof apiErrorSchema>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type DeleteSessionResponse = z.infer<typeof deleteSessionResponseSchema>;
export type ImageApiRequest = z.infer<typeof imageRequestSchema>;
export type ImageSubmissionResponse = z.infer<typeof imageSubmissionResponseSchema>;
export type RenameSessionRequest = z.infer<typeof renameSessionRequestSchema>;
