import { afterEach, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => {
  const scope = { setLevel: vi.fn(), setTag: vi.fn() };
  return {
    scope,
    init: vi.fn(),
    withScope: (callback: (current: typeof scope) => void) => callback(scope),
    captureException: vi.fn(),
    flush: vi.fn(),
  };
});
vi.mock('@sentry/deno', () => sdk);

afterEach(() => vi.unstubAllGlobals());

it('sends a generic worker exception and removes private event fields', async () => {
  vi.stubGlobal('Deno', {
    env: { get: (name: string) => name === 'SENTRY_DSN' ? 'https://example.invalid/1' : undefined },
  });
  const { captureWorkerException } = await import('../_shared/sentry');

  await captureWorkerException(new Error('private provider token'), {
    operation: 'generation_worker',
    correlationId: 'safe-correlation-id',
    jobId: 'safe-job-id',
    status: 'failed',
  });
  expect(sdk.captureException).toHaveBeenCalledExactlyOnceWith(new Error('worker_operation_failed'));
  const tags = Object.fromEntries(sdk.scope.setTag.mock.calls);
  expect(tags).toEqual({
    operation: 'generation_worker',
    correlation_id: 'safe-correlation-id',
    job_id: 'safe-job-id',
    status: 'failed',
  });

  expect(sdk.init).toHaveBeenCalledOnce();
  const { beforeSend, sendDefaultPii } = sdk.init.mock.calls[0]![0];
  expect(sendDefaultPii).toBe(false);
  expect(beforeSend({
    breadcrumbs: [{ message: 'private prompt' }],
    contexts: { account: { id: 'private-account-id' } },
    extra: { token: 'secret' },
    request: { headers: { authorization: 'Bearer secret' }, data: 'private prompt' },
    user: { id: 'private-user-id' },
    tags: { ...tags, prompt: 'private prompt' },
    message: 'private message',
    exception: { values: [{ type: 'Error', value: 'private provider token' }] },
  })).toEqual({
    user: { ip_address: '0.0.0.0' },
    tags,
    message: 'redacted_worker_error',
    exception: { values: [{ type: 'Error', value: 'redacted_worker_error' }] },
  });
});
