import { describe, expect, it, vi } from 'vitest';

import {
  createPreviewUsageGuard,
  PreviewUsageRetentionError,
  withPreviewUsageReservation,
} from '@/server/preview/preview-usage-guard';

const userId = '00000000-0000-4000-8000-0000000000a1';
const correlationId = '10000000-0000-4000-8000-0000000000a1';

function rpcClient(result: { data: unknown; error: { code?: string; message?: string } | null }) {
  return { rpc: vi.fn().mockResolvedValue(result) };
}

describe('preview usage guard', () => {
  it('maps an atomic database quota rejection to the existing HTTP 429 contract', async () => {
    const client = rpcClient({ data: null, error: { message: 'preview_quota_exceeded' } });
    const guard = createPreviewUsageGuard(client);

    await expect(guard.reserve({
      businessKey: `session:${correlationId}`,
      correlationId,
      createsSession: true,
      operation: 'session_create',
      userId,
    })).rejects.toMatchObject({ code: 'quota_exceeded', status: 429 });
  });

  it('maps disabled public-preview features to a fail-closed provider error', async () => {
    const client = rpcClient({ data: null, error: { message: 'feature_disabled:generation' } });
    const guard = createPreviewUsageGuard(client);

    await expect(guard.reserve({
      businessKey: `generation:${correlationId}`,
      correlationId,
      createsSession: false,
      operation: 'generation',
      userId,
    })).rejects.toMatchObject({ code: 'provider_error', status: 503 });
  });

  it('releases a reservation when the protected mutation fails', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const guard = createPreviewUsageGuard({ rpc });
    const failure = new Error('storage_failed');

    await expect(withPreviewUsageReservation(guard, {
      bytes: 1024,
      businessKey: `upload:${correlationId}`,
      correlationId,
      createsSession: false,
      operation: 'upload',
      userId,
    }, async () => { throw failure; })).rejects.toBe(failure);

    expect(rpc).toHaveBeenNthCalledWith(1, 'reserve_preview_usage', expect.objectContaining({
      p_bytes: 1024,
      p_operation: 'upload',
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'release_preview_usage', {
      p_business_key: `upload:${correlationId}`,
      p_correlation_id: correlationId,
      p_user_id: userId,
    });
  });

  it('commits a reservation after the mutation succeeds', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const guard = createPreviewUsageGuard({ rpc });

    await expect(withPreviewUsageReservation(guard, {
      businessKey: `write:${correlationId}`,
      correlationId,
      createsSession: false,
      operation: 'session_update',
      userId,
    }, async () => 'ok')).resolves.toBe('ok');

    expect(rpc).toHaveBeenNthCalledWith(2, 'commit_preview_usage', {
      p_business_key: `write:${correlationId}`,
      p_user_id: userId,
    });
  });

  it('returns durable work and retains usage when the commit response is unknown', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'commit_connection_lost' } });
    const guard = createPreviewUsageGuard({ rpc });

    await expect(withPreviewUsageReservation(guard, {
      businessKey: `write:${correlationId}`,
      correlationId,
      createsSession: false,
      operation: 'session_update',
      userId,
    }, async () => 'durable-write')).resolves.toBe('durable-write');

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).not.toHaveBeenCalledWith('release_preview_usage', expect.anything());
  });

  it('retains the reservation when compensating persistence cleanup fails', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: true, error: null });
    const guard = createPreviewUsageGuard({ rpc });
    const failure = new Error('metadata_cleanup_failed');

    await expect(withPreviewUsageReservation(guard, {
      bytes: 1024,
      businessKey: `upload:${correlationId}`,
      correlationId,
      createsSession: false,
      operation: 'upload',
      userId,
    }, async () => {
      throw new PreviewUsageRetentionError(failure);
    })).rejects.toBe(failure);

    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
