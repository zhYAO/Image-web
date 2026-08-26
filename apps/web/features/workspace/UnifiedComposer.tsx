import type {
  AspectRatio,
  ComposerMode,
  ImageResolution,
  ProviderCapability,
  ProviderHealth,
  Quota,
  Skill,
  UploadReference,
} from '@zimage/domain';
import { Button, Input, Switch, Tooltip } from 'antd';
import { ArrowUp, Image as ImageIcon, ImagePlus, MessageCircle, Settings2, X } from 'lucide-react';
import Image from 'next/image';
import type { ChangeEvent, KeyboardEvent } from 'react';

import { zhCN } from '@/i18n';

import {
  ChatModelPopover,
  GenerationParameterPopover,
  ModelPopover,
  SkillPopover,
  type ModelCapability,
} from './GenerationConfig';
import styles from './workspace.module.css';

interface UnifiedComposerProps {
  activePopover?: 'model' | 'parameters' | 'skill';
  aspectRatio: AspectRatio;
  busy: boolean;
  capabilities: ProviderCapability[];
  count: number;
  draft: string;
  focusSkillFieldKey?: string;
  health: ProviderHealth[];
  imageToolEnabled: boolean;
  mode: ComposerMode;
  quota?: Quota;
  references: UploadReference[];
  resolution: ImageResolution;
  selectedModel?: ModelCapability;
  selectedChatModel: string;
  selectedProvider?: string;
  selectedSkill?: Skill;
  skillPrompt: string;
  skills: Skill[];
  skillValues: Record<string, string>;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  onClearSkill: () => void;
  onCountChange: (count: number) => void;
  onDraftChange: (value: string) => void;
  onImageToolChange: (enabled: boolean) => void;
  onModeChange: (mode: ComposerMode) => void;
  onModelSelect: (provider: string, model: string) => void;
  onChatModelSelect: (model: string) => void;
  onOpenConfig: () => void;
  onPopoverChange: (popover?: UnifiedComposerProps['activePopover']) => void;
  onSkillPromptChange: (value: string) => void;
  onReferenceAdd: (files: FileList) => void;
  onReferenceRemove: (index: number) => void;
  onResolutionChange: (resolution: ImageResolution) => void;
  onSkillSelect: (skillId: string) => void;
  onSkillValueChange: (key: string, value: string) => void;
  onSubmit: () => void;
}

