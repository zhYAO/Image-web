import type { CommerceTask } from '@zimage/domain';

export const safeExportIds = {
  user: '00000000-0000-4000-8000-000000000001',
  task: '00000000-0000-4000-8000-000000000002',
  slot: '00000000-0000-4000-8000-000000000003',
  generation: '00000000-0000-4000-8000-000000000004',
  request: '00000000-0000-4000-8000-000000000005',
};

// Synthetic task only: no paid generation or production asset is involved.
export function safeExportTask(): CommerceTask {
  return {
    id: safeExportIds.task, sessionId: 'synthetic-session', revision: 1,
    createdAt: '2026-10-14', updatedAt: '2026-10-14', archived: false,
    scene: 'social', templateId: 'detail-module', slotHashes: {},
    brief: { name: '合成夹具', facts: '', sellingPoints: '', platform: 'taobao', placement: '细节说明', productReferenceIds: [], styleReferenceIds: [] },
    slots: [{ id: safeExportIds.slot, role: '细节', instruction: '', exactText: '', referenceIds: [], provider: 'seedream', model: 'doubao-seedream-5.0-pro', aspectRatio: '3:4', resolution: '2K' }],
    selections: [{ slotId: safeExportIds.slot, generationId: safeExportIds.generation, compatibilityHash: 'synthetic', version: 1 }],
    runs: [{ id: safeExportIds.request, requestId: safeExportIds.request, revision: 1, createdAt: '2026-10-14', items: [{ slotId: safeExportIds.slot, batchId: safeExportIds.request, generationId: safeExportIds.generation, status: 'succeeded', expired: false, compatibilityHash: 'synthetic', selectionVersion: 1 }] }],
  };
}
