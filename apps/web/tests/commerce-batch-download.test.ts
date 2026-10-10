import { buildCommerceSlots } from '@zimage/domain';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: boundary.user }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: boundary.admin }));
vi.mock('@/server/observability', () => ({ reportServerError: vi.fn() }));
import { POST } from '@/app/api/creative-batches/[id]/download/route';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const userId = uuid(1), sessionId = uuid(2), batchId = uuid(3), taskId = uuid(4);
const reportName = '导出说明.json';
const privateDiagnostic = 'private-storage-path private-prompt signed-secret diagnostic';
type Failure = 'http-404' | 'network' | 'invalid-image' | 'expired' | 'signing' | 'oversize' | 'manifest-missing';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://storage.test');
  boundary.user.mockResolvedValue({ rpc: async () => ({ data: userId, error: null }) });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function fixture(options: { failure?: Failure; allExpired?: boolean; noTask?: boolean;
  noSelections?: boolean; taskUnavailable?: boolean; wrongOwner?: boolean; inactiveSession?: boolean } = {}) {
  const brief = { name: '测试杯子', description: privateDiagnostic, facts: '', sellingPoints: '',
    platform: 'taobao' as const, placement: '商品展示', productReferenceIds: [uuid(30)], styleReferenceIds: [] };
  const plan = { scene: 'product-set' as const, brief, templateId: 'soft-studio',
    slots: buildCommerceSlots(brief, 'product-set', 2, {
      provider: 'gemini', model: 'gemini-3-pro-image', aspectRatio: '1:1', resolution: '2K',
    }).map((slot, index) => ({ ...slot, id: uuid(10 + index) })) };
  const task = { ...plan, id: taskId, sessionId, revision: 1, createdAt: '2026-10-10',
    updatedAt: '2026-10-10', runs: [], selections: options.noSelections ? [] : plan.slots.map((slot, index) =>
      ({ slotId: slot.id, generationId: uuid(20 + index), compatibilityHash: 'hash', version: 1 })) };
  const manifest = { id: taskId, revision: 1, createdAt: '2026-10-10',
    items: task.selections.filter((_selection, index) => options.failure !== 'manifest-missing' || index !== 1) };
  const row = { id: batchId, user_id: options.wrongOwner ? uuid(99) : userId, session_id: sessionId,
    request_id: uuid(50), workflow: 'product-set', global_params: {},
    items: [{ id: uuid(40), createRequestId: uuid(51), submitRequestId: uuid(52), plan,
      overrides: {}, ...(options.noTask ? {} : { taskId }), status: 'submitted' }],
    created_at: '2026-10-10', updated_at: '2026-10-10' };
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#dddddd' } }).png().toBuffer();
  const admin = {
    async rpc(_name: string, args: Record<string, unknown>) {
      if (options.taskUnavailable) return { data: null, error: { message: `not_found ${privateDiagnostic}` } };
      return { data: args.p_operation === 'get' ? task : manifest, error: null };
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        maybeSingle: async () => ({ data: table === 'sessions'
          ? !options.inactiveSession && filters.user_id === userId && filters.status === 'active' ? { id: sessionId } : null
          : filters.user_id === row.user_id ? row : null, error: null }),
        single: async () => ({ data: { storage_bucket: 'generated',
          storage_path: filters.id === uuid(20) ? '0.png' : '1.png',
          asset_status: options.allExpired || options.failure === 'expired' && filters.id === uuid(21) ? 'expired' : 'active',
          asset_expires_at: null }, error: null }),
      };
      return query;
    },
    storage: { from: () => ({ createSignedUrl: async (source: string) =>
      options.failure === 'signing' && source === '1.png'
        ? { data: null, error: { message: privateDiagnostic } }
        : { data: { signedUrl: `https://storage.test/storage/v1/object/sign/generated/${source}?token=signed-secret` }, error: null } }) },
  };
  boundary.admin.mockReturnValue(admin);
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const second = new URL(String(input)).pathname.endsWith('/1.png');
    if (second && options.failure === 'network') throw new TypeError(privateDiagnostic);
    if (second && options.failure === 'http-404') return new Response(privateDiagnostic, { status: 404 });
    if (second && options.failure === 'oversize') return new Response(png, { headers: { 'content-length': String(20 * 1024 * 1024 + 1) } });
    return new Response(second && options.failure === 'invalid-image' ? privateDiagnostic : png);
  });
  vi.stubGlobal('fetch', fetcher);
  return { task, fetcher };
}

