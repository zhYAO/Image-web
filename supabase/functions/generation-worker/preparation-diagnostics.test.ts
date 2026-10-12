import { afterEach, describe, expect, it, vi } from 'vitest';
import { processClaim, type AdminClient, type ClaimedGeneration } from '../_shared/generation-runner';

const id = '11111111-1111-4111-8111-111111111111';
const claim: ClaimedGeneration = {
  action: 'process', generationId: id, batchId: id, sessionId: id, userId: id,
  claimToken: id, messageId: 1, readCount: 1, provider: 'seedream',
  model: 'doubao-seedream-5.0-pro', prompt: 'synthetic regression input',
  params: { aspectRatio: '1:1', resolution: '2K', referenceIds: [id] },
  references: [{ id, bucket: 'uploads', path: 'synthetic.webp', mimeType: 'image/webp' }],
};

function boundary(download: ReturnType<AdminClient['storage']['from']>['download']) {
  const operations: string[] = [];
  const admin: AdminClient = {
    rpc: async (name, input = {}) => {
      if (name === 'assert_chat_provider_available') return { data: true, error: null };
      operations.push(String(input.p_operation));
      return { data: { accepted: true }, error: null };
    },
    storage: { from: () => ({ download, upload: async () => ({ error: null }) }) },
  };
  const provider = vi.fn(async () => { throw new Error('provider must remain uncalled'); });
  return { admin, operations, provider };
}

afterEach(() => vi.unstubAllGlobals());

describe('safe preparation failure diagnostics', () => {
  it('identifies a Storage HTTP rejection without exposing its message', async () => {
    const f = boundary(async () => ({ data: null, error: { message: 'synthetic private value', status: 403 } }));
    const outcome = await processClaim(f.admin, claim, { callProvider: f.provider });
    expect(outcome).toEqual({ action: 'retry', code: 'reference_download_failed',
      preparation: { stage: 'reference_download', reason: 'storage_download_failed', storageHttpStatus: 403 } });
    expect(f.operations).toEqual(['renew', 'retry']);
    expect(f.provider).not.toHaveBeenCalled();
    expect(JSON.stringify(outcome)).not.toContain('synthetic private value');
  });

  it('distinguishes reference membership validation from a download failure', async () => {
    const f = boundary(async () => { throw new Error('download must remain uncalled'); });
    const outcome = await processClaim(f.admin, { ...claim, references: [] }, { callProvider: f.provider });
    expect(outcome).toMatchObject({ preparation: { stage: 'reference_validation', reason: 'reference_count_mismatch' } });
    expect(f.provider).not.toHaveBeenCalled();
  });

  it('identifies runtime type errors without returning exception text', async () => {
    const f = boundary(async () => { throw new TypeError('synthetic sensitive exception'); });
    const outcome = await processClaim(f.admin, claim, { callProvider: f.provider });
    expect(outcome).toMatchObject({ preparation: { stage: 'reference_download', reason: 'runtime_type_error' } });
    expect(JSON.stringify(outcome)).not.toContain('synthetic sensitive exception');
    expect(f.provider).not.toHaveBeenCalled();
  });

  it.each(['synthetic private status', 99, 600, Number.NaN])('omits an invalid Storage HTTP status: %s', async (status) => {
    const f = boundary(async () => ({ data: null, error: { message: 'synthetic message', status } }));
    const outcome = await processClaim(f.admin, claim, { callProvider: f.provider });
    expect(outcome).toEqual({ action: 'retry', code: 'reference_download_failed',
      preparation: { stage: 'reference_download', reason: 'storage_download_failed' } });
  });

  it('preserves final failure after the fifth preparation attempt without calling the provider', async () => {
    const f = boundary(async () => ({ data: null, error: { message: 'unavailable', status: 500 } }));
    const outcome = await processClaim(f.admin, { ...claim, readCount: 5 }, { callProvider: f.provider });
    expect(outcome).toMatchObject({ action: 'failed', code: 'reference_download_failed',
      preparation: { stage: 'reference_download', reason: 'storage_download_failed', storageHttpStatus: 500 } });
    expect(f.operations).toEqual(['renew', 'fail']);
    expect(f.provider).not.toHaveBeenCalled();
  });

  it('marks a missing Plan credential as configuration failure before storage or provider use', async () => {
    const values: Record<string, string> = {
      ZIMAGE_SEEDREAM_PLAN_IMAGE_ENDPOINT: 'https://unapproved.invalid/private',
    };
    vi.stubGlobal('Deno', { env: { get: (name: string) => values[name] } });
    const f = boundary(async () => { throw new Error('download must remain uncalled'); });
    const outcome = await processClaim(f.admin, claim);
    expect(outcome).toMatchObject({ code: 'provider_unavailable',
      preparation: { stage: 'provider_configuration', reason: 'missing_environment' } });
    expect(f.operations).toEqual(['renew', 'retry']);
    expect(JSON.stringify(outcome)).not.toContain('synthetic-key');
    expect(JSON.stringify(outcome)).not.toContain('unapproved.invalid');
  });
});
