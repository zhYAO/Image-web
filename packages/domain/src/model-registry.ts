import { OFFICIAL_SKILLS } from './official-skills';
import type { ProviderCapability } from './types';

export const MODEL_REGISTRY_VERSION = '2026-10-12.1';
export const IMAGE_MODEL_UPGRADE_MESSAGE = '所选图片模型已停止新生成，请主动更新为 Seedream 5.0 Pro 并保存新版本。';

export const CHAT_PROVIDER_MODELS = [
  { id: 'doubao', label: '豆包', provider: 'doubao' },
  { id: 'minimax', label: 'MiniMax', provider: 'minimax' },
] as const;

export const IMAGE_PROVIDER_CAPABILITIES: ProviderCapability[] = [
  {
    models: [{
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      id: 'doubao-seedream-5.0-pro',
      label: 'Seedream 5.0 Pro',
      maxImages: 4,
      maxReferences: 10,
      resolutions: ['2K'],
    }],
    provider: 'seedream',
  },
];

// Compatibility name retained for existing mock fixtures; content is the Phase 2 registry.
export { OFFICIAL_SKILLS as PHASE1_SKILLS } from './official-skills';

export function resolveImageModel(input: { model?: string; provider?: string }) {
  if ((input.provider === 'seedream' && ['seedream-4.5', 'seedream-5.0-flash', 'seedream-5.0-pro'].includes(input.model ?? ''))
    || (input.provider === 'gemini' && input.model === 'gemini-3-pro-image')) {
    throw new Error(IMAGE_MODEL_UPGRADE_MESSAGE);
  }
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
  const skill = OFFICIAL_SKILLS.find((candidate) => candidate.id === skillId);
  if (!skill) throw new Error('不支持的技能版本。');
  return skill;
}
