import type { ProviderCapability, Skill } from './types';

export const MODEL_REGISTRY_VERSION = '2026-08-24.1';

export const CHAT_PROVIDER_MODELS = [
  { id: 'doubao', label: '豆包', provider: 'doubao' },
  { id: 'minimax', label: 'MiniMax', provider: 'minimax' },
] as const;

export const IMAGE_PROVIDER_CAPABILITIES: ProviderCapability[] = [
  {
    models: [{
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      id: 'gemini-3-pro-image',
      label: 'Gemini 3 Pro Image',
      maxImages: 4,
      resolutions: ['1K', '2K'],
    }],
    provider: 'gemini',
  },
  {
    models: [{
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      id: 'seedream-4.5',
      label: 'Seedream 4.5',
      maxImages: 4,
      resolutions: ['1K', '2K'],
    }],
    provider: 'seedream',
  },
];

export const PHASE1_SKILLS: Skill[] = [
  {
    coverImageUrl: '/skills/white-background.webp',
    description: '干净背景与清晰商品轮廓',
    fields: [{ key: 'product', label: '商品名称', required: true, placeholder: '例如：羊毛大衣' }],
    icon: '◇',
    id: 'white-background',
    name: '白底图',
    promptTemplate: '为 {product} 生成专业电商白底图',
    requiresImageTool: true,
    version: '1.0.0',
  },
  {
    coverImageUrl: '/skills/model.webp',
    description: '自然姿态与真实穿着效果',
    fields: [{ key: 'style', label: '模特风格', required: true, placeholder: '例如：都市简约' }],
    icon: '◉',
    id: 'model',
    name: '模特图',
    promptTemplate: '生成 {style} 风格的模特展示图',
    requiresImageTool: true,
    version: '1.0.0',
  },
  {
    coverImageUrl: '/skills/social.webp',
    description: '生活化构图与社媒氛围',
    fields: [{ key: 'scene', label: '使用场景', required: true, placeholder: '例如：周末咖啡馆' }],
    icon: '✦',
    id: 'social',
    name: '种草图',
    promptTemplate: '生成 {scene} 中的生活方式种草图',
    requiresImageTool: true,
    version: '1.0.0',
  },
];

export function resolveImageModel(input: { model?: string; provider?: string }) {
  const provider = input.provider ?? IMAGE_PROVIDER_CAPABILITIES[0]?.provider;
  const capability = IMAGE_PROVIDER_CAPABILITIES.find((candidate) => candidate.provider === provider);
  const model = input.model ?? capability?.models[0]?.id;
  const modelCapability = capability?.models.find((candidate) => candidate.id === model);
  if (!provider || !model || !modelCapability) {
    throw new Error('不支持的图片 provider/model 组合。');
  }
  return { capability: modelCapability, model, provider };
}

export function resolveSkill(skillId?: string) {
  if (!skillId) return undefined;
  const skill = PHASE1_SKILLS.find((candidate) => candidate.id === skillId);
  if (!skill) throw new Error('不支持的技能版本。');
  return skill;
}
