import { ActionButton, StatusBadge, TextArea } from '@/features/controls/NativeControls';
import { GlideSelect } from '@/features/controls/GlideSelect';
import { ModelCreditPrice } from '@/features/credits/CreditsProvider';
import {
  CHAT_PROVIDER_MODELS,
  type AspectRatio,
  type ImageResolution,
  type ProviderCapability,
  type ProviderHealth,
  type Skill,
} from '@zimage/domain';

import { Check, ChevronDown, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { zhCN } from '@/i18n';

import styles from './workspace.module.css';

export type ModelCapability = ProviderCapability['models'][number];

export interface GenerationSelection {
  aspectRatio: AspectRatio;
  count: number;
  model?: string;
  provider?: string;
  resolution: ImageResolution;
}

export function findModelCapability(
  capabilities: ProviderCapability[],
  provider?: string,
  modelId?: string,
) {
  const providerCapability = provider ? capabilities.find((item) => item.provider === provider) : capabilities[0];
  const model = modelId ? providerCapability?.models.find((item) => item.id === modelId) : providerCapability?.models[0];
  return providerCapability && model ? { model, provider: providerCapability.provider } : undefined;
}

export function normalizeGenerationSelection(
  capabilities: ProviderCapability[],
  selection: GenerationSelection,
): GenerationSelection {
  const resolved = findModelCapability(capabilities, selection.provider, selection.model);
  if (!resolved) return selection;
  const { model, provider } = resolved;
  const aspectRatio = model.aspectRatios.includes(selection.aspectRatio)
    ? selection.aspectRatio
    : (model.aspectRatios[0] ?? '1:1');
  const resolution = model.resolutions.includes(selection.resolution)
    ? selection.resolution
    : model.resolutions.includes('2K')
      ? '2K'
      : (model.resolutions[0] ?? '1K');
  return {
    aspectRatio,
    count: Math.max(1, Math.min(selection.count, model.maxImages, 4)),
    model: model.id,
    provider,
    resolution,
  };
}

interface PopoverShellProps {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  trigger: ReactNode;
}

function PopoverShell({ ariaLabel, children, className, onOpenChange, open, trigger }: PopoverShellProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
        rootRef.current?.querySelector('button')?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onOpenChange, open]);

  return (
    <div className={styles.popoverAnchor} ref={rootRef}>
      {trigger}
      {open && (
        <section
          aria-label={ariaLabel}
          aria-modal="false"
          className={`${styles.popoverSurface} ${className ?? ''}`}
          role="dialog"
        >
          <button aria-label={`关闭${ariaLabel}`} className={styles.popoverClose} ref={closeRef} type="button" onClick={() => {
            onOpenChange(false);
            rootRef.current?.querySelector('button')?.focus({ preventScroll: true });
          }}><X aria-hidden size={16} /></button>
          {children}
        </section>
      )}
    </div>
  );
}

const ratioShape: Record<AspectRatio, { height: number; width: number }> = {
  '1:1': { height: 20, width: 20 },
  '3:4': { height: 22, width: 17 },
  '4:3': { height: 17, width: 22 },
  '9:16': { height: 24, width: 14 },
  '16:9': { height: 14, width: 24 },
};

interface GenerationParameterPopoverProps {
  aspectRatio: AspectRatio;
  count?: number;
  model?: ModelCapability;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  onCountChange?: (count: number) => void;
  onOpenChange: (open: boolean) => void;
  onResolutionChange: (resolution: ImageResolution) => void;
  open: boolean;
  resolution: ImageResolution;
}

