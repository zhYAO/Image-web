import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sessionSchema, type Session } from '@zimage/domain';
import { SessionSidebar } from '@/features/workspace/SessionSidebar';
import { MockWorkspaceGateway, MOCK_STORAGE_KEY } from '@/gateways/mock-workspace-gateway';
import { SupabaseSessionStore } from '@/server/sessions/supabase-session-store';
import type { SupabaseClient } from '@supabase/supabase-js';
const base = { id: '00000000-0000-4000-8000-000000000001', title: '旧聊天', status: 'active', createdAt: '2026-09-13T00:00:00Z', updatedAt: '2026-09-13T00:00:00Z' } as const;
describe('session activity', () => {
  it('accepts old responses and multiple creation categories', () => {
    expect(sessionSchema.parse(base).activityTypes).toBeUndefined();
    expect(sessionSchema.parse({ ...base, activityTypes: ['image', 'poster'] }).activityTypes).toEqual(['image', 'poster']);
  });
  it('filters mixed creation sessions and retains legacy chat access', () => {
    const sessions = [{ ...base, activityTypes: ['chat'] }, { ...base, id: 'mixed', title: '混合创作', activityTypes: ['image', 'poster'] }, { ...base, id: 'shop', title: '店铺套图', activityTypes: ['commerce', 'poster'] }, { ...base, id: 'poster', title: '海报创作', activityTypes: ['poster'] }] as Session[];
    render(<SessionSidebar sessions={sessions} onCreate={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.queryByRole('link', { name: '小红书海报' })).toBeNull();
    expect(screen.getByRole('link', { name: '电商生图' })).toHaveAttribute('href', '/create');
    const shopRow = screen.getByRole('button', { name: '店铺套图' }).closest<HTMLElement>('[class*=sessionItem]')!;
    expect(within(shopRow).getAllByText('电商生图')).toHaveLength(1);
    const mixedRow = screen.getByRole('button', { name: '混合创作' }).parentElement!.parentElement!;
    expect(within(mixedRow).queryByText('普通创作')).toBeNull();
    expect(within(mixedRow).getByText('电商生图')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '电商生图' }));
    expect(screen.getByRole('button', { name: '海报创作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '店铺套图' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '混合创作' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '旧聊天' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '普通创作' }));
    expect(screen.getByRole('button', { name: '旧聊天' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '混合创作' })).toBeNull();
  });
  it('summarizes persisted mock data excluding commerce child batches', async () => {
    const state = { sessions: [base, { ...base, id: 'shop' }], timelines: {}, batches: { ordinary: { id: 'ordinary', sessionId: base.id }, child: { id: 'child', sessionId: 'shop' } }, deleteAttempts: {}, commerce: JSON.stringify({ tasks: { a: { sessionId: base.id, scene: 'xhs-poster', runs: [] }, b: { sessionId: 'shop', scene: 'product-set', runs: [{ items: [{ batchId: 'child' }] }] } } }) };
    const gateway = new MockWorkspaceGateway({ storage: { getItem: (key) => key === MOCK_STORAGE_KEY ? JSON.stringify({ version: 2, state }) : null, setItem: vi.fn() } });
    expect((await gateway.listSessions()).map(s => s.activityTypes)).toEqual([['image', 'poster'], ['commerce']]);
  });
  it('keeps an empty persisted session in chat regardless of its title', async () => {
    const gateway = new MockWorkspaceGateway();
    const session = await gateway.createSession('电商生图 小红书海报');
    expect((await gateway.listSessions()).find(s => s.id === session.id)?.activityTypes).toEqual(['chat']);
  });
  it('uses one owner-scoped bulk RPC and maps activity metadata', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: base.id, title: base.title, status: base.status, created_at: base.createdAt, updated_at: base.updatedAt, activity_types: ['poster'] }], error: null });
    const store = new SupabaseSessionStore({ rpc } as unknown as SupabaseClient);
    expect((await store.list('owner'))[0]?.activityTypes).toEqual(['poster']);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('list_sessions_with_activity', { p_user_id: 'owner' });
  });
  it.each(['PGRST202', '42883'])('falls back to owned legacy sessions only when summary RPC is missing (%s)', async (code) => {
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn().mockResolvedValue({ data: [{ id: base.id, title: base.title, status: base.status, created_at: base.createdAt, updated_at: base.updatedAt }], error: null }) };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const tasks = { select: vi.fn(), eq: vi.fn(), in: vi.fn().mockResolvedValue({ data: [{ session_id: base.id }], error: null }) };
    tasks.select.mockReturnValue(tasks); tasks.eq.mockReturnValue(tasks);
    const from = vi.fn((table) => table === 'commerce_tasks' ? tasks : query);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message: 'function public.list_sessions_with_activity does not exist' } });
    const store = new SupabaseSessionStore({ rpc, from } as unknown as SupabaseClient);
    const sessions = await store.list('owner');
    expect(sessions[0]?.activityTypes).toEqual(['commerce']);
    expect(sessions[0]?.id).toBe(base.id);
    expect(from.mock.calls).toEqual([['sessions'], ['commerce_tasks']]);
    expect(tasks.eq).toHaveBeenCalledWith('user_id', 'owner');
    expect(tasks.in).toHaveBeenCalledWith('session_id', [base.id]);
    expect(query.eq.mock.calls).toEqual([['user_id', 'owner'], ['status', 'active']]);
  });
  it.each(['42501', 'PGRST000', 'XX000', '42883'])('does not mask permission, network, or internal RPC failures (%s)', async (code) => {
    const from = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message: 'unrelated internal error' } });
    const store = new SupabaseSessionStore({ rpc, from } as unknown as SupabaseClient);
    await expect(store.list('owner')).rejects.toMatchObject({ code: 'network', status: 503 });
    expect(from).not.toHaveBeenCalled();
  });

});
