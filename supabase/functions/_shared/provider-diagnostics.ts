interface Admin { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
interface Dependencies { authorized: boolean; admin: Admin; env(name: string): string | undefined; fetcher: typeof fetch }
type Slot = 'astra' | 'sol';
type Receipt = { providerRequestId: string; resolvedModel: string; serviceTier: 'default'; requestedCacheTtl: '30m'; inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens: number; cacheWriteTokens: number; finishReason: 'stop' | 'length' };
const models = { astra: 'gpt-6-astra', sol: 'gpt-6.1-sol' } as const;
const encoder = new TextEncoder();
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('invalid_object'); return v as Record<string, unknown>; };
const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const budgeted = (v: unknown, max: number): number => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max) throw Error('invalid_usage'); return v; };

function fixedRequest(slot: Slot): string {
  // No caller/environment text, history, tools, image URLs or previous response can enter this payload.
  const messages = [{ role: 'user', content: 'Reply with the single word OK.' }];
  const input = JSON.stringify(messages);
  if (!/^[\x20-\x7e]+$/.test(input) || encoder.encode(input).length > 128) throw Error('fixed_input_bound');
  return JSON.stringify({ model: models[slot], messages, n: 1, stream: true, service_tier: 'default', stream_options: { include_usage: true }, max_completion_tokens: 128, prompt_cache_options: { mode: 'implicit', ttl: '30m' }, store: false });
}

function checkedReceipt(value: unknown, model: string): Receipt {
  const r = object(value);
  if (typeof r.providerRequestId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(r.providerRequestId) || r.resolvedModel !== model || r.serviceTier !== 'default' || r.requestedCacheTtl !== '30m' || !['stop', 'length'].includes(String(r.finishReason))) throw Error('invalid_identity');
  const inputTokens = budgeted(r.inputTokens, 2048), outputTokens = budgeted(r.outputTokens, 128), cachedInputTokens = budgeted(r.cachedInputTokens, 2048), cacheWriteTokens = budgeted(r.cacheWriteTokens, 2048), totalTokens = budgeted(r.totalTokens, 2176);
  if (cachedInputTokens + cacheWriteTokens > inputTokens || totalTokens !== inputTokens + outputTokens) throw Error('inconsistent_usage');
  return { providerRequestId: r.providerRequestId, resolvedModel: model, serviceTier: 'default', requestedCacheTtl: '30m', inputTokens, outputTokens, totalTokens, cachedInputTokens, cacheWriteTokens, finishReason: r.finishReason as 'stop' | 'length' };
}

async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number, signal?: AbortSignal): Promise<string> {
  if (!body) throw Error('missing_body');
  const reader = body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, text = '';
  try { for (;;) { if (signal?.aborted) throw Error('aborted'); const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > limit) throw Error('body_too_large'); text += decoder.decode(part.value, { stream: true }); } return text + decoder.decode(); }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

function parseReceipt(text: string, model: string): Receipt {
  let id: unknown, resolved: unknown, tier: unknown, usage: Record<string, unknown> | undefined, finish: unknown, done = false, prose = false;
  const frames = text.replaceAll('\r\n', '\n').split('\n\n'); if (frames.length > 512) throw Error('too_many_frames');
  for (const frame of frames) {
    if (!frame.trim()) continue;
    const lines = frame.split('\n'); if (lines.some(line => line && !line.startsWith('data:') && !line.startsWith(':'))) throw Error('invalid_sse');
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); if (!data) continue;
    if (done) throw Error('data_after_done'); if (data === '[DONE]') { done = true; continue; }
    const v = object(JSON.parse(data)); if (v.error) throw Error('supplier_error');
    if (v.id !== undefined) { if (id !== undefined && id !== v.id) throw Error('conflicting_id'); id = v.id; }
    if (v.model !== undefined) { if (resolved !== undefined && resolved !== v.model) throw Error('conflicting_model'); resolved = v.model; }
    if (v.service_tier !== undefined) { if (tier !== undefined && tier !== v.service_tier) throw Error('conflicting_tier'); tier = v.service_tier; }
    if (v.usage !== undefined && v.usage !== null) {
      const next = object(v.usage), details = object(next.prompt_tokens_details);
      const normalized = { inputTokens: next.prompt_tokens, outputTokens: next.completion_tokens, totalTokens: next.total_tokens, cachedInputTokens: details.cached_tokens, cacheWriteTokens: details.cache_write_tokens };
      if (usage && JSON.stringify(usage) !== JSON.stringify(normalized)) throw Error('conflicting_usage'); usage = normalized;
    }
    if (!Array.isArray(v.choices) || v.choices.length > 1) throw Error('invalid_choices');
    if (v.choices.length) {
      const choice = object(v.choices[0]), delta = object(choice.delta);
      if (choice.index !== 0) throw Error('invalid_choice_identity');
      if (typeof delta.content === 'string' && delta.content.length) { if (finish) throw Error('content_after_finish'); prose = true; }
      if (choice.finish_reason !== null && choice.finish_reason !== undefined) { if (finish || !['stop', 'length'].includes(String(choice.finish_reason))) throw Error('invalid_finish'); finish = choice.finish_reason; }
    }
  }
  if (!done || !prose || !finish || !usage) throw Error('incomplete_sse');
  return checkedReceipt({ providerRequestId: id, resolvedModel: resolved, serviceTier: tier, requestedCacheTtl: '30m', ...usage, finishReason: finish }, model);
}

