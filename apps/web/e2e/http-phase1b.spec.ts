import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const controlledPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

interface BrowserResponse {
  body: unknown;
  correlationId: string | null;
  headers: Record<string, string>;
  status: number;
}

async function browserFetch(
  page: Page,
  path: string,
  init?: { body?: unknown; method?: string },
): Promise<BrowserResponse> {
  return page.evaluate(async ({ requestInit, requestPath }) => {
    const response = await fetch(requestPath, {
      body: requestInit?.body === undefined ? undefined : JSON.stringify(requestInit.body),
      headers: requestInit?.body === undefined ? undefined : { 'content-type': 'application/json' },
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

async function uploadControlledPng(page: Page, sessionId: string): Promise<BrowserResponse> {
  return page.evaluate(async ({ png, targetSessionId }) => {
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    const form = new FormData();
    form.append('file', new File([bytes], 'phase1b-controlled.png', { type: 'image/png' }));
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
  }, { png: controlledPng, targetSessionId: sessionId });
}

function sessionIdFrom(response: BrowserResponse) {
  const body = response.body as { session?: { id?: unknown } };
  expect(body.session?.id).toMatch(/^[0-9a-f-]{36}$/i);
  return body.session!.id as string;
}

async function waitForAnonymousIdentity(page: Page, context: BrowserContext) {
  await expect.poll(async () => (
    await context.cookies()
  ).some(({ name }) => name.startsWith('sb-') && name.includes('auth-token')), {
    message: 'Supabase anonymous identity cookie was not established after the CAPTCHA challenge.',
    timeout: 30_000,
  }).toBe(true);
  await expect(page.getByLabel('ZImage 身份验证')).toHaveCount(0);
}

test('restores one anonymous identity and rejects a second identity across session and timeline boundaries', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const strangerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const stranger = await strangerContext.newPage();
  let sessionId: string | undefined;

  try {
    await owner.goto('/');
    await waitForAnonymousIdentity(owner, ownerContext);
    const ownerCookie = (await ownerContext.cookies()).find(({ name }) => name.startsWith('sb-') && name.includes('auth-token'));
    expect(ownerCookie).toBeDefined();

    const created = await browserFetch(owner, '/api/sessions', {
      body: { title: `Phase 1B identity ${Date.now()}` },
      method: 'POST',
    });
    expect(created.status).toBe(201);
    expect(created.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
    sessionId = sessionIdFrom(created);

    await owner.reload();
    const listed = await browserFetch(owner, '/api/sessions');
    expect(listed.status).toBe(200);
    expect((listed.body as { sessions: Array<{ id: string }> }).sessions).toContainEqual(
      expect.objectContaining({ id: sessionId }),
    );
    const restoredCookie = (await ownerContext.cookies()).find(({ name }) => name === ownerCookie!.name);
    expect(restoredCookie).toBeDefined();

    await stranger.goto('/');
    await waitForAnonymousIdentity(stranger, strangerContext);
    const strangerCookie = (await strangerContext.cookies()).find(({ name }) => name.startsWith('sb-') && name.includes('auth-token'));
    expect(strangerCookie).toBeDefined();
    expect(strangerCookie!.value).not.toBe(restoredCookie!.value);

    const foreignTimeline = await browserFetch(stranger, `/api/sessions/${sessionId}/timeline`);
    expect(foreignTimeline.status).toBe(404);
    const foreignRename = await browserFetch(stranger, `/api/sessions/${sessionId}`, {
      body: { title: 'must not be accepted' },
      method: 'PATCH',
    });
    expect(foreignRename.status).toBe(404);
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
    await owner.goto('/');
    await stranger.goto('/');
    await waitForAnonymousIdentity(owner, ownerContext);
    await waitForAnonymousIdentity(stranger, strangerContext);
    const created = await browserFetch(owner, '/api/sessions', {
      body: { title: `Phase 1B Storage ${Date.now()}` },
      method: 'POST',
    });
    expect(created.status).toBe(201);
    sessionId = sessionIdFrom(created);

    const foreignUpload = await uploadControlledPng(stranger, sessionId);
    expect(foreignUpload.status).toBe(404);

    const ownerUpload = await uploadControlledPng(owner, sessionId);
    expect(ownerUpload.status).toBe(201);
    expect(ownerUpload.body).toMatchObject({
      height: 1,
      mimeType: 'image/png',
      name: 'phase1b-controlled.png',
      width: 1,
    });
    expect(ownerUpload.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
  } finally {
    if (sessionId) await browserFetch(owner, `/api/sessions/${sessionId}`, { method: 'DELETE' });
    await ownerContext.close();
    await strangerContext.close();
  }
});

test('streams a real provider response through the HTTP SSE route', async ({ page }) => {
  const chatModel = process.env.PHASE1B_CHAT_MODEL?.trim();
  test.skip(!chatModel, 'Set PHASE1B_CHAT_MODEL only after the provider cost and hard-limit gate is approved.');
  await page.goto('/');

  await expect.poll(async () => (
    await page.context().cookies()
  ).some(({ name }) => name.startsWith('sb-') && name.includes('auth-token')), {
    message: 'Supabase anonymous identity cookie was not established after the CAPTCHA challenge.',
    timeout: 30_000,
  }).toBe(true);

  const result = await page.evaluate(async (model) => {
    const response = await fetch('/api/chat', {
      body: JSON.stringify({ chatModel: model, message: '只回复：Phase 1B SSE 正常', tools: [] }),
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
    return {
      chunks,
      contentType: response.headers.get('content-type'),
      correlationId: response.headers.get('x-correlation-id'),
      status: response.status,
    };
  }, chatModel);

  expect(result.status).toBe(200);
  expect(result.contentType).toContain('text/event-stream');
  expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(result.chunks.length).toBeGreaterThan(0);
  const stream = result.chunks.join('');
  const events = stream
    .split('\n\n')
    .map((frame) => frame.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim())
    .filter((payload): payload is string => Boolean(payload))
    .map((payload) => JSON.parse(payload) as { session?: { id?: string }; type?: string });
  const createdSessionId = events.find((event) => event.type === 'session.created')?.session?.id;
  if (createdSessionId) await browserFetch(page, `/api/sessions/${createdSessionId}`, { method: 'DELETE' });
  expect(stream).toContain('message.delta');
  expect(stream).toContain('message.completed');
});