function request() {
  return new Request(`https://app.test/api/creative-batches/${batchId}/download`, {
    method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 'jpg' }),
  });
}
async function download() {
  return POST(request(), { params: Promise.resolve({ id: batchId }) });
}

// Decode STORE entries for route assertions. Independent zipfile/unzip validation
// of generated evidence also checks the standard directory and CRCs.
async function entries(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/zip');
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.readUInt32LE(bytes.length - 22)).toBe(0x06054b50);
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    files.set(name, bytes.subarray(start, start + length));
    offset = start + length;
  }
  expect(files.size).toBe(bytes.readUInt16LE(bytes.length - 12));
  return files;
}
function report(files: Map<string, Uint8Array>) {
  expect(files.has(reportName)).toBe(true);
  const text = new TextDecoder().decode(files.get(reportName));
  for (const privateValue of privateDiagnostic.split(' ')) expect(text).not.toContain(privateValue);
  expect(text).not.toContain('https://storage.test');
  return JSON.parse(text);
}

describe('historical commerce batch ZIP export', () => {
  it('keeps complete successful exports in their original ordered UTF-8 directories', async () => {
    await fixture();
    const files = await entries(await download());
    expect([...files.keys()]).toEqual(['商品-01/01.jpg', '商品-01/02.jpg']);
    for (const bytes of files.values()) expect(await sharp(bytes).metadata()).toMatchObject({ width: 4, height: 4, format: 'jpeg' });
  });
  it.each([
    ['http-404', 'source_unavailable'],
    ['network', 'source_download_failed'],
    ['invalid-image', 'invalid_image'],
    ['expired', 'asset_expired'],
    ['signing', 'source_unavailable'],
    ['oversize', 'source_too_large'],
    ['manifest-missing', 'selection_unavailable'],
  ] as const)('keeps the valid image and explains a second image omitted for %s', async (failure, reason) => {
    await fixture({ failure });
    const files = await entries(await download());
    expect([...files.keys()]).toEqual(['商品-01/01.jpg', reportName]);
    expect(report(files)).toMatchObject({ version: 1, status: 'partial', exportedImageCount: 1,
      message: '已导出可用图片，部分图片未能导出，请查看遗漏说明。',
      omissions: [{ productIndex: 1, taskId, slotId: uuid(11), reason, message: expect.any(String) }] });
  });
  it('explains a zero-image export when every selected asset is expired', async () => {
    await fixture({ allExpired: true });
    const files = await entries(await download());
    expect([...files.keys()]).toEqual([reportName]);
    expect(report(files)).toMatchObject({ status: 'empty', exportedImageCount: 0,
      message: '当前没有可导出的有效图片。', omissions: [
        { productIndex: 1, taskId, slotId: uuid(10), reason: 'asset_expired' },
        { productIndex: 1, taskId, slotId: uuid(11), reason: 'asset_expired' },
      ] });
  });
  it.each([
    [{ noTask: true }, 'task_unavailable'],
    [{ noSelections: true }, 'no_selected_images'],
    [{ taskUnavailable: true }, 'task_unavailable'],
  ] as const)('explains a historical item without downloadable selections: %s', async (options, reason) => {
    await fixture(options);
    const files = await entries(await download());
    expect([...files.keys()]).toEqual([reportName]);
    expect(report(files)).toMatchObject({ status: 'empty', exportedImageCount: 0,
      omissions: [{ productIndex: 1, reason }] });
  });
  it.each([{ wrongOwner: true }, { inactiveSession: true }])('rejects an inaccessible parent before starting a ZIP: %s', async options => {
    const { fetcher } = await fixture(options);
    const response = await download();
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ code: 'not_found' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
