import { expect, it, vi } from 'vitest';
import { handleProviderDiagnostic } from '../_shared/provider-diagnostics';
import { createHash } from 'node:crypto';

const campaignId = '11111111-1111-4111-8111-111111111111';
const expectedBody = (model = 'gpt-6-astra') => ({ model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], n: 1, stream: true, service_tier: 'default', stream_options: { include_usage: true }, max_completion_tokens: 128, prompt_cache_options: { mode: 'implicit', ttl: '30m' }, store: false });
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const envValues = { ZIMAGE_PROVIDER_DIAGNOSTICS_ENABLED: 'true', ZIMAGE_PROVIDER_DIAGNOSTICS_CAMPAIGN_ID: campaignId, OPENAI_API_KEY: 'synthetic-not-a-real-key' };
const request = (extra = {}, url = 'https://diagnostic.invalid/') => new Request(url, { method: 'POST', body: JSON.stringify({ campaignId, slot: 'astra', action: 'run', ...extra }) });
const receipt = { providerRequestId: 'chatcmpl-synthetic', resolvedModel: 'gpt-6-astra', serviceTier: 'default', requestedCacheTtl: '30m', inputTokens: 12, outputTokens: 2, totalTokens: 14, cachedInputTokens: 0, cacheWriteTokens: 0, finishReason: 'stop' };
const stream = (extra: Record<string, unknown> = {}, prefix = '') => new Response(prefix + 'data: ' + JSON.stringify({ id: receipt.providerRequestId, model: receipt.resolvedModel, service_tier: 'default', choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }] }) + '\n\ndata: ' + JSON.stringify({ id: receipt.providerRequestId, model: receipt.resolvedModel, service_tier: 'default', choices: [], usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } }, ...extra }) + '\n\ndata: [DONE]\n\n');
function fixture(options: { claim?: Record<string, unknown>; failRecord?: boolean; fetcher?: typeof fetch; env?: Record<string, string | undefined> } = {}) {
  const records: Record<string, unknown>[] = [], reads: string[] = [];
  const admin = { rpc: async (name: string, args: Record<string, unknown>) => {
    expect(name).toBe('provider_diagnostic'); records.push(args);
    if (args.p_action === 'claim') return { data: { action: 'start', profile: 'openai-small-v1', model: 'gpt-6-astra', maxInputTokens: 2048, maxOutputTokens: 128, requestSha256: sha(expectedBody()), ...options.claim }, error: null };
    if (args.p_action === 'record' && options.failRecord) return { data: null, error: { message: 'synthetic db failure' } };
    const verified = (args.p_result as { outcome?: string } | undefined)?.outcome === 'verified';
    return { data: { action: 'status', campaignId, slot: 'astra', state: verified ? 'armed' : 'halted', attemptState: verified ? 'verified' : 'needs_review', estimatedUsdMicros: verified ? 220 : null, receipt: verified ? receipt : null }, error: null };
  } };
  const fetcher = options.fetcher ?? vi.fn(async () => stream());
  const env = (name: string) => { reads.push(name); return ({ ...envValues, ...options.env } as Record<string, string | undefined>)[name]; };
  return { authorized: true, admin, env, fetcher, records, reads };
}

