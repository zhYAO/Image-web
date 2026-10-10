import { render, screen } from '@testing-library/react';
import { COMMERCE_PRIMARY_SCENE_IDS, COMMERCE_SCENES, commerceSceneSchema } from '@zimage/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceRoute } from '@/features/workspace/workspace-route';
import { CommerceCatalogue } from '@/features/commerce/CommerceCatalogue';
import { CommerceHeader, CommerceNav } from '@/features/commerce/CommerceChrome';

const boundary = vi.hoisted(() => ({ server: vi.fn(), admin: vi.fn(), create: vi.fn(), advance: vi.fn(), worker: vi.fn(), list: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: boundary.server }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: boundary.admin }));
vi.mock('@/server/commerce/commerce-batch-service', () => ({ createCreativeBatch: boundary.create, advanceCreativeBatch: boundary.advance, runCreativeBatchWorker: boundary.worker, listCreativeBatches: boundary.list, getCreativeBatch: boundary.get }));
vi.mock('@/features/credits/CreditsProvider', () => ({ CreditBalance: () => <span>积分</span> }));
vi.mock('@/features/auth/AuthStatusProvider', () => ({ useAuthStatus: () => ({ status: 'authenticated' }) }));
vi.mock('@/server/route-context', () => ({ executeRoute: async (fn: (id: string) => unknown) => fn('test'), assertTrustedOrigin: () => undefined, readJson: async () => ({}), requireVerifiedUserId: async () => 'owner' }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_HTTP_ERROR_FALLBACK;404'); } }));
import CommercePage from '@/app/create/[scene]/page';
import { POST as createPost, GET as listGet } from '@/app/api/creative-batches/route';
import { GET as historyGet, POST as advancePost } from '@/app/api/creative-batches/[id]/route';
import { POST as workerPost } from '@/app/api/internal/creative-batch-worker/route';

beforeEach(() => vi.clearAllMocks());

describe('retired multi-product batch entry', () => {
  it('rejects both old launcher URLs while retaining historical batch addresses', async () => {
    expect(commerceSceneSchema.safeParse('batch').success).toBe(false);
    expect(workspaceRoute('/create/batch')).toEqual({ kind: 'invalid' });
    expect(workspaceRoute('/', '?scene=batch')).toEqual({ kind: 'invalid' });
    await expect(CommercePage({ params: Promise.resolve({ scene: 'batch' }) })).rejects.toThrow('404');
    expect(workspaceRoute('/sessions/session-1', '?batch=legacy-1')).toMatchObject({ kind: 'session', sessionId: 'session-1', batchId: 'legacy-1' });
    for (const scene of ['product-set', 'detail', 'clone']) expect(workspaceRoute(`/create/${scene}`)).toMatchObject({ kind: 'commerce', scene });
  });

  it('removes the batch launcher from catalogue, header and tool navigation', () => {
    render(<><CommerceHeader /><CommerceNav /><CommerceCatalogue /></>);
    expect(COMMERCE_PRIMARY_SCENE_IDS).toHaveLength(5);
    expect(COMMERCE_SCENES.some(scene => String(scene.id) === 'batch')).toBe(false);
    expect(screen.queryByRole('link', { name: /批量生成/ })).toBeNull();
    expect(screen.getAllByRole('link').some(link => link.getAttribute('href') === '/create/batch')).toBe(false);
  });

  it('returns Gone from batch creation before authentication or database access', async () => {
    boundary.create.mockResolvedValue({ id: 'legacy' });
    boundary.advance.mockResolvedValue({ id: 'legacy' });
    const response = await createPost();
    expect(response.status).toBe(410);
    expect(response.headers.get('cache-control')).toContain('no-store');
    for (const call of [boundary.server, boundary.admin, boundary.create, boundary.advance, boundary.worker]) expect(call).not.toHaveBeenCalled();
  });

  it('keeps authenticated history list and detail reads available', async () => {
    const id = crypto.randomUUID();
    boundary.list.mockResolvedValue([{ id }]);
    boundary.get.mockResolvedValue({ id });
    expect((await listGet(new Request(`http://localhost/api/creative-batches?sessionId=${id}`))).status).toBe(200);
    expect((await historyGet(new Request('http://localhost'), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(boundary.list).toHaveBeenCalled();
    expect(boundary.get).toHaveBeenCalled();
  });

  it('returns Gone from browser advancement without authenticating or submitting existing items', async () => {
    boundary.advance.mockResolvedValue({ id: 'legacy' });
    const response = await advancePost();
    expect(response.status).toBe(410);
    for (const call of [boundary.server, boundary.admin, boundary.create, boundary.advance]) expect(call).not.toHaveBeenCalled();
  });

  it('returns Gone from the dedicated worker before claiming or submitting paused items', async () => {
    const response = await workerPost();
    expect(response.status).toBe(410);
    for (const call of [boundary.admin, boundary.create, boundary.advance, boundary.worker]) expect(call).not.toHaveBeenCalled();
  });
});
