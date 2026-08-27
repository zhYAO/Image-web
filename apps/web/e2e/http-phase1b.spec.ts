import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const controlledPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const controlledSeedreamReferencePng = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGklEQVQ4jWP4TyFgGDXg/2gY/B8Ng//DIgwAXXj8LuMlDaEAAAAASUVORK5CYII=';
const acceptancePrefix = `phase1b-acceptance-${process.env.PHASE1B_RUN_ID?.trim() || Date.now()}`;
const chatModel = process.env.PHASE1B_CHAT_MODEL?.trim();
const chatToolModel = process.env.PHASE1B_CHAT_TOOL_MODEL?.trim();
const imageProvider = process.env.PHASE1B_IMAGE_PROVIDER?.trim();
const maxImageAttempts = 5;
let imageAttempts = 0;
let completedImageScenarios = 0;

for (const [name, actual, expected] of [
  ['PHASE1B_CHAT_MODEL', chatModel, 'doubao'],
  ['PHASE1B_CHAT_TOOL_MODEL', chatToolModel, 'minimax'],
  ['PHASE1B_IMAGE_PROVIDER', imageProvider, 'seedream'],
] as const) {
  if (actual && actual !== expected) throw new Error(`${name} must be ${expected}; received ${actual}.`);
}

interface BrowserResponse {
  body: unknown;
  correlationId: string | null;
  headers: Record<string, string>;
  status: number;
}

interface StreamEvent {
  batchId?: string;
  session?: { id?: string };
  type?: string;
}

async function browserFetch(
  page: Page,
  path: string,
  init?: { body?: unknown; headers?: Record<string, string>; method?: string },
): Promise<BrowserResponse> {
  return page.evaluate(async ({ requestInit, requestPath }) => {
    const headers = new Headers(requestInit?.headers);
    if (requestInit?.body !== undefined) headers.set('content-type', 'application/json');
    const response = await fetch(requestPath, {
      body: requestInit?.body === undefined ? undefined : JSON.stringify(requestInit.body),
      headers,
      method: requestInit?.method ?? 'GET',
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Preserve the raw body for a useful assertion failure.
    }
    return {
      body,
      correlationId: response.headers.get('x-correlation-id'),
      headers: Object.fromEntries(response.headers.entries()),
      status: response.status,
    };
  }, { requestInit: init, requestPath: path });
}

async function uploadControlledPng(
  page: Page,
  sessionId: string,
  png = controlledPng,
): Promise<BrowserResponse> {
  return page.evaluate(async ({ png, prefix, targetSessionId }) => {
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    const form = new FormData();
    form.append('file', new File([bytes], `${prefix}.png`, { type: 'image/png' }));
    form.append('sessionId', targetSessionId);
    const response = await fetch('/api/uploads', { body: form, method: 'POST' });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Preserve the raw body for a useful assertion failure.
    }
    return {
      body,
      correlationId: response.headers.get('x-correlation-id'),
      headers: Object.fromEntries(response.headers.entries()),
      status: response.status,
    };
  }, { png, prefix: acceptancePrefix, targetSessionId: sessionId });
}

function sessionIdFrom(response: BrowserResponse) {
  const body = response.body as { session?: { id?: unknown } };
  expect(body.session?.id).toMatch(/^[0-9a-f-]{36}$/i);
  return body.session!.id as string;
}

function reserveImageAttempt(label: string) {
  if (imageAttempts >= maxImageAttempts) {
    throw new Error(`Refusing ${label}: the Phase 1B hard limit of ${maxImageAttempts} image attempts is exhausted.`);
  }
  imageAttempts += 1;
}

async function waitForAnonymousIdentity(page: Page, context: BrowserContext) {
  await page.goto('/');
  await expect.poll(async () => (
    await context.cookies()
  ).some(({ name }) => name.startsWith('sb-') && name.includes('auth-token')), {
    message: 'Supabase anonymous identity cookie was not established after the CAPTCHA challenge.',
    timeout: 30_000,
  }).toBe(true);
  await expect(page.getByLabel('ZImage 身份验证')).toHaveCount(0);
}

