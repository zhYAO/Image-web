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
    expect(repository.create).toHaveBeenCalledWith(userId, '新会话', undefined);
    expect(repository.rename).toHaveBeenCalledWith(userId, session.id, '新标题');
  });

  it('passes a durable session identity only after UUID validation', async () => {
    const repository = store();
    const service = createSessionService(repository);
    const requestId = crypto.randomUUID();
    await service.create(userId, { title: '商品方案', requestId });
    expect(repository.create).toHaveBeenCalledWith(userId, '商品方案', requestId);
    await expect(service.create(userId, { requestId: 'not-a-uuid' })).rejects.toThrow();
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it('replays session creation without overwriting data and checks ownership before returning', async () => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
    const adminQuery = { upsert: vi.fn().mockResolvedValue({ error: null }) };
    const repository = new SupabaseSessionStore({ from: vi.fn().mockReturnValue(query) } as unknown as SupabaseClient,
      { from: vi.fn().mockReturnValue(adminQuery) } as unknown as SupabaseClient);
    await expect(repository.create(userId, '商品方案', session.id)).rejects.toMatchObject({ status: 503 });
    expect(adminQuery.upsert).toHaveBeenCalledWith({ id: session.id, title: '商品方案', user_id: userId }, { onConflict: 'id', ignoreDuplicates: true });
    expect(query.eq.mock.calls).toEqual([['id', session.id], ['user_id', userId], ['status', 'active']]);
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
