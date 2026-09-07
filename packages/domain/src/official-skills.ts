import type { Skill } from './types';

/** Public, versioned product content. Execution instructions belong on the server. */
export const OFFICIAL_SKILLS: Skill[] = [
  {
    id: 'white-background', name: '白底图', icon: '◇', version: '2.0.0', requiresImageTool: true,
    description: '以商品为主体，生成干净白背景的电商图片。',
    defaults: '纯白背景、商品居中、柔和自然光、保留轻微接触阴影。',
    suggestedInput: '上传商品参考图，或描述商品类别、颜色、材质与主要外观。',
    output: '适合商品列表、主图和产品目录的图片。',
    limitations: '未提供参考图时仅按文字创作，不代表对现有商品的还原。细节与文字标识需人工核验。',
  },
  {
    id: 'model', name: '模特图', icon: '◉', version: '2.0.0', requiresImageTool: true,
    description: '让商品自然穿着或展示在模特场景中。',
    defaults: '成年模特、自然站姿、简洁影棚背景、柔和光线，重点展示商品。',
    suggestedInput: '上传商品参考图，或描述商品类别与主要外观；可补充模特方向和姿势。',
    output: '展示商品穿着或持用效果的模特图片。',
    limitations: '未提供参考图时仅按文字创作，不代表对现有商品的还原。不能保证真实尺码与试穿效果。',
  },
  {
    id: 'social', name: '种草图', icon: '✦', version: '2.0.0', requiresImageTool: true,
    description: '让商品融入生活方式场景，形成适合社交媒体的视觉。',
    defaults: '明亮室内日常场景、自然光、简洁生活化构图、不添加营销文字。',
    suggestedInput: '上传商品参考图，或描述商品类别与主要外观；可补充生活场景和视觉风格。',
    output: '适合社交媒体展示的生活方式商品图片。',
    limitations: '未提供参考图时仅按文字创作，不代表对现有商品的还原。图片不构成商品功效或真实性证明。',
  },
];
