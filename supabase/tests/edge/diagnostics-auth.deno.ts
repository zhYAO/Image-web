import diagnostic from '../../functions/provider-diagnostics/index.ts';
const campaignId = '11111111-1111-4111-8111-111111111111';
const defaultKey = 'sb_secret_synthetic_default_not_real';
const request = (key?: string, action: unknown = 'run') => new Request('https://native-test.invalid/', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { apikey: key } : {}) }, body: JSON.stringify({ campaignId, slot: 'astra', action }) });
function assert(value: unknown, label: string): asserts value { if (!value) throw Error(label); }
Deno.test('diagnostic entry real SDK refuses missing, publishable, other secret and bearer-only before all network', async () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = () => { calls++; throw Error('unexpected_network'); };
  try {
    for (const key of [undefined, 'sb_publishable_synthetic_not_real', 'sb_secret_synthetic_other_not_real']) { const r = await diagnostic.fetch(request(key)); assert(r.status === 401, 'untrusted_auth'); await r.body?.cancel(); }
    const bearer = await diagnostic.fetch(new Request('https://native-test.invalid/', { method: 'POST', headers: { authorization: 'Bearer invalid-synthetic' }, body: '{}' })); assert(bearer.status === 401, 'bearer_authorized'); await bearer.body?.cancel();
    assert(calls === 0, 'unauthorized_network');
  } finally { globalThis.fetch = original; }
});
Deno.test('diagnostic entry uses fixed capped payload and only diagnostic RPC with no wallet API', async () => {
  const original = globalThis.fetch, actions: string[] = []; let calls = 0;
  const receipt = { providerRequestId: 'chatcmpl-synthetic', resolvedModel: 'gpt-6-astra', serviceTier: 'default', requestedCacheTtl: '30m', inputTokens: 12, outputTokens: 2, totalTokens: 14, cachedInputTokens: 0, cacheWriteTokens: 0, finishReason: 'stop' };
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://native-test.supabase.invalid/rest/v1/rpc/provider_diagnostic')) {
      const v = JSON.parse(String(init?.body)); actions.push(v.p_action);
      if (v.p_action === 'claim') return Response.json({ action: 'start', profile: 'openai-small-v1', model: 'gpt-6-astra', maxInputTokens: 2048, maxOutputTokens: 128, requestSha256: 'bafa4ab06078ae70ebb49b4ef69720900aee254bf41e16402cab3114f41568ef' });
      assert(v.p_action === 'record' && v.p_result.outcome === 'verified', 'invalid_audit');
      return Response.json({ action: 'status', campaignId, slot: 'astra', state: 'armed', attemptState: 'verified', estimatedUsdMicros: 220, receipt });
    }
    assert(url === 'https://api.openai.com/v1/chat/completions', 'nonallowlisted_network'); calls++;
    const body = JSON.parse(String(init?.body)); assert(body.model === 'gpt-6-astra' && body.max_completion_tokens === 128 && body.n === 1, 'unbounded_request');
    assert(body.messages.length === 1 && body.messages[0].content === 'Reply with the single word OK.' && init?.redirect === 'error', 'mutable_input');
    return new Response('data: {"id":"chatcmpl-synthetic","model":"gpt-6-astra","service_tier":"default","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: {"id":"chatcmpl-synthetic","model":"gpt-6-astra","service_tier":"default","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":2,"total_tokens":14,"prompt_tokens_details":{"cached_tokens":0,"cache_write_tokens":0}}}\n\ndata: [DONE]\n\n');
  };
  try { const r = await diagnostic.fetch(request(defaultKey)); const v = await r.json(); assert(r.status === 200 && v.attemptState === 'verified', 'verification_not_durable'); assert(calls === 1 && actions.join(',') === 'claim,record', 'unexpected_repeat_or_financial_api'); assert(!JSON.stringify(v).includes('Reply with') && !JSON.stringify(v).includes('synthetic-openai'), 'private_content_exposed'); }
  finally { globalThis.fetch = original; }
});
Deno.test('disabled diagnostic gate prevents provider credentials and RPC even for the default service identity', async () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = () => { calls++; throw Error('unexpected_network'); };
  Deno.env.set('ZIMAGE_PROVIDER_DIAGNOSTICS_ENABLED', 'false');
  try { for (const action of ['run', ['run'], ['status']]) { const r = await diagnostic.fetch(request(defaultKey, action)); assert(r.status === (typeof action === 'string' ? 503 : 400) && calls === 0, 'disabled_diagnostic_sent_network'); await r.body?.cancel(); } }
  finally { Deno.env.set('ZIMAGE_PROVIDER_DIAGNOSTICS_ENABLED', 'true'); globalThis.fetch = original; }
});
