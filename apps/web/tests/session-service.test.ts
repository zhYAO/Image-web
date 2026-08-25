import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createSessionService, type SessionStore } from '@/server/sessions/session-service';
import { SupabaseSessionStore } from '@/server/sessions/supabase-session-store';

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
  it('maps PostgreSQL timestamp offsets from a real Supabase row', async () => {
    const query = {
      insert: vi.fn(),
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: {
          created_at: '2026-08-24T09:04:57.514905+00:00',
          id: session.id,
          status: 'active',
          title: '会话',
          updated_at: '2026-08-24T09:04:57.514905+00:00',
        },
        error: null,
      }),
    };
    query.insert.mockReturnValue(query);
    query.select.mockReturnValue(query);
    const adminClient = { from: vi.fn().mockReturnValue(query) } as unknown as SupabaseClient;
    const repository = new SupabaseSessionStore({} as SupabaseClient, adminClient);

    await expect(repository.create(userId, '会话')).resolves.toMatchObject({
      createdAt: '2026-08-24T09:04:57.514905+00:00',
      id: session.id,
    });
  });

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