export function GenerationParameterPopover({
  aspectRatio,
  model,
  onAspectRatioChange,
  onOpenChange,
  onResolutionChange,
  open,
  resolution,
}: GenerationParameterPopoverProps) {
  return (
    <PopoverShell
      ariaLabel="生成参数"
      className={styles.parameterPopover}
      onOpenChange={onOpenChange}
      open={open}
      trigger={(
        <ActionButton
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`生成参数 ${aspectRatio} ${resolution}`}
          className={`${styles.toolbarButton} ${open ? styles.toolbarButtonActive : ''}`}
          icon={<SlidersHorizontal size={15} />}
          onClick={() => onOpenChange(!open)}
        >
          {resolution}<span className={styles.toolbarDivider} />{aspectRatio}
        </ActionButton>
      )}
    >
      <div className={styles.popoverSection}>
        <div className={styles.popoverLabel}>选择比例</div>
        <div className={styles.ratioOptions}>
          {model?.aspectRatios.map((ratio) => (
            <button
              aria-label={`比例 ${ratio}`}
              aria-pressed={aspectRatio === ratio}
              className={`${styles.ratioOption} ${aspectRatio === ratio ? styles.optionActive : ''}`}
              key={ratio}
              onClick={() => onAspectRatioChange(ratio)}
              type="button"
            >
              <span
                aria-hidden
                className={styles.ratioGlyph}
                style={{ height: ratioShape[ratio].height, width: ratioShape[ratio].width }}
              />
              <span>{ratio}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={styles.popoverSection}>
        <div className={styles.popoverLabel}>选择分辨率</div>
        <div className={styles.segmentedOptions}>
          {model?.resolutions.map((item) => (
            <button
              aria-label={`分辨率 ${item}`}
              aria-pressed={resolution === item}
              className={`${styles.segmentedOption} ${resolution === item ? styles.optionActive : ''}`}
              key={item}
              onClick={() => onResolutionChange(item)}
              type="button"
            >
              {item === '1K' ? '标准 1K' : '高清 2K'}
            </button>
          ))}
        </div>
      </div>
    </PopoverShell>
  );
}

interface ModelPopoverProps {
  capabilities: ProviderCapability[];
  health: ProviderHealth[];
  onOpenChange: (open: boolean) => void;
  onSelect: (provider: string, model: string) => void;
  open: boolean;
  selectedModel?: ModelCapability;
  selectedProvider?: string;
}

export function ModelPopover({ capabilities, health, onOpenChange, onSelect, open, selectedModel, selectedProvider }: ModelPopoverProps) {
  return <GlideSelect ariaLabel="生成模型" includeValueInLabel placement="top"
    className={styles.modelSelector} open={open} onOpenChange={onOpenChange}
    value={selectedProvider && selectedModel ? `${selectedProvider}::${selectedModel.id}` : undefined}
    options={capabilities.flatMap(capability => capability.models.map(model => {
      const status = health.find(item => item.provider === capability.provider)?.status;
      return { value: `${capability.provider}::${model.id}`, textValue: model.label, label: model.label,
        detail: <>{status === 'healthy' ? '服务正常' : status === 'unavailable' ? '服务不可用' : '服务降级'}<ModelCreditPrice operation="image" provider={capability.provider} model={model.id}/></> };
    }))}
    onChange={next => {
      const match = capabilities.flatMap(capability => capability.models.map(model => ({ provider:capability.provider, model:model.id })))
        .find(item => `${item.provider}::${item.model}` === next);
      if (match) onSelect(match.provider, match.model);
    }}/>;
}

interface ImageSettingsPopoverProps {
  aspectRatio: AspectRatio;
  capabilities: ProviderCapability[];
  count: number;
  health: ProviderHealth[];
  onAspectRatioChange: (ratio: AspectRatio) => void;
  onCountChange: (count: number) => void;
  onModelSelect: (provider: string, model: string) => void;
  onOpenChange: (open: boolean) => void;
  onResolutionChange: (resolution: ImageResolution) => void;
  open: boolean;
  resolution: ImageResolution;
  selectedModel?: ModelCapability;
  selectedProvider?: string;
}

export function ImageSettingsPopover({
  aspectRatio,
  capabilities,
  count,
  health,
  onAspectRatioChange,
  onCountChange,
  onModelSelect,
  onOpenChange,
  onResolutionChange,
  open,
  resolution,
  selectedModel,
  selectedProvider,
}: ImageSettingsPopoverProps) {
  const maxImages = Math.min(selectedModel?.maxImages ?? 1, 4);
  const selectedHealth = health.find((item) => item.provider === selectedProvider);
  return (
    <PopoverShell
      ariaLabel="图片生成设置"
      className={styles.imageSettingsPopover}
      onOpenChange={onOpenChange}
      open={open}
      trigger={(
        <ActionButton
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`图片设置 ${selectedProvider ?? ''} ${selectedModel?.label ?? ''} ${aspectRatio} ${resolution} ${count}张`.trim()}
          className={`${styles.toolbarButton} ${styles.imageSettingsSummary} ${open ? styles.toolbarButtonActive : ''}`}
          icon={<SlidersHorizontal size={15} />}
          onClick={() => onOpenChange(!open)}
        >
          <span>{selectedProvider ?? selectedModel?.label ?? '图片设置'}</span>
          <span className={styles.toolbarDivider} />
          <span>{aspectRatio}</span>
          <span className={styles.toolbarDivider} />
          <span>{resolution}</span>
          <span className={styles.toolbarDivider} />
          <span>{count}张</span>
          <ChevronDown size={13} />
        </ActionButton>
      )}
    >
      <div className={styles.popoverHeading}>
        <div>
          <div className={styles.popoverTitle}>图片生成设置</div>
          <div className={styles.popoverHint}>模型与高级参数仅在需要时调整</div>
        </div>
        <StatusBadge tone={selectedHealth?.status === 'healthy' ? 'success' : 'warning'}>
          {selectedHealth?.status === 'healthy' ? '服务正常' : '服务降级'}
        </StatusBadge>
      </div>
      <div className={styles.imageSettingsLayout}>
        <div className={styles.popoverSection}>
          <div className={styles.popoverLabel}>生成模型</div>
          <div className={styles.modelList}>
            {capabilities.flatMap((capability) => capability.models.map((model) => {
              const selected = capability.provider === selectedProvider && model.id === selectedModel?.id;
              return (
                <button
                  aria-label={`${capability.provider} · ${model.label}`}
                  className={`${styles.modelOption} ${selected ? styles.optionActive : ''}`}
                  key={`${capability.provider}-${model.id}`}
                  onClick={() => onModelSelect(capability.provider, model.id)}
                  type="button"
                >
                  <span className={styles.modelIcon}><Sparkles size={16} /></span>
                  <span><strong>{model.label}</strong><small>{capability.provider}</small><ModelCreditPrice operation="image" provider={capability.provider} model={model.id}/></span>
                  {selected && <Check size={16} />}
                </button>
              );
            }))}
          </div>
        </div>
        <div className={styles.imageParameterColumn}>
          <div className={styles.popoverSection}>
            <div className={styles.popoverLabel}>比例</div>
            <div className={styles.ratioOptions}>
              {selectedModel?.aspectRatios.map((ratio) => (
                <button
                  aria-label={`比例 ${ratio}`}
                  aria-pressed={aspectRatio === ratio}
                  className={`${styles.ratioOption} ${aspectRatio === ratio ? styles.optionActive : ''}`}
                  key={ratio}
                  onClick={() => onAspectRatioChange(ratio)}
                  type="button"
                >
                  <span aria-hidden className={styles.ratioGlyph} style={{ height: ratioShape[ratio].height, width: ratioShape[ratio].width }} />
                  <span>{ratio}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={styles.popoverSection}>
            <div className={styles.popoverLabel}>分辨率</div>
            <div className={styles.segmentedOptions}>
              {selectedModel?.resolutions.map((item) => (
                <button
                  aria-label={`分辨率 ${item}`}
                  aria-pressed={resolution === item}
                  className={`${styles.segmentedOption} ${resolution === item ? styles.optionActive : ''}`}
                  key={item}
                  onClick={() => onResolutionChange(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.popoverSection}>
            <div className={styles.popoverLabel}>数量</div>
            <div className={styles.segmentedOptions}>
              {Array.from({ length: maxImages }, (_, index) => index + 1).map((item) => (
                <button
                  aria-label={`生成数量 ${item}`}
                  aria-pressed={count === item}
                  className={`${styles.segmentedOption} ${count === item ? styles.optionActive : ''}`}
                  key={item}
                  onClick={() => onCountChange(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PopoverShell>
  );
}

interface ChatModelPopoverProps {
  health: ProviderHealth[];
  onOpenChange: (open: boolean) => void;
  onSelect: (model: string) => void;
  open: boolean;
  selectedModel: string;
}

export function ChatModelPopover({ health, onOpenChange, onSelect, open, selectedModel }: ChatModelPopoverProps) {
  return <GlideSelect ariaLabel={zhCN.composer.chatModel} includeValueInLabel placement="top"
    className={styles.modelSelector} open={open} onOpenChange={onOpenChange} value={selectedModel}
    options={CHAT_PROVIDER_MODELS.map(model => {
      const status = health.find(item => item.provider === model.provider)?.status;
      return { value:model.id, label:model.label, textValue:model.label,
        detail:<>{status === 'healthy' ? '服务正常' : status === 'unavailable' ? '服务不可用' : '服务降级'}<ModelCreditPrice operation="chat" provider={model.id} model={model.id}/></> };
    })}
    onChange={next => { if (CHAT_PROVIDER_MODELS.some(model => model.id === next)) onSelect(next); }}/>;
}

export function buildSkillPromptPreview(skill: Skill | undefined, values: Record<string, string>, prompt: string) {
  return skill ? `${skill.defaults}\n\n用户要求：${prompt.trim()}` : prompt;
}

interface SkillPopoverProps {
  editablePrompt?: boolean;
  focusFieldKey?: string;
  onClear: () => void;
  onOpenChange: (open: boolean) => void;
  onPromptChange?: (value: string) => void;
  onSelectSkill: (skillId: string) => void;
  onSkillValueChange: (key: string, value: string) => void;
  open: boolean;
  prompt: string;
  selectedSkill?: Skill;
  skills: Skill[];
  skillValues: Record<string, string>;
}

interface SkillListProps {
  onSelectSkill: (skillId: string) => void;
  selectedSkillId?: string;
  skills: Skill[];
}

export function SkillList({ onSelectSkill, selectedSkillId, skills }: SkillListProps) {
  return (
    <div aria-label="可用技能" className={styles.skillList}>
      {skills.map((skill) => (
        <button
          aria-label={`选择技能 ${skill.name}`}
          aria-pressed={selectedSkillId === skill.id}
          className={`${styles.skillOption} ${selectedSkillId === skill.id ? styles.skillOptionActive : ''}`}
          key={skill.id}
          onClick={() => onSelectSkill(skill.id)}
          type="button"
        >
          <span aria-hidden className={styles.skillOptionIcon}>{skill.icon}</span>
          <span className={styles.skillOptionText}>
            <strong>{skill.name}</strong>
            <small>{skill.description}</small>
          </span>
          {selectedSkillId === skill.id && <Check aria-hidden size={16} />}
        </button>
      ))}
    </div>
  );
}

export function SkillPopover({
  editablePrompt = false,
  onClear,
  onOpenChange,
  onPromptChange,
  onSelectSkill,
  open,
  prompt,
  selectedSkill,
  skills,
}: SkillPopoverProps) {
  return (
    <PopoverShell
      ariaLabel="技能配置"
      className={styles.skillPopover}
      onOpenChange={onOpenChange}
      open={open}
      trigger={(
        <ActionButton
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={selectedSkill ? `技能配置 ${selectedSkill.name}` : '选择技能'}
          className={`${styles.toolbarButton} ${open ? styles.toolbarButtonActive : ''}`}
          icon={<Sparkles size={15} />}
          onClick={() => onOpenChange(!open)}
        >
          {selectedSkill?.name ?? '技能'}
        </ActionButton>
      )}
    >
      <div className={styles.skillPopoverLayout}>
        <div className={styles.skillCatalog}>
          <div className={styles.popoverTitle}>创作技能</div>
          <div className={styles.popoverHint}>选择一个技能附加到当前任务 · <a href="/skills">了解官方 Skill</a></div>
          <SkillList
            onSelectSkill={onSelectSkill}
            selectedSkillId={selectedSkill?.id}
            skills={skills}
          />
        </div>
        <div className={styles.skillDetail}>
          <div className={styles.popoverHeading}>
            <div>
              <div className={styles.popoverTitle}>{selectedSkill?.name ?? '技能配置'}</div>
              <div className={styles.popoverHint}>{selectedSkill?.description ?? '选择左侧技能后配置生成要求'}</div>
            </div>
            {selectedSkill && <ActionButton aria-label="清除技能" onClick={onClear} size="small" variant="text">清除</ActionButton>}
          </div>
          {selectedSkill ? (
            <>
              <div className={styles.promptPreviewBlock}>
                <span>本次方案（发送前可修改）</span>
                {editablePrompt ? (
                  <TextArea
                    aria-label="本次 Skill 方案"
                    autoResize={{ maxRows: 6, minRows: 3 }}
                    onChange={(event) => onPromptChange?.(event.target.value)}
                    value={prompt}
                  />
                ) : <p>{selectedSkill.defaults}</p>}
              </div>
            </>
          ) : (
            <div className={styles.popoverEmpty}>请选择一个技能开始配置。</div>
          )}
        </div>
      </div>
    </PopoverShell>
  );
}
