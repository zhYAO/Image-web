import { describe, expect, it, vi } from 'vitest';

import { requireVerifiedUserId } from '../server/route-context';

describe('requireVerifiedUserId', () => {
  it('returns the id from the live verified session RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'd9428888-122b-11e1-b85c-61cd3cbb3210', error: null });
    await expect(requireVerifiedUserId({ rpc } as never)).resolves.toBe('d9428888-122b-11e1-b85c-61cd3cbb3210');
    expect(rpc).toHaveBeenCalledWith('require_verified_user_id');
  });

  it('reports an undeployed identity guard as service unavailable', async () => {
    await expect(requireVerifiedUserId({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } }) } as never)).rejects.toMatchObject({ status: 503, code: 'network' });
  });

  it.each([
    { status: 400, data: null, error: { code: 'P0001', message: 'unauthorized' } },
    { status: 401, data: null, error: { code: '42501', message: 'permission denied' } },
    ...['PGRST301', 'PGRST302', 'PGRST303'].map(code => ({ status: 401, data: null, error: { code } })),
  ])('reports a confirmed missing or revoked identity as unauthorized ($error.code)', async (result) => {
    await expect(requireVerifiedUserId({ rpc: vi.fn().mockResolvedValue(result) } as never)).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });
  it.each([
    { status: 0, data: null, error: { code: '', message: 'TypeError: fetch failed' } },
    { status: 503, data: null, error: { code: 'PGRST000' } },
    { status: 500, data: null, error: { code: 'XX000' } },
    { status: 403, data: null, error: { code: '42501' } },
    { status: 400, data: null, error: { code: 'P0001', message: 'service failed' } },
    { status: 200, data: null, error: null },
    { status: 200, data: 'invalid uuid', error: null },
  ])('never turns an unverified service failure into logout ($status/$error)', async (result) => {
    await expect(requireVerifiedUserId({ rpc: vi.fn().mockResolvedValue(result) } as never)).rejects.toMatchObject({ status: 503, code: 'network' });
  });
});