it('rejects an unauthenticated caller before credentials, claims or network', async () => {
  const d = fixture(); expect((await handleProviderDiagnostic(request(), { ...d, authorized: false })).status).toBe(401);
  expect(d.records).toEqual([]); expect(d.reads).toEqual([]); expect(d.fetcher).not.toHaveBeenCalled();
});
it.each([undefined, 'false'])('requires the separate explicit diagnostic gate (%s)', async value => {
  const d = fixture({ env: { ZIMAGE_PROVIDER_DIAGNOSTICS_ENABLED: value } });
  expect((await handleProviderDiagnostic(request(), d)).status).toBe(503);
  expect(d.reads).not.toContain('OPENAI_API_KEY'); expect(d.records).toEqual([]); expect(d.fetcher).not.toHaveBeenCalled();
});
it.each([{ prompt: 'override' }, { messages: [] }, { model: 'gpt-6-astra' }, { max_completion_tokens: 10000 }, { userId: campaignId }, { endpoint: 'https://evil.invalid' }])('rejects all caller overrides %j', async extra => {
  const d = fixture(); expect((await handleProviderDiagnostic(request(extra), d)).status).toBe(400); expect(d.records).toEqual([]); expect(d.fetcher).not.toHaveBeenCalled();
});
it('rejects query inputs and oversized chunked bodies without reading a key', async () => {
  for (const r of [request({}, 'https://diagnostic.invalid/?prompt=override'), new Request('https://diagnostic.invalid/', { method: 'POST', body: ' '.repeat(1024) })]) {
    const d = fixture(); expect((await handleProviderDiagnostic(r, d)).status).toBe(400); expect(d.reads).not.toContain('OPENAI_API_KEY'); expect(d.records).toEqual([]);
  }
});
it('requires the exact separately configured campaign and no missing supplier key', async () => {
  for (const settings of [{ ZIMAGE_PROVIDER_DIAGNOSTICS_CAMPAIGN_ID: undefined }, { ZIMAGE_PROVIDER_DIAGNOSTICS_CAMPAIGN_ID: '22222222-2222-4222-8222-222222222222' }, { OPENAI_API_KEY: undefined }]) {
    const d = fixture({ env: settings }); expect((await handleProviderDiagnostic(request(), d)).status).toBe(503); expect(d.fetcher).not.toHaveBeenCalled(); expect(d.records).toEqual([]);
  }
});
it.each([{ action: ['run'] }, { action: ['status'] }, { slot: ['astra'] }, { action: { value: 'run' } }])('rejects nonstring controls even when the diagnostic gate is disabled %j', async extra => {
  const d = fixture({ env: { ZIMAGE_PROVIDER_DIAGNOSTICS_ENABLED: 'false' } });
  expect((await handleProviderDiagnostic(request(extra), d)).status).toBe(400);
  expect(d.records).toEqual([]); expect(d.reads).not.toContain('OPENAI_API_KEY'); expect(d.fetcher).not.toHaveBeenCalled();
});
it('sends only the bounded immutable request and persists a verified receipt before response', async () => {
  const d = fixture(); d.fetcher = vi.fn(async (url, init) => {
    expect(url).toBe('https://api.openai.com/v1/chat/completions'); expect(init?.redirect).toBe('error'); expect(init?.headers).toEqual({ authorization: 'Bearer synthetic-not-a-real-key', 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body)).n).toBe(1); expect(JSON.parse(String(init?.body))).toEqual(expectedBody()); expect(new TextEncoder().encode(JSON.stringify(JSON.parse(String(init?.body)).messages)).length).toBeLessThan(128);
    expect(d.records.map(x => x.p_action)).toEqual(['claim']); return stream();
  });
  const r = await handleProviderDiagnostic(request(), d); expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ attemptState: 'verified', receipt });
  expect(d.records.map(x => x.p_action)).toEqual(['claim', 'record']); expect(d.records[1].p_result).toEqual({ outcome: 'verified', receipt });
  expect(JSON.stringify(d.records)).not.toContain('synthetic-not-a-real-key'); expect(JSON.stringify(d.records)).not.toContain('Reply with');
});
it.each([{ model: 'gpt-6.1-sol' }, { maxInputTokens: 32000 }, { maxOutputTokens: 4000 }, { requestSha256: '0'.repeat(64) }, { profile: 'other' }])('consumes but never sends a mismatched frozen diagnostic profile %j', async claim => {
  const d = fixture({ claim }); const r = await handleProviderDiagnostic(request(), d); expect(r.status).toBe(409); expect(d.fetcher).not.toHaveBeenCalled(); expect(d.records[1].p_result).toEqual({ outcome: 'uncertain', reason: 'profile_mismatch' });
});
it('does not resend an already claimed or completed attempt', async () => {
  for (const attemptState of ['claimed', 'verified', 'needs_review']) {
    const d = fixture({ claim: { action: 'status', campaignId, slot: 'astra', attemptState, state: 'halted', estimatedUsdMicros: attemptState === 'verified' ? 220 : null, receipt: attemptState === 'verified' ? receipt : null } });
    expect((await handleProviderDiagnostic(request(), d)).status).toBe(200); expect(d.fetcher).not.toHaveBeenCalled(); expect(d.records.map(x => x.p_action)).toEqual(['claim']);
  }
});
it.each([
  { service_tier: 'fast' }, { model: 'different' }, { id: 'different' },
  { usage: { prompt_tokens: 2049, completion_tokens: 2, total_tokens: 2051, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } },
  { usage: { prompt_tokens: 12, completion_tokens: 129, total_tokens: 141, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } },
  { usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14, prompt_tokens_details: { cached_tokens: 8, cache_write_tokens: 5 } } },
  { usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14, prompt_tokens_details: { cached_tokens: 0 } } },
  { usage: null }, { error: { message: 'private provider error' } },
])('halts on inconsistent or missing provider evidence %j without retry', async extra => {
  const d = fixture({ fetcher: vi.fn(async () => stream(extra)) }); const r = await handleProviderDiagnostic(request(), d); expect(r.status).toBe(409); expect(d.fetcher).toHaveBeenCalledOnce(); expect(d.records[1].p_result).toEqual({ outcome: 'uncertain', reason: 'provider_evidence_unverified' }); expect(await r.text()).not.toContain('private provider error');
});
it('halts after a missing DONE, oversized stream, or transport error and never retries', async () => {
  const responses = [new Response((await stream().text()).replace('data: [DONE]\n\n', '')), new Response('data: ' + 'x'.repeat(140000)), new Response('private-error', { status: 500 })];
  for (const response of responses) { const d = fixture({ fetcher: vi.fn(async () => response) }); expect((await handleProviderDiagnostic(request(), d)).status).toBe(409); expect(d.fetcher).toHaveBeenCalledOnce(); expect(d.records[1].p_result).toMatchObject({ outcome: 'uncertain' }); }
});
it('reports lost persistence as pending and never fabricates success or retries', async () => {
  const d = fixture({ failRecord: true }); const r = await handleProviderDiagnostic(request(), d); expect(r.status).toBe(503); expect(await r.json()).toEqual({ error: 'diagnostic_pending' }); expect(d.fetcher).toHaveBeenCalledOnce(); expect(d.records).toHaveLength(2);
});
it('labels TTL as the immutable request policy and never as supplier-confirmed metadata', async () => {
  const d = fixture(); const r = await handleProviderDiagnostic(request(), d); expect(r.status).toBe(200);
  expect((d.records[1].p_result as { receipt: Record<string, unknown> }).receipt.requestedCacheTtl).toBe('30m');
  expect((d.records[1].p_result as { receipt: Record<string, unknown> }).receipt).not.toHaveProperty('cacheTtl');
});
it.each([99, '0', null, undefined])('refuses a completion choice other than numeric zero (%s)', async index => {
  const data = (await stream().text()).replace('"index":0,', index === undefined ? '' : '"index":' + JSON.stringify(index) + ',');
  const d = fixture({ fetcher: vi.fn(async () => new Response(data)) }); const r = await handleProviderDiagnostic(request(), d);
  expect(r.status).toBe(409); expect(d.records[1].p_result).toEqual({ outcome: 'uncertain', reason: 'provider_evidence_unverified' });
});
it('does not combine the prose of choice zero and the termination of choice one', async () => {
  const first = { id: receipt.providerRequestId, model: receipt.resolvedModel, service_tier: 'default', choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: null }] };
  const finish = { id: receipt.providerRequestId, model: receipt.resolvedModel, service_tier: 'default', choices: [{ index: 1, delta: {}, finish_reason: 'stop' }] };
  const usage = { id: receipt.providerRequestId, model: receipt.resolvedModel, service_tier: 'default', choices: [], usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } };
  const data = [first, finish, usage].map(v => 'data: ' + JSON.stringify(v) + '\n\n').join('') + 'data: [DONE]\n\n';
  const d = fixture({ fetcher: vi.fn(async () => new Response(data)) }); expect((await handleProviderDiagnostic(request(), d)).status).toBe(409); expect(d.records[1].p_result).toMatchObject({ outcome: 'uncertain' });
});
it('reads status with paid gate disabled without key access or provider traffic', async () => {
  const d = fixture({ env: { ZIMAGE_PROVIDER_DIAGNOSTICS_ENABLED: 'false', OPENAI_API_KEY: undefined } }); expect((await handleProviderDiagnostic(request({ action: 'status' }), d)).status).toBe(200); expect(d.reads).not.toContain('OPENAI_API_KEY'); expect(d.fetcher).not.toHaveBeenCalled(); expect(d.records[0].p_action).toBe('status');
});
