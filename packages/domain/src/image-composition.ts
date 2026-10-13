import type { AspectRatio } from './types';

/** Prompt guidance only: it cannot verify anatomy or repair missing source pixels. */
export function kneeFramingGuidance(instruction: string, aspectRatio: AspectRatio): string {
  const ranges = /(?:头(?:顶|部)?|上身)\s*(?:到|至)\s*膝盖|\bhead[ -]+to[ -]+knees?\b/gi;
  const requested = [...instruction.matchAll(ranges)].some(match => {
    const prefix = instruction.slice(0, match.index).slice(-30).replace(/[“"‘']\s*$/, '');
    const suffix = instruction.slice(match.index! + match[0].length).replace(/^\s*[”"’']/, '');
    // Quoted artwork copy is not a photographic request. Keep quoted framing
    // requests, and handle direct negation on either side of the range phrase.
    if (/(?:只写|写上|写入|写成|文字|文案|标题|text|title|caption)[^，。；\n]{0,12}$|写(?:准确)?(?:中文|英文)?\s*$/i.test(prefix)) return false;
    return !/(?:不要|不需要|无需|不用|避免|不采用|不使用|不是)(?:用|采用|使用)?\s*$|(?:do not|don't|no|avoid)(?:\s+(?:use|want|show))?\s*$/i.test(prefix)
      && !/^\s*(?:构图|取景|framing)?\s*(?:不要|不需要|不用|不采用|不使用)/i.test(suffix);
  });
  if (!requested) return '';
  return `取景硬约束（${aspectRatio}）：以本张用户最终取景要求为准；如明确要求头到膝盖或上身至膝盖，双膝完整可见，下边界在膝盖下方保留缓冲，不能停在大腿。要求包含头部时头顶也须完整。先后退镜头或缩小人物占比，再安排留白与文字；人物占比与模板冲突时优先满足取景，不以放大人物填满画面。用户否定到膝或明确改成其他取景时遵循新范围。保持商品结构完整，不裁切商品来凑构图。`;
}

/** Percentages describe the requested canvas bounds, not measured output bounds. */
export function commerceSafeAreaGuidance(marginPercent: number): string {
  return `全画布安全区：左右各至少画布宽度的${marginPercent}%，上下各至少画布高度的${marginPercent}%；商品整体、全部特写模块及其边框、文字均放在横向${marginPercent}%–${100 - marginPercent}%、纵向${marginPercent}%–${100 - marginPercent}%范围内，不能只给文字留白。用户要求更大留白时采用更大值。缩小或重新安排模块以留足距离，不裁切商品，也不牺牲已指定的取景范围。背景可铺满画布，不把安全区坐标或辅助线画进成品。`;
}
