import type {
  GenerationBatchStatus,
  GenerationStatus,
  ImageRequest,
  SafeError,
  ValidationResult,
} from './types';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ratios = new Set(['1:1', '3:4', '4:3', '9:16', '16:9']);
const resolutions = new Set(['1K', '2K']);
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function aggregateBatchStatus(statuses: readonly GenerationStatus[]): GenerationBatchStatus {
  if (statuses.length === 0 || statuses.every((status) => status === 'pending')) return 'pending';
  if (statuses.some((status) => status === 'processing' || status === 'pending')) return 'processing';
  if (statuses.every((status) => status === 'succeeded')) return 'succeeded';
  if (statuses.every((status) => status === 'failed')) return 'failed';
  return 'partial';
}

export function nextTimelineSequence(items: ReadonlyArray<{ sequence: number }>): number {
  return items.reduce((maximum, item) => Math.max(maximum, item.sequence), 0) + 1;
}

function invalid(code: SafeError['code'], message: string): ValidationResult {
  return { error: { code, message, retryable: false }, ok: false };
}

export function validateImageRequest(request: ImageRequest): ValidationResult {
  if (!request.prompt.trim()) return invalid('VALIDATION_PROMPT_REQUIRED', '请输入生图提示词。');
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > 4) {
    return invalid('VALIDATION_IMAGE_COUNT', '每次可生成 1–4 张图片。');
  }
  if (!ratios.has(request.aspectRatio)) {
    return invalid('VALIDATION_ASPECT_RATIO', '请选择支持的图片比例。');
  }
  if (!resolutions.has(request.resolution)) {
    return invalid('VALIDATION_RESOLUTION', '请选择 1K 或 2K 分辨率。');
  }
  for (const reference of request.references ?? []) {
    if (reference.size > MAX_UPLOAD_BYTES) {
      return invalid('VALIDATION_UPLOAD_SIZE', '单张参考图不能超过 10 MB。');
    }
    if (!allowedMimeTypes.has(reference.mimeType)) {
      return invalid('VALIDATION_UPLOAD_TYPE', '参考图仅支持 JPG、PNG 或 WebP。');
    }
  }
  return { ok: true };
}

export function resolveImageToolEnabled(input: {
  explicitEnabled: boolean;
  skillRequiresImage: boolean;
}): boolean {
  return input.skillRequiresImage || input.explicitEnabled;
}

export function hasTextOnlyImageIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  const firstClause = normalized.split(/[，,。；;\n]/, 1)[0] ?? '';
  // Requesting a plan/prompt is a text operation even when image tools are available.
  return /(?:方案|提示词|建议|思路|计划)|\b(?:prompt|plan|ideas?|advice)\b/.test(firstClause)
    || /(?:先|仅|只)(?:讨论|分析|聊|规划)|(?:不要|暂不|先不)执行/.test(normalized)
    || /(?:方案|提示词|建议|思路|计划)[。！!？?]*$/.test(normalized)
    || /(?:generate|create|write|make)\s+(?:(?:me|a|an|the)\s+)*(?:prompt|plan|ideas?|advice)\b/.test(normalized)
    || /(?:不要|无需|不用|暂不|先不).{0,6}(?:生成|生图|绘制|画图)/.test(normalized);
}

export function hasExplicitImageIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (hasTextOnlyImageIntent(normalized)) return false;
  const chineseCommand = /^(?:(?:请你?|帮我|给我|现在|直接|立刻|我要|我想要)\s*)*(?:生成|制作|创建|绘制|画|出图)/;
  const englishCommand = /^(?:(?:please|could you|can you|i want(?: you)? to|i need(?: you)? to)\s+)*(?:generate|create|draw|make|produce)\b/;
  return chineseCommand.test(normalized) || englishCommand.test(normalized);
}

export class WorkspaceError extends Error {
  readonly safe: SafeError;

  constructor(safe: SafeError) {
    super(safe.message);
    this.name = 'WorkspaceError';
    this.safe = safe;
  }
}

export function sanitizeError(error: unknown): SafeError {
  if (error instanceof WorkspaceError) return error.safe;
  return { code: 'UNKNOWN', message: '发生未知错误，请稍后重试。', retryable: true };
}