export function UnifiedComposer({
  activePopover,
  aspectRatio,
  busy,
  capabilities,
  count,
  draft,
  focusSkillFieldKey,
  health,
  imageToolEnabled,
  mode,
  quota,
  references,
  resolution,
  selectedModel,
  selectedChatModel,
  selectedProvider,
  selectedSkill,
  skillPrompt,
  skills,
  skillValues,
  onAspectRatioChange,
  onClearSkill,
  onCountChange,
  onDraftChange,
  onImageToolChange,
  onModeChange,
  onModelSelect,
  onChatModelSelect,
  onOpenConfig,
  onPopoverChange,
  onSkillPromptChange,
  onReferenceAdd,
  onReferenceRemove,
  onResolutionChange,
  onSkillSelect,
  onSkillValueChange,
  onSubmit,
}: UnifiedComposerProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSubmit();
    }
  };

  const onReferenceFiles = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) onReferenceAdd(event.target.files);
    event.target.value = '';
  };

  return (
    <div className={styles.composer}>
      <div className={styles.composerBody}>
        {mode === 'image' && (
          <div aria-label={zhCN.composer.reference} className={styles.inlineReferences}>
            {references.map((reference, index) => (
              <div className={styles.referenceCard} key={`${reference.name}-${index}`}>
                <div className={styles.referencePreview}>
                  {reference.previewUrl ? (
                    <Image
                      alt={`参考图 ${reference.name}`}
                      fill
                      sizes="72px"
                      src={reference.previewUrl}
                      style={{ objectFit: 'cover' }}
                      unoptimized
                    />
                  ) : (
                    <ImageIcon aria-hidden size={22} />
                  )}
                </div>
                <button
                  aria-label={`移除 ${reference.name}`}
                  className={styles.referenceRemove}
                  onClick={() => onReferenceRemove(index)}
                  type="button"
                >
                  <X aria-hidden size={12} />
                </button>
                <span className={styles.srOnly}>{reference.name}</span>
              </div>
            ))}
            {references.length < 4 && (
              <label
                aria-label={zhCN.composer.addReference}
                className={styles.referenceAddCard}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  event.currentTarget.querySelector('input')?.click();
                }}
              >
                <input
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="上传参考图"
                  hidden
                  multiple
                  onChange={onReferenceFiles}
                  type="file"
                />
                <ImagePlus aria-hidden size={21} />
                <span>{zhCN.composer.reference}</span>
              </label>
            )}
          </div>
        )}
        <Input.TextArea
          aria-label="创作输入"
          autoSize={{ maxRows: 5, minRows: 2 }}
          className={styles.composerInput}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={mode === 'chat' ? zhCN.composer.chatPlaceholder : zhCN.composer.imagePlaceholder}
          value={draft}
          variant="borderless"
        />
      </div>
      <div className={styles.composerActions}>
        <div className={styles.composerTools}>
          <div className={styles.modeSwitch}>
            <button
              aria-label={zhCN.composer.chatMode}
              aria-pressed={mode === 'chat'}
              className={`${styles.modeButton} ${mode === 'chat' ? styles.modeActive : ''}`}
              onClick={() => onModeChange('chat')}
              type="button"
            >
              <MessageCircle size={14} />聊天
            </button>
            <button
              aria-label={zhCN.composer.imageMode}
              aria-pressed={mode === 'image'}
              className={`${styles.modeButton} ${mode === 'image' ? styles.modeActive : ''}`}
              onClick={() => onModeChange('image')}
              type="button"
            >
              <ImageIcon size={14} />图片生成
            </button>
          </div>
          {mode === 'image' && (
            <>
              <ModelPopover
                capabilities={capabilities}
                health={health}
                onOpenChange={(open) => onPopoverChange(open ? 'model' : undefined)}
                onSelect={onModelSelect}
                open={activePopover === 'model'}
                selectedModel={selectedModel}
                selectedProvider={selectedProvider}
              />
              <GenerationParameterPopover
                aspectRatio={aspectRatio}
                count={count}
                model={selectedModel}
                onAspectRatioChange={onAspectRatioChange}
                onCountChange={onCountChange}
                onOpenChange={(open) => onPopoverChange(open ? 'parameters' : undefined)}
                onResolutionChange={onResolutionChange}
                open={activePopover === 'parameters'}
                resolution={resolution}
              />
            </>
          )}
          {mode === 'chat' && (
            <ChatModelPopover
              health={health}
              onOpenChange={(open) => onPopoverChange(open ? 'model' : undefined)}
              onSelect={onChatModelSelect}
              open={activePopover === 'model'}
              selectedModel={selectedChatModel}
            />
          )}
          <SkillPopover
            editablePrompt={mode === 'image'}
            focusFieldKey={focusSkillFieldKey}
            onClear={onClearSkill}
            onOpenChange={(open) => onPopoverChange(open ? 'skill' : undefined)}
            onPromptChange={onSkillPromptChange}
            onSelectSkill={onSkillSelect}
            onSkillValueChange={onSkillValueChange}
            open={activePopover === 'skill'}
            prompt={skillPrompt}
            selectedSkill={selectedSkill}
            skills={skills}
            skillValues={skillValues}
          />
          {mode === 'chat' && (
            <Tooltip title={zhCN.composer.imageToolHint}>
              <span className={styles.imageToolToggle}>
                <Switch
                  aria-label={zhCN.composer.imageTool}
                  checked={imageToolEnabled}
                  disabled={Boolean(selectedSkill?.requiresImageTool)}
                  onChange={onImageToolChange}
                  size="small"
                />
                <span>{zhCN.composer.imageTool}</span>
              </span>
            </Tooltip>
          )}
          <Button
            aria-label={zhCN.composer.openMobileConfig}
            className={styles.mobileConfigButton}
            icon={<Settings2 size={15} />}
            onClick={onOpenConfig}
          />
        </div>
        <div className={styles.submitGroup}>
          {quota && <span className={styles.quotaText}>✦ {Math.max(0, quota.limit - quota.used)} 张</span>}
          <Button
            aria-label={zhCN.composer.submit}
            className={styles.submitButton}
            disabled={!draft.trim()}
            icon={<ArrowUp size={18} strokeWidth={2.5} />}
            loading={busy}
            onClick={onSubmit}
            shape="circle"
            type="primary"
          />
        </div>
      </div>
    </div>
  );
}
