import type { ComposerMode, Skill, UploadReference } from '@zimage/domain';
import { Button, Input, Switch, Tag, Tooltip } from 'antd';
import { Image as ImageIcon, ImagePlus, MessageCircle, Send, Settings2, SlidersHorizontal, X } from 'lucide-react';
import Image from 'next/image';
import type { ChangeEvent, KeyboardEvent } from 'react';

import styles from './workspace.module.css';

interface UnifiedComposerProps {
  busy: boolean;
  draft: string;
  imageToolEnabled: boolean;
  mode: ComposerMode;
  references: UploadReference[];
  selectedSkill?: Skill;
  onClearSkill: () => void;
  onDraftChange: (value: string) => void;
  onImageToolChange: (enabled: boolean) => void;
  onModeChange: (mode: ComposerMode) => void;
  onOpenConfig: () => void;
  onReferenceAdd: (files: FileList) => void;
  onReferenceRemove: (index: number) => void;
  onSubmit: () => void;
}

export function UnifiedComposer({
  busy,
  draft,
  imageToolEnabled,
  mode,
  references,
  selectedSkill,
  onClearSkill,
  onDraftChange,
  onImageToolChange,
  onModeChange,
  onOpenConfig,
  onReferenceAdd,
  onReferenceRemove,
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
      <div className={styles.modeRow}>
        <div className={styles.modeSwitch}>
          <button
            aria-label="聊天模式"
            aria-pressed={mode === 'chat'}
            className={`${styles.modeButton} ${mode === 'chat' ? styles.modeActive : ''}`}
            onClick={() => onModeChange('chat')}
            type="button"
          >
            <MessageCircle size={14} style={{ marginRight: 5, verticalAlign: -2 }} />聊天
          </button>
          <button
            aria-label="生图模式"
            aria-pressed={mode === 'image'}
            className={`${styles.modeButton} ${mode === 'image' ? styles.modeActive : ''}`}
            onClick={() => onModeChange('image')}
            type="button"
          >
            <ImageIcon size={14} style={{ marginRight: 5, verticalAlign: -2 }} />生图
          </button>
        </div>
        {selectedSkill && (
          <Tag
            closeIcon={<X size={11} />}
            color="purple"
            onClose={(event) => {
              event.preventDefault();
              onClearSkill();
            }}
          >
            {selectedSkill.name}
            <button aria-label="清除技能" onClick={onClearSkill} style={{ border: 0, background: 'none', width: 1, height: 1, overflow: 'hidden' }} type="button" />
          </Tag>
        )}
      </div>
      <div className={styles.composerBody}>
        {mode === 'image' && (
          <div aria-label="参考图" className={styles.inlineReferences}>
            {references.map((reference, index) => (
              <div className={styles.referenceCard} key={`${reference.name}-${index}`} style={{ zIndex: index + 1 }}>
                <div className={styles.referencePreview}>
                  {reference.previewUrl ? (
                    <Image
                      alt={`参考图 ${reference.name}`}
                      fill
                      sizes="64px"
                      src={reference.previewUrl}
                      style={{ objectFit: 'cover' }}
                      unoptimized
                    />
                  ) : (
                    <ImageIcon aria-hidden size={22} />
                  )}
                </div>
                <button
                  aria-label={`移除参考图 ${reference.name}`}
                  className={styles.referenceRemove}
                  onClick={() => onReferenceRemove(index)}
                  type="button"
                >
                  <X aria-hidden size={12} />
                </button>
              </div>
            ))}
            {references.length < 4 && (
              <label
                aria-label="添加参考图"
                className={styles.referenceAddCard}
                role="button"
                style={{ zIndex: references.length + 1 }}
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
                <ImagePlus aria-hidden size={20} />
                <span>参考图</span>
              </label>
            )}
          </div>
        )}
        <Input.TextArea
          aria-label="创作输入"
          className={styles.composerInput}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={mode === 'chat' ? '聊聊你的想法，或让 AI 帮你完善提示词…' : '描述你想生成的画面…'}
          rows={2}
          value={draft}
          variant="borderless"
        />
      </div>
      <div className={styles.composerActions}>
        <div className={styles.actionGroup}>
          <Tooltip title="选择技能和高级生图参数">
            <Button icon={<SlidersHorizontal size={15} />} onClick={onOpenConfig} size="small" type="text">
              <span className={styles.toolLabel}>配置</span>
            </Button>
          </Tooltip>
          <span className={styles.actionGroup}>
            <Switch
              aria-label="图片工具"
              checked={imageToolEnabled}
              disabled={mode === 'image' || Boolean(selectedSkill?.requiresImageTool)}
              onChange={onImageToolChange}
              size="small"
            />
            <span className={`${styles.muted} ${styles.toolLabel}`}>图片工具</span>
          </span>
          {mode === 'image' && <Tag icon={<Settings2 size={11} />}>1–4 张 · 最高 2K</Tag>}
        </div>
        <Button
          aria-label="发送创作请求"
          disabled={!draft.trim()}
          icon={<Send size={15} />}
          loading={busy}
          onClick={onSubmit}
          shape="circle"
          type="primary"
        />
      </div>
    </div>
  );
}
