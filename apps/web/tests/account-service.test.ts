import { describe, expect, it, vi } from 'vitest';
import { readAccount, updateDisplayName } from '@/server/auth/account-service';

const owner = '10000000-0000-4000-8000-000000000001';
function fixture() {
  const profile = vi.fn().mockResolvedValue({ data: { display_name: 'name', status: 'active' }, error: null });
  const update = vi.fn().mockResolvedValue({ data: { user_id: owner }, error: null });
  const client = {
    rpc: vi.fn().mockResolvedValue({ data: owner, error: null }),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { email: 'local@example.test' } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: profile }) }), update: () => ({ eq: () => ({ select: () => ({ single: update }) }) }) }),
  };
  return { client, profile, update };
}
describe('account identity versus service failures', () => {
  it('retains a verified identity when the profile service fails', async () => {
    const { client, profile } = fixture();
    profile.mockResolvedValue({ data: null, error: { code: 'PGRST000' } });
    await expect(readAccount(client as never)).rejects.toMatchObject({ status: 503, code: 'network' });
  });
  it('does not turn a getUser service failure after identity verification into logout', async () => {
    const { client } = fixture();
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'service unavailable' } } as never);
    await expect(readAccount(client as never)).rejects.toMatchObject({ status: 503, code: 'network' });
  });
  it('keeps database write failures distinct from revoked authentication', async () => {
    const { client, update } = fixture();
    update.mockResolvedValue({ data: null, error: { code: 'XX000' } });
    await expect(updateDisplayName(client as never, 'name')).rejects.toMatchObject({ status: 503, code: 'network' });
  });
  it('still rejects an explicit revoked identity before reading protected account fields', async () => {
    const { client, profile } = fixture();
    client.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'unauthorized' } } as never);
    await expect(readAccount(client as never)).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(profile).not.toHaveBeenCalled();
  });
});