function publicStatus(raw: Record<string, unknown>, campaignId: string, slot: Slot) {
  if (raw.campaignId !== campaignId || raw.slot !== slot || !['disabled', 'armed', 'halted', 'complete'].includes(String(raw.state)) || !['not_started', 'claimed', 'verified', 'needs_review'].includes(String(raw.attemptState))) throw Error('invalid_durable_status');
  const verified = raw.attemptState === 'verified';
  return { campaignId, slot, state: raw.state, attemptState: raw.attemptState, estimatedUsdMicros: verified ? budgeted(raw.estimatedUsdMicros, slot === 'astra' ? 32000 : 6400) : null, receipt: verified ? checkedReceipt(raw.receipt, models[slot]) : null };
}

/** Separate operational endpoint; no user identity, financial dispatcher or campaign creation API. */
export async function handleProviderDiagnostic(request: Request, d: Dependencies): Promise<Response> {
  if (!d.authorized) return response({ error: 'unauthorized' }, 401);
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
  let campaignId: string, slot: Slot, action: 'run' | 'status';
  try {
    if (new URL(request.url).search) throw Error('query_forbidden');
    const v = object(JSON.parse(await boundedText(request.body, 256)));
    if (Object.keys(v).length !== 3 || Object.keys(v).some(k => !['campaignId', 'slot', 'action'].includes(k)) || typeof v.campaignId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.campaignId) || typeof v.slot !== 'string' || !['astra', 'sol'].includes(v.slot) || typeof v.action !== 'string' || !['run', 'status'].includes(v.action)) throw Error('invalid_request');
    campaignId = v.campaignId; slot = v.slot as Slot; action = v.action as 'run' | 'status';
  } catch { return response({ error: 'invalid_diagnostic_request' }, 400); }
  if (action !== 'status' && d.env('ZIMAGE_PROVIDER_DIAGNOSTICS_ENABLED') !== 'true') return response({ error: 'unavailable' }, 503);
  if (d.env('ZIMAGE_PROVIDER_DIAGNOSTICS_CAMPAIGN_ID') !== campaignId) return response({ error: 'unavailable' }, 503);
  const call = async (p_action: string, p_result: unknown = null) => {
    const r = await d.admin.rpc('provider_diagnostic', { p_campaign_id: campaignId, p_slot: slot, p_action, p_result });
    if (r.error || !r.data) throw Error('diagnostic_pending'); return object(r.data);
  };
  if (action === 'status') { try { return response(publicStatus(await call('status'), campaignId, slot)); } catch { return response({ error: 'diagnostic_pending' }, 503); } }
  const key = d.env('OPENAI_API_KEY')?.trim(); if (!key || /^replace_/i.test(key)) return response({ error: 'unavailable' }, 503);
  if (request.signal.aborted) return response({ error: 'request_aborted' }, 408);
  let body: string, hash: string;
  try { body = fixedRequest(slot); hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(body)))).map(n => n.toString(16).padStart(2, '0')).join(''); }
  catch { return response({ error: 'invalid_diagnostic_profile' }, 503); }
  let claim: Record<string, unknown>;
  try { claim = await call('claim'); if (claim.action !== 'start') return response(publicStatus(claim, campaignId, slot)); }
  catch { return response({ error: 'diagnostic_pending' }, 503); }
  let result: { outcome: 'verified'; receipt: Receipt } | { outcome: 'uncertain'; reason: string };
  if (claim.profile !== 'openai-small-v1' || claim.model !== models[slot] || claim.maxInputTokens !== 2048 || claim.maxOutputTokens !== 128 || claim.requestSha256 !== hash) result = { outcome: 'uncertain', reason: 'profile_mismatch' };
  else {
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
      const upstream = await d.fetcher('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body, redirect: 'error', signal });
      if (!upstream.ok) { await upstream.body?.cancel(); throw Error('provider_failure'); }
      result = { outcome: 'verified', receipt: parseReceipt(await boundedText(upstream.body, 131072, signal), models[slot]) };
    } catch { result = { outcome: 'uncertain', reason: 'provider_evidence_unverified' }; }
  }
  try { const saved = publicStatus(await call('record', result), campaignId, slot); return response(saved, saved.attemptState === 'verified' ? 200 : 409); }
  catch { return response({ error: 'diagnostic_pending' }, 503); }
}
