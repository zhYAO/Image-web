import { describe, expect, it, vi } from 'vitest';

import { createSessionService, type SessionStore } from '@/server/sessions/session-service';

const userId = '00000000-0000-4000-8000-0000000000a1';
const session = {
  createdAt: '2026-08-24T00:00:00.000Z',
  id: '10000000-0000-4000-8000-0000000000a1',
  status: 'active' as const,
  title: '会话',
  updatedAt: '2026-08-24T00:00:00.000Z',
};

function store(overrides: Partial<SessionStore> = {}): SessionStore {
  return {
    create: vi.fn().mockResolvedValue(session),
    list: vi.fn().mockResolvedValue([session]),
    rename: vi.fn().mockResolvedValue(session),
    requestDeletion: vi.fn().mockResolvedValue('accepted'),
    ...overrides,
  };
}

describe('session service', () => {
  it('scopes every store operation to the verified user id', async () => {
    const repository = store();
    const service = createSessionService(repository);

    await expect(service.list(userId)).resolves.toEqual({ sessions: [session] });
    await expect(service.create(userId, { title: '  新会话  ' })).resolves.toEqual({ session });
    await expect(service.rename(userId, session.id, { title: '  新标题  ' })).resolves.toEqual({ session });

    expect(repository.list).toHaveBeenCalledWith(userId);
    expect(repository.create).toHaveBeenCalledWith(userId, '新会话');
    expect(repository.rename).toHaveBeenCalledWith(userId, session.id, '新标题');
  });

  it('turns repeat deletion and missing sessions into stable public failures', async () => {
    const repeated = createSessionService(store({ requestDeletion: vi.fn().mockResolvedValue('already_deleting') }));
    await expect(repeated.remove(userId, session.id)).rejects.toMatchObject({
      code: 'session_deleting',
      status: 409,
    });

    const missing = createSessionService(store({ requestDeletion: vi.fn().mockResolvedValue('not_found') }));
    await expect(missing.remove(userId, session.id)).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
  });
});
