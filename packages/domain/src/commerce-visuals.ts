export interface CommerceVisual {
  guidance: string;
  scenes: string[];
  previewRole: string;
  previewAspect: '1:1' | '3:4';
  safeMarginPercent: number;
}
const series = ['product-set', 'detail', 'style-reference'];
const visual = (guidance: string, scenes: string[], previewRole: string, previewAspect: '1:1' | '3:4' = '1:1', safeMarginPercent = 8): CommerceVisual => ({ guidance, scenes, previewRole, previewAspect, safeMarginPercent });
export const VISUAL_DIRECTIONS: Record<string, CommerceVisual> = {
  'white-main': visual('纯白无缝背景，商品占75%，居中完整轮廓；右上柔光，真实接触阴影；无文字无边框，四边12%留白。', ['product-main', ...series], '商品主图', '1:1', 12),
  'soft-studio': visual('暖灰白背景，奶油白与石灰色主辅色；柔和左侧窗光、细腻哑光纹理；主体居中偏右占65%，左上保留标题区，深灰无衬线字体；边距8%，安静克制。', ['model', ...series], '核心卖点'),
  'material-detail': visual('暖灰微距摄影，主细节占70%，右下一个小型整体定位图；侧向柔光呈现可见纹理；细黑无衬线说明置底部，边距8%；不虚构剖面。', series, '材质细节'),
  'selling-point': visual('米白与淡蓝双层背景，商品占60%位于右侧；左侧大标题及最多三个垂直卖点，深蓝粗体标题、深灰说明；柔光与接触阴影，边距8%。', series, '核心卖点'),
  'spec-layout': visual('纯白底深灰字，左侧50%整体商品，右侧对齐两至三个事实模块，浅灰细线分隔；正面柔光，规范无衬线排版，边距10%；仅使用提供的参数。', series, '商品说明', '1:1', 10),
  'daily-scene': visual('暖白与天然木色生活摄影，商品占55%位于前景，背景为真实适用环境；侧窗自然光、真实接触关系；文字只在上方留白，细黑无衬线，边距8%。', ['social', ...series], '使用场景'),
  'handheld': visual('暖米色背景，成年人的手自然展示商品，占画面65%，不遮挡主体；浅景深、自然窗光与真实皮肤纹理；上方留白20%，小号深灰标题，边距8%。', ['model', 'social', ...series], '模特展示'),
  'brand-hero': visual('深石墨渐变背景，商品占65%置于下部中央；侧面轮廓光突出真实材质，暖白大字标题位于顶部，金色仅作细线点缀；边距10%，不添加未知品牌。', series, '详情首屏', '1:1', 10),
  'social-cover': visual('暖白与鼠尾草绿自然桌面摄影，主体占60%偏下，顶部左对齐短标题；细黑无衬线搭配少量手写标注，方向自然光；边距8%，无平台界面。', ['social', ...series], '种草封面', '3:4'),
  'lifestyle-collage': visual('奶油白纸质背景，三块摄影拼贴：主画面60%、两块同款细节20%；黑色杂志标题，橄榄绿小色块，错落但严格留白；边距8%，无重叠正文。', ['social', ...series], '种草封面', '3:4'),
  'detail-hero': visual('暖米白背景，商品主视觉位于下部占65%；顶部黑色衬线大标题与细灰副标题，细线建立层次；柔和侧光、细腻真实材质，边距8%。', series, '详情首屏', '3:4'),
  'detail-module': visual('暖白底，顶部标题区与下方三个等宽信息模块；商品整体与两处细节占60%，深灰无衬线字、浅米灰分隔；一致左侧柔光，边距8%。', series, '商品说明', '3:4'),
  'xhs-fresh': visual('鼠尾草绿与暖白配色，自然窗光产品或生活摄影；主视觉占下部60%，顶部左对齐黑色清爽大标题，薄荷绿小标签；边距8%，留白25%，不画App。', ['xhs-poster'], '海报封面', '3:4'),
  'xhs-collage': visual('暖奶油纸纹，黑色杂志衬线大标题；一大两小的生活摄影拼贴，图片间12px感留白；橄榄绿细小点缀，暖自然光，边距8%；主视觉占60%。', ['xhs-poster'], '海报封面', '3:4'),
  'xhs-minimal': visual('暖白纯净背景，巨幅深黑无衬线标题占上半部；下方一个极简静物或小插图占25%，朱红短线点缀；左对齐、35%留白，边距10%，不用卡片边框。', ['xhs-poster'], '海报封面', '3:4', 10),
  'xhs-sketch': visual('奶油色纸底，马卡龙蓝、薄荷绿与桃色手绘模块；自然微抖线条，黑色清楚手写风标题，3个图解分区各配小插图；留白20%，边距8%，正文保持印刷般可读。', ['xhs-poster'], '海报封面', '3:4'),
  'xhs-checklist': visual('米白纸底、深墨黑无衬线标题，橙色编号；标题下竖直对齐3至5项清单，每项一个线描图标与短句；浅灰细线分隔，边距10%，留白25%，不堆砌装饰。', ['xhs-poster'], '海报封面', '3:4', 10),
  'xhs-retro': visual('复古丝网印刷海报，奶油白、砖红与深海军蓝三色，轻微网点纸纹；大幅凝练标题占上部40%，下方象征性扁平插画；强对比、边距8%，只使用准确文案。', ['xhs-poster'], '海报封面', '3:4'),
};
