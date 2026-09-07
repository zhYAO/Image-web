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
    ['old token', null, null],
    ['anonymous identity', null, { code: 'P0001' }],
  ])('rejects %s', async (_name, data, error) => {
    await expect(requireVerifiedUserId({ rpc: vi.fn().mockResolvedValue({ data, error }) } as never)).rejects.toMatchObject({ status: 401 });
  });
});
