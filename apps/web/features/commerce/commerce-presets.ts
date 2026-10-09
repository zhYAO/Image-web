import type { CommerceSlot, ProviderCapability } from '@zimage/domain';
import { normalizeGenerationSelection } from '@/features/workspace/GenerationConfig';

export type CommerceGenerationSettings = Pick<CommerceSlot, 'provider' | 'model' | 'aspectRatio' | 'resolution'>;

export function commerceGenerationPreset(capabilities: ProviderCapability[]): CommerceGenerationSettings {
  const value = normalizeGenerationSelection(capabilities, { aspectRatio: '1:1', resolution: '2K', count: 1 });
  return { provider: value.provider ?? 'gemini', model: value.model ?? 'gemini-3-pro-image', aspectRatio: value.aspectRatio, resolution: value.resolution };
}

export function hasCommerceModel(capabilities: ProviderCapability[], settings: CommerceGenerationSettings) {
  return capabilities.some(item => item.provider === settings.provider && item.models.some(model => model.id === settings.model));
}
