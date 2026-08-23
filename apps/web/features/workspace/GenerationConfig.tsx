import type {
  AspectRatio,
  ImageResolution,
  ProviderCapability,
  ProviderHealth,
  Skill,
} from '@zimage/domain';
import { Button, Input, Tag, type InputRef } from 'antd';
import { Box, Check, ChevronDown, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';

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
  const providerCapability = capabilities.find((item) => item.provider === provider) ?? capabilities[0];
  const model = providerCapability?.models.find((item) => item.id === modelId) ?? providerCapability?.models[0];
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

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
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
  count: number;
  model?: ModelCapability;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  onCountChange: (count: number) => void;
  onOpenChange: (open: boolean) => void;
  onResolutionChange: (resolution: ImageResolution) => void;
  open: boolean;
  resolution: ImageResolution;
}

export function GenerationParameterPopover({
  aspectRatio,
  count,
  model,
  onAspectRatioChange,
  onCountChange,
  onOpenChange,
  onResolutionChange,
  open,
  resolution,
}: GenerationParameterPopoverProps) {
  const maxImages = Math.min(model?.maxImages ?? 1, 4);
  return (
    <PopoverShell
      ariaLabel="生成参数"
      className={styles.parameterPopover}
      onOpenChange={onOpenChange}
      open={open}
      trigger={(
        <Button
          aria-label={`生成参数 ${aspectRatio} ${resolution} ${count}张`}
          className={`${styles.toolbarButton} ${open ? styles.toolbarButtonActive : ''}`}
          icon={<SlidersHorizontal size={15} />}
          onClick={() => onOpenChange(!open)}
        >
          {aspectRatio}<span className={styles.toolbarDivider} />{resolution}<span className={styles.toolbarDivider} />{count}
        </Button>
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
      <div className={styles.popoverSection}>
        <div className={styles.popoverLabel}>选择生成数量</div>
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

export function ModelPopover({
  capabilities,
  health,
  onOpenChange,
  onSelect,
  open,
  selectedModel,
  selectedProvider,
}: ModelPopoverProps) {
  const selectedHealth = health.find((item) => item.provider === selectedProvider);
  return (
    <PopoverShell
      ariaLabel="选择生成模型"
      className={styles.modelPopover}
      onOpenChange={onOpenChange}
      open={open}
      trigger={(
        <Button
          aria-label={`生成模型 ${selectedProvider ?? ''} ${selectedModel?.label ?? ''}`.trim()}
          className={`${styles.toolbarButton} ${open ? styles.toolbarButtonActive : ''}`}
          icon={<Box size={15} />}
          onClick={() => onOpenChange(!open)}
        >
          {selectedModel?.label ?? '选择模型'} <ChevronDown size={13} />
        </Button>
      )}
    >
      <div className={styles.popoverHeading}>
        <div>
          <div className={styles.popoverTitle}>图片模型</div>
          <div className={styles.popoverHint}>选择用于本次创作的服务与模型</div>
        </div>
        <Tag color={selectedHealth?.status === 'healthy' ? 'green' : 'orange'}>
          {selectedHealth?.status === 'healthy' ? '服务正常' : '服务降级'}
        </Tag>
      </div>
      <div className={styles.modelList}>
        {capabilities.flatMap((capability) => capability.models.map((model) => {
          const selected = capability.provider === selectedProvider && model.id === selectedModel?.id;
          return (
            <button
              aria-label={`${capability.provider} · ${model.label}`}
              className={`${styles.modelOption} ${selected ? styles.optionActive : ''}`}
              key={`${capability.provider}-${model.id}`}
              onClick={() => {
                onSelect(capability.provider, model.id);
                onOpenChange(false);
              }}
              type="button"
            >
              <span className={styles.modelIcon}><Sparkles size={16} /></span>
              <span><strong>{model.label}</strong><small>{capability.provider}</small></span>
              {selected && <Check size={16} />}
            </button>
          );
        }))}
      </div>
    </PopoverShell>
  );
}

export function buildSkillPromptPreview(skill: Skill | undefined, values: Record<string, string>, prompt: string) {
  let preview = skill?.promptTemplate ?? (prompt || '输入内容后，这里会展示最终提示词。');
  for (const [key, value] of Object.entries(values)) preview = preview.replaceAll(`{${key}}`, value || `{${key}}`);
  return preview;
}

interface SkillPopoverProps {
  focusFieldKey?: string;
  onClear: () => void;
  onOpenChange: (open: boolean) => void;
  onSkillValueChange: (key: string, value: string) => void;
  open: boolean;
  prompt: string;
  selectedSkill?: Skill;
  skillValues: Record<string, string>;
}

export function SkillPopover({
  focusFieldKey,
  onClear,
  onOpenChange,
  onSkillValueChange,
  open,
  prompt,
  selectedSkill,
  skillValues,
}: SkillPopoverProps) {
  const inputRefs = useRef<Record<string, InputRef | null>>({});
  const preview = useMemo(
    () => buildSkillPromptPreview(selectedSkill, skillValues, prompt),
    [prompt, selectedSkill, skillValues],
  );

  useEffect(() => {
    if (open && focusFieldKey) inputRefs.current[focusFieldKey]?.focus();
  }, [focusFieldKey, open]);

  return (
    <PopoverShell
      ariaLabel="技能配置"
      className={styles.skillPopover}
      onOpenChange={onOpenChange}
      open={open}
      trigger={(
        <Button
          aria-label={selectedSkill ? `技能配置 ${selectedSkill.name}` : '选择技能'}
          className={`${styles.toolbarButton} ${open ? styles.toolbarButtonActive : ''}`}
          icon={<Sparkles size={15} />}
          onClick={() => onOpenChange(!open)}
        >
          {selectedSkill?.name ?? '技能'}
        </Button>
      )}
    >
      <div className={styles.popoverHeading}>
        <div>
          <div className={styles.popoverTitle}>{selectedSkill?.name ?? '创作技能'}</div>
          <div className={styles.popoverHint}>{selectedSkill?.description ?? '从首页选择一个技能开始配置'}</div>
        </div>
        {selectedSkill && <Button aria-label="清除技能" onClick={onClear} size="small" type="text">清除</Button>}
      </div>
      {selectedSkill ? (
        <>
          <div className={styles.skillFields}>
            {selectedSkill.fields.map((field) => (
              <label className={styles.skillField} key={field.key}>
                <span>{field.label}{field.required && <i>*</i>}</span>
                <Input
                  aria-label={field.label}
                  onChange={(event) => onSkillValueChange(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  ref={(node) => { inputRefs.current[field.key] = node; }}
                  status={focusFieldKey === field.key && !skillValues[field.key]?.trim() ? 'error' : undefined}
                  value={skillValues[field.key] ?? ''}
                />
              </label>
            ))}
          </div>
          <div className={styles.promptPreviewBlock}>
            <span>实时提示词预览</span>
            <p>{preview}</p>
          </div>
        </>
      ) : (
        <div className={styles.popoverEmpty}>从上方推荐卡片选择技能后，可在这里补充生成要求。</div>
      )}
    </PopoverShell>
  );
}
