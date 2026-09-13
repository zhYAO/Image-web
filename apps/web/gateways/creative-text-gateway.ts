import { creativeTextFieldLimits, creativeTextOptimizeRequestSchema, creativeTextOptimizeResponseSchema, type CreativeTextOptimizeRequest } from '@zimage/domain';

/** Stateless auxiliary request: never writes session, timeline, or image state. */
export async function requestCreativeTextOptimization(value: CreativeTextOptimizeRequest, signal?: AbortSignal) {
  const input = creativeTextOptimizeRequestSchema.parse({ ...value, context: value.context?.slice(0, 2000) });
  signal?.throwIfAborted();
  const mode = process.env.NEXT_PUBLIC_DATA_MODE ?? 'mock';
  if (mode === 'mock') {
    let text = input.text.replace(/[ \t]+/g, ' ').replace(/(?<!\d)[,;]|[,;](?!\d)/g, '，');
    if (!/[。！？.!?]$/.test(text) && text.length < Math.min(input.maxLength ?? 6000, creativeTextFieldLimits[input.field])) text += '。';
    return creativeTextOptimizeResponseSchema.parse({ text, mock: true });
  }
  if (mode !== 'http') throw new Error('Unsupported data mode');
  const response = await fetch('/api/creative-text/optimize', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input), signal,
  });
  if (!response.ok) throw new Error('creative_text_optimization_failed');
  const result = creativeTextOptimizeResponseSchema.parse(await response.json());
  if (result.text.length > Math.min(input.maxLength ?? 6000, creativeTextFieldLimits[input.field])) throw new Error('optimized_text_too_long');
  return result;
}
