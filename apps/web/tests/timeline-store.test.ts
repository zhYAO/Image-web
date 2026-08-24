import { describe, expect, it } from 'vitest';

import { mapTimelineRows } from '@/server/timeline/supabase-timeline-store';

describe('Supabase timeline mapping', () => {
  it('restores messages and generation snapshots in stable sequence order', () => {
    const sessionId = '10000000-0000-4000-8000-0000000000a1';
    const batchId = '30000000-0000-4000-8000-0000000000a1';
    const items = mapTimelineRows([
      {
        batch: {
          assets: [{
            asset_expires_at: null,
            asset_status: null,
            error_code: null,
            id: '40000000-0000-4000-8000-0000000000a1',
            status: 'pending',
          }],
          config: { aspectRatio: '16:9', count: 1, resolution: '2K' },
          created_at: '2026-08-24T00:00:01.000Z',
          id: batchId,
          model: 'gemini-3-pro-image',
          prompt: '商品图',
          provider: 'gemini',
          session_id: sessionId,
          source: 'direct',
          status: 'pending',
        },
        batch_id: batchId,
        created_at: '2026-08-24T00:00:01.000Z',
        error_code: null,
        id: '20000000-0000-4000-8000-000000000002',
        kind: 'generation',
        role: null,
        sequence: 2,
        session_id: sessionId,
        status: 'pending',
        text: null,
      },
      {
        batch: null,
        batch_id: null,
        created_at: '2026-08-24T00:00:00.000Z',
        error_code: null,
        id: '20000000-0000-4000-8000-000000000001',
        kind: 'message',
        role: 'user',
        sequence: 1,
        session_id: sessionId,
        status: 'completed',
        text: '你好',
      },
    ]);

    expect(items.map((item) => item.sequence)).toEqual([1, 2]);
    expect(items[1]).toMatchObject({
      batch: {
        config: { aspectRatio: '16:9', count: 1, resolution: '2K' },
        model: 'gemini-3-pro-image',
        provider: 'gemini',
      },
      type: 'generation',
    });
  });
});