async function createAcceptanceSession(page: Page, scenario: string) {
  const created = await browserFetch(page, '/api/sessions', {
    body: { title: `${acceptancePrefix}-${scenario}` },
    method: 'POST',
  });
  expect(created.status).toBe(201);
  expect(created.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
  return sessionIdFrom(created);
}

async function readSse(page: Page, body: Record<string, unknown>) {
  return page.evaluate(async (requestBody) => {
    const response = await fetch('/api/chat', {
      body: JSON.stringify(requestBody),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
    }
    const events = chunks.join('').split('\n\n')
      .map((frame) => frame.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim())
      .filter((payload): payload is string => Boolean(payload))
      .map((payload) => JSON.parse(payload) as StreamEvent);
    return {
      chunks,
      correlationId: response.headers.get('x-correlation-id'),
      events,
      status: response.status,
    };
  }, body);
}

async function waitForSucceededBatch(page: Page, batchId: string, source: 'chat_tool' | 'direct') {
  let body: { batch?: { assets?: Array<{ id?: string; status?: string }>; source?: string; status?: string } } = {};
  await expect.poll(async () => {
    const response = await browserFetch(page, `/api/image/${batchId}`);
    expect(response.status).toBe(200);
    body = response.body as typeof body;
    return body.batch?.status;
  }, { message: `Generation batch ${batchId} did not succeed.`, timeout: 120_000 }).toBe('succeeded');
  expect(body.batch?.source).toBe(source);
  expect(body.batch?.assets).toHaveLength(1);
  expect(body.batch?.assets?.[0]?.status).toBe('succeeded');
  const generationId = body.batch?.assets?.[0]?.id;
  expect(generationId).toMatch(/^[0-9a-f-]{36}$/i);
  return generationId!;
}

async function assertOwnedImageAndDenial(owner: Page, stranger: Page, generationId: string) {
  expect((await browserFetch(stranger, `/api/generations/${generationId}/asset-url`)).status).toBe(404);
  const signed = await browserFetch(owner, `/api/generations/${generationId}/asset-url`);
  expect(signed.status).toBe(200);
  expect(signed.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
  const url = (signed.body as { url?: unknown }).url;
  expect(url).toEqual(expect.any(String));
  const image = await owner.evaluate(async (assetUrl) => {
    const response = await fetch(assetUrl, { cache: 'no-store' });
    return {
      bytes: (await response.arrayBuffer()).byteLength,
      contentType: response.headers.get('content-type'),
      status: response.status,
    };
  }, url as string);
  expect(image.status).toBe(200);
  expect(image.contentType).toMatch(/^image\//);
  expect(image.bytes).toBeGreaterThan(0);
  return url as string;
}

async function triggerCleanupWorker() {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  const workerSecret = process.env.ZIMAGE_WORKER_CRON_SECRET?.trim();
  if (!projectUrl || !secretKey || !workerSecret) {
    throw new Error('Cleanup verification requires server-only Supabase and worker credentials.');
  }
  const response = await fetch(`${projectUrl}/functions/v1/cleanup-worker`, {
    body: '{}',
    headers: {
      apikey: secretKey,
      'content-type': 'application/json',
      'x-worker-secret': workerSecret,
    },
    method: 'POST',
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<{ action?: string; status?: string }>;
}

async function deleteAndAssertCleanup(page: Page, sessionId: string, assetUrl?: string) {
  const deleted = await browserFetch(page, `/api/sessions/${sessionId}`, { method: 'DELETE' });
  expect(deleted.status).toBe(202);
  expect(deleted.body).toMatchObject({ sessionId, status: 'deleting' });
  await expect.poll(async () => (await browserFetch(page, `/api/sessions/${sessionId}/timeline`)).status, {
    timeout: 30_000,
  }).toBe(404);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const cleanup = await triggerCleanupWorker();
    if (!assetUrl && cleanup.action === 'completed') return;
    if (assetUrl && cleanup.action === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!assetUrl) throw new Error(`Cleanup did not complete for ${sessionId}.`);
  await expect.poll(async () => page.evaluate(async (url) => (
    await fetch(url, { cache: 'no-store' })
  ).status, assetUrl), {
    intervals: [1_000, 2_000, 5_000, 10_000],
    message: `Cleanup did not invalidate the Storage object for ${sessionId}.`,
    timeout: 70_000,
  }).not.toBe(200);
}

async function submitSingleImage(page: Page, sessionId: string, prompt: string, referenceIds?: string[]) {
  reserveImageAttempt(prompt);
  const response = await browserFetch(page, '/api/image', {
    body: {
      params: { aspectRatio: '1:1', count: 1, referenceIds, resolution: '2K' },
      prompt,
      provider: imageProvider,
      sessionId,
    },
    headers: { 'idempotency-key': crypto.randomUUID() },
    method: 'POST',
  });
  expect(response.status).toBe(202);
  const body = response.body as { batchId?: unknown; sessionId?: unknown; status?: unknown };
  expect(body).toMatchObject({ sessionId, status: 'pending' });
  expect(body.batchId).toMatch(/^[0-9a-f-]{36}$/i);
  return body.batchId as string;
}

test.describe.configure({ mode: 'serial' });

test('restores one anonymous identity and rejects a second identity across session and timeline boundaries', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const strangerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const stranger = await strangerContext.newPage();
  let sessionId: string | undefined;
  try {
    await waitForAnonymousIdentity(owner, ownerContext);
    const ownerCookie = (await ownerContext.cookies()).find(({ name }) => name.startsWith('sb-') && name.includes('auth-token'));
    expect(ownerCookie).toBeDefined();
    sessionId = await createAcceptanceSession(owner, 'identity');
    await owner.reload();
    const listed = await browserFetch(owner, '/api/sessions');
    expect(listed.status).toBe(200);
    expect((listed.body as { sessions: Array<{ id: string }> }).sessions).toContainEqual(expect.objectContaining({ id: sessionId }));
    const restoredCookie = (await ownerContext.cookies()).find(({ name }) => name === ownerCookie!.name);
    expect(restoredCookie).toBeDefined();
    await waitForAnonymousIdentity(stranger, strangerContext);
    const strangerCookie = (await strangerContext.cookies()).find(({ name }) => name.startsWith('sb-') && name.includes('auth-token'));
    expect(strangerCookie).toBeDefined();
    expect(strangerCookie!.value).not.toBe(restoredCookie!.value);
    expect((await browserFetch(stranger, `/api/sessions/${sessionId}/timeline`)).status).toBe(404);
    expect((await browserFetch(stranger, `/api/sessions/${sessionId}`, {
      body: { title: 'must not be accepted' }, method: 'PATCH',
    })).status).toBe(404);
  } finally {
    if (sessionId) await browserFetch(owner, `/api/sessions/${sessionId}`, { method: 'DELETE' });
    await ownerContext.close();
    await strangerContext.close();
  }
});

test('uploads a controlled PNG only for its owning identity', async ({ browser }) => {
  test.skip(process.env.PHASE1B_STORAGE_WRITE !== 'true', 'Set PHASE1B_STORAGE_WRITE=true after cleanup scheduling is ready.');
  const ownerContext = await browser.newContext();
  const strangerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const stranger = await strangerContext.newPage();
  let sessionId: string | undefined;
  try {
    await waitForAnonymousIdentity(owner, ownerContext);
    await waitForAnonymousIdentity(stranger, strangerContext);
    sessionId = await createAcceptanceSession(owner, 'upload');
    expect((await uploadControlledPng(stranger, sessionId)).status).toBe(404);
    const uploaded = await uploadControlledPng(owner, sessionId);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toMatchObject({ height: 1, mimeType: 'image/png', width: 1 });
    expect((uploaded.body as { name?: string }).name).toBe(`${acceptancePrefix}.png`);
    expect(uploaded.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
  } finally {
    if (sessionId) await browserFetch(owner, `/api/sessions/${sessionId}`, { method: 'DELETE' });
    await ownerContext.close();
    await strangerContext.close();
  }
});

test('streams one Doubao response, persists it, and deletes the acceptance session', async ({ page }) => {
  test.skip(!chatModel, 'Set PHASE1B_CHAT_MODEL=doubao after confirming free provider quota.');
  await waitForAnonymousIdentity(page, page.context());
  const result = await readSse(page, { chatModel, message: `${acceptancePrefix} 只回复：SSE 正常`, tools: [] });
  expect(result.status).toBe(200);
  expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(result.chunks.length).toBeGreaterThan(0);
  expect(result.events.some(({ type }) => type === 'message.delta')).toBe(true);
  expect(result.events.some(({ type }) => type === 'message.completed')).toBe(true);
  const sessionId = result.events.find(({ type }) => type === 'session.created')?.session?.id;
  expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i);
  const timeline = await browserFetch(page, `/api/sessions/${sessionId}/timeline`);
  expect(timeline.status).toBe(200);
  expect((timeline.body as { items?: Array<{ role?: string }> }).items?.some(({ role }) => role === 'assistant')).toBe(true);
  await deleteAndAssertCleanup(page, sessionId!);
});

test('queues one Seedream image through the MiniMax chat-tool path and restores the same card', async ({ browser }) => {
  test.setTimeout(300_000);
  test.skip(!chatToolModel || !imageProvider, 'Set MiniMax chat-tool and Seedream image provider acceptance gates.');
  reserveImageAttempt('MiniMax chat tool');
  const ownerContext = await browser.newContext();
  const strangerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const stranger = await strangerContext.newPage();
  let sessionId: string | undefined;
  try {
    await waitForAnonymousIdentity(owner, ownerContext);
    await waitForAnonymousIdentity(stranger, strangerContext);
    const result = await readSse(owner, {
      chatModel: chatToolModel,
      imageProvider,
      message: `生成一张极简白底商品图；验收标识 ${acceptancePrefix}`,
      tools: ['generate_image'],
    });
    expect(result.status).toBe(200);
    sessionId = result.events.find(({ type }) => type === 'session.created')?.session?.id;
    expect(result.events.some(({ type }) => type === 'tool.queued')).toBe(true);
    expect(result.events.some(({ type }) => type === 'message.completed')).toBe(true);
    const batchId = result.events.find(({ type }) => type === 'tool.queued')?.batchId;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(batchId).toMatch(/^[0-9a-f-]{36}$/i);
    const generationId = await waitForSucceededBatch(owner, batchId!, 'chat_tool');
    const assetUrl = await assertOwnedImageAndDenial(owner, stranger, generationId);
    await owner.reload();
    const timeline = await browserFetch(owner, `/api/sessions/${sessionId}/timeline`);
    expect(timeline.status).toBe(200);
    const restored = (timeline.body as { items?: Array<{ batch?: { id?: string; source?: string }; type?: string }> }).items
      ?.find(({ batch, type }) => type === 'generation' && batch?.id === batchId);
    expect(restored?.batch?.source).toBe('chat_tool');
    await deleteAndAssertCleanup(owner, sessionId!, assetUrl);
    completedImageScenarios += 1;
    sessionId = undefined;
  } finally {
    if (sessionId) await browserFetch(owner, `/api/sessions/${sessionId}`, { method: 'DELETE' });
    await ownerContext.close();
    await strangerContext.close();
  }
});

for (const scenario of ['without-reference', 'with-reference'] as const) {
  test(`generates one Seedream image ${scenario.replace('-', ' ')}, enforces ownership, and cleans it`, async ({ browser }) => {
    test.setTimeout(300_000);
    test.skip(!imageProvider, 'Set PHASE1B_IMAGE_PROVIDER=seedream after confirming the cumulative image budget.');
    const ownerContext = await browser.newContext();
    const strangerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const stranger = await strangerContext.newPage();
    let sessionId: string | undefined;
    try {
      await waitForAnonymousIdentity(owner, ownerContext);
      await waitForAnonymousIdentity(stranger, strangerContext);
      sessionId = await createAcceptanceSession(owner, scenario);
      let referenceIds: string[] | undefined;
      if (scenario === 'with-reference') {
        const uploaded = await uploadControlledPng(owner, sessionId, controlledSeedreamReferencePng);
        expect(uploaded.status).toBe(201);
        expect(uploaded.body).toMatchObject({ height: 16, mimeType: 'image/png', width: 16 });
        referenceIds = [(uploaded.body as { id: string }).id];
      }
      const batchId = await submitSingleImage(owner, sessionId, `${acceptancePrefix} ${scenario} 极简商品图`, referenceIds);
      const generationId = await waitForSucceededBatch(owner, batchId, 'direct');
      const assetUrl = await assertOwnedImageAndDenial(owner, stranger, generationId);
      await deleteAndAssertCleanup(owner, sessionId, assetUrl);
      completedImageScenarios += 1;
      sessionId = undefined;
    } finally {
      if (sessionId) await browserFetch(owner, `/api/sessions/${sessionId}`, { method: 'DELETE' });
      await ownerContext.close();
      await strangerContext.close();
    }
  });
}

test.afterAll(() => {
  expect(imageAttempts).toBeLessThanOrEqual(maxImageAttempts);
  if (completedImageScenarios === 3) expect(imageAttempts).toBe(3);
});
