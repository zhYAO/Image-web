import type { CommerceTask } from '@zimage/domain';

export const COMMERCE_SAFE_EXPORT_NOTICE = '导出点击时选中的版本：保持原画布尺寸，整图（含文字）等比缩小至约 84%，居中补白，四边至少留白 8%；不能补回缺失内容。';

export function canExportCommerceSafePng(task: CommerceTask, slotId: string) {
  const slot = task.slots.find(entry => entry.id === slotId);
  const selection = task.selections.find(entry => entry.slotId === slotId);
  return Boolean(task.templateId === 'detail-module' && slot &&
    slot.outputSpec === undefined && slot.targetWidth === undefined && slot.targetHeight === undefined &&
    selection && task.runs.some(run => run.items.some(item => item.slotId === slotId &&
      item.generationId === selection.generationId && item.status === 'succeeded' && !item.expired)));
}
