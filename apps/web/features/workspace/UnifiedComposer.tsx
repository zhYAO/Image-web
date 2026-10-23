import { CreditFee } from "@/features/credits/CreditsProvider";
import { imageCreditItem } from "@zimage/domain";
import type {
  AspectRatio,
  ImageResolution,
  ProviderCapability,
  ProviderHealth,
  Quota,
  UploadReference,
} from "@zimage/domain";
import { Button, Image as AntdImage, Input, Tooltip } from "antd";
import {
  ArrowUp,
  Image as ImageIcon,
  ImagePlus,
  Settings2,
  X,
} from "lucide-react";
import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ComposerOrbs } from "./ComposerOrbs";

import { zhCN } from "@/i18n";

import {
  ChatModelPopover,
  ModelPopover,
  GenerationParameterPopover,
  type ModelCapability,
} from "./GenerationConfig";
import styles from "./workspace.module.css";

interface UnifiedComposerProps {
  activePopover?: "image-settings" | "image-model" | "model" | "skill";
  aspectRatio: AspectRatio;
  busy: boolean;
  capabilities: ProviderCapability[];
  count?: number;
  disabled?: boolean;
  submitDisabled?: boolean;
  draft: string;
  health: ProviderHealth[];
  imageCreationEnabled: boolean;
  quota?: Quota;
  references: UploadReference[];
  resolution: ImageResolution;
  selectedModel?: ModelCapability;
  selectedChatModel: string;
  selectedProvider?: string;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  onCountChange?: (count: number) => void;
  onDraftChange: (value: string) => void;
  onImageCreationChange: (enabled: boolean) => void;
  onModelSelect: (provider: string, model: string) => void;
  onChatModelSelect: (model: string) => void;
  onOpenConfig: () => void;
  onPopoverChange: (popover?: UnifiedComposerProps["activePopover"]) => void;
  onReferenceAdd: (files: FileList) => void;
  onReferenceRemove: (index: number) => void;
  onResolutionChange: (resolution: ImageResolution) => void;
  onSubmit: () => void;
}

export function UnifiedComposer({
  activePopover,
  aspectRatio,
  busy,
  capabilities,
  disabled = false,
  submitDisabled = false,
  draft,
  health,
  imageCreationEnabled,
  quota,
  references,
  resolution,
  selectedModel,
  selectedChatModel,
  selectedProvider,
  onAspectRatioChange,
  onDraftChange,
  onImageCreationChange,
  onModelSelect,
  onChatModelSelect,
  onOpenConfig,
  onPopoverChange,
  onReferenceAdd,
  onReferenceRemove,
  onResolutionChange,
  onSubmit,
}: UnifiedComposerProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      if (!disabled && !submitDisabled && !busy && draft.trim()) onSubmit();
    }
  };

  const onReferenceFiles = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) onReferenceAdd(event.target.files);
    event.target.value = "";
  };

  const [focused, setFocused] = useState(false);
  return (
    <div className={styles.composer}>
      <ComposerOrbs focused={focused} />
      <div className={styles.composerBody}>
        {imageCreationEnabled && (
          <div
            aria-label={zhCN.composer.reference}
            className={styles.inlineReferences}
          >
            {references.map((reference, index) => (
              <div
                className={styles.referenceCard}
                key={`${reference.name}-${index}`}
              >
                <div className={styles.referencePreview}>
                  {reference.previewUrl ? (
                    <AntdImage
                      alt={`参考图 ${reference.name}`}
                      className={styles.referencePreviewImage}
                      preview={{ mask: false }}
                      rootClassName={styles.referencePreviewImage}
                      src={reference.previewUrl}
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
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.currentTarget.querySelector("input")?.click();
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
          aria-describedby="composer-help"
          aria-label="创作输入"
          id="creation-prompt"
          autoSize={{ maxRows: 5, minRows: 2 }}
          className={styles.composerInput}
          disabled={disabled}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={
            imageCreationEnabled
              ? zhCN.composer.imagePlaceholder
              : zhCN.composer.chatPlaceholder
          }
          value={draft}
          variant="borderless"
        />
      </div>
      <div className={styles.composerActions}>
        <div className={styles.composerTools}>
          <Tooltip title="开启后，描述你想生成的图片">
            <Button
              aria-label="创建图片"
              aria-pressed={imageCreationEnabled}
              className={`${styles.toolbarButton} ${imageCreationEnabled ? styles.toolbarButtonActive : ""}`}
              disabled={disabled}
              icon={<ImageIcon size={15} />}
              onClick={() => onImageCreationChange(!imageCreationEnabled)}
            >
              创建图片
            </Button>
          </Tooltip>
          {imageCreationEnabled && (
            <>
              <ModelPopover
                capabilities={capabilities}
                health={health}
                selectedModel={selectedModel}
                selectedProvider={selectedProvider}
                onSelect={onModelSelect}
                onOpenChange={(open) =>
                  onPopoverChange(open ? "image-model" : undefined)
                }
                open={activePopover === "image-model"}
              />
              <GenerationParameterPopover
                aspectRatio={aspectRatio}
                model={selectedModel}
                onAspectRatioChange={onAspectRatioChange}
                onOpenChange={(open) =>
                  onPopoverChange(open ? "image-settings" : undefined)
                }
                onResolutionChange={onResolutionChange}
                open={activePopover === "image-settings"}
                resolution={resolution}
              />
            </>
          )}
          {!imageCreationEnabled && (
            <ChatModelPopover
              health={health}
              onOpenChange={(open) =>
                onPopoverChange(open ? "model" : undefined)
              }
              onSelect={onChatModelSelect}
              open={activePopover === "model"}
              selectedModel={selectedChatModel}
            />
          )}
          <Button
            aria-label={zhCN.composer.openMobileConfig}
            className={styles.mobileConfigButton}
            icon={<Settings2 size={15} />}
            onClick={onOpenConfig}
          />
        </div>
        <div className={styles.submitGroup}>
          <CreditFee
            items={
              imageCreationEnabled
                ? [
                    imageCreditItem({
                      provider: selectedProvider,
                      model: selectedModel?.id,
                      resolution,
                      count: 1,
                    }),
                  ]
                : [
                    {
                      operation: "chat",
                      provider: selectedChatModel,
                      model: selectedChatModel,
                      resolution: "",
                      count: 1,
                    },
                  ]
            }
          />

          {quota && (
            <span className={styles.quotaText}>
              ✦ {Math.max(0, quota.limit - quota.used)} 张
            </span>
          )}
          <Button
            aria-label={zhCN.composer.submit}
            className={styles.submitButton}
            disabled={disabled || submitDisabled || !draft.trim()}
            icon={<ArrowUp size={18} strokeWidth={2.5} />}
            loading={busy}
            onClick={onSubmit}
            shape="circle"
            type="primary"
          />
        </div>
      </div>
      <span className={styles.srOnly} id="composer-help">
        Enter 发送，Shift + Enter 换行。
        {imageCreationEnabled && "最多上传 4 张参考图，每次生成 1 张图片。"}
      </span>
    </div>
  );
}
