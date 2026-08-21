import type {
  AspectRatio,
  ComposerMode,
  ImageResolution,
  MockScenario,
  ProviderCapability,
  ProviderHealth,
  Quota,
  Skill,
  UploadReference,
} from '@zimage/domain';
import { Button, Input, InputNumber, Progress, Select, Segmented, Tag } from 'antd';
import { ImagePlus, Trash2 } from 'lucide-react';
import type { ChangeEvent } from 'react';

import styles from './workspace.module.css';

const RATIOS: AspectRatio[] = ['1:1', '3:4', '4:3', '9:16', '16:9'];

interface GenerationConfigProps {
  aspectRatio: AspectRatio;
  count: number;
  health?: ProviderHealth;
  mode: ComposerMode;
  prompt: string;
  providerCapabilities: ProviderCapability[];
  quota?: Quota;
  references: UploadReference[];
  resolution: ImageResolution;
  scenario: MockScenario;
  selectedSkill?: Skill;
  skillValues: Record<string, string>;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  onCountChange: (count: number) => void;
  onReferenceAdd: (files: FileList) => void;
  onReferenceRemove: (index: number) => void;
  onResolutionChange: (resolution: ImageResolution) => void;
  onScenarioChange: (scenario: MockScenario) => void;
  onSkillValueChange: (key: string, value: string) => void;
}

export function GenerationConfig({
  aspectRatio,
  count,
  health,
  mode,
  prompt,
  providerCapabilities,
  quota,
  references,
  resolution,
  scenario,
  selectedSkill,
  skillValues,
  onAspectRatioChange,
  onCountChange,
  onReferenceAdd,
  onReferenceRemove,
  onResolutionChange,
  onScenarioChange,
  onSkillValueChange,
}: GenerationConfigProps) {
  const capability = providerCapabilities[0];
  const model = capability?.models[0];
  let preview = selectedSkill?.promptTemplate ?? (prompt || '输入内容后，这里会展示最终提示词。');
  for (const [key, value] of Object.entries(skillValues)) preview = preview.replaceAll(`{${key}}`, value || `{${key}}`);

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) onReferenceAdd(event.target.files);
    event.target.value = '';
  };

  return (
    <div className={styles.panelInner}>
      <h2 className={styles.configTitle}>生成配置</h2>
      <div className={styles.muted}>调整参数，结果会进入当前时间线</div>

      {mode === 'image' && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>
            <span>参考图</span>
            <span className={styles.muted}>JPG / PNG / WebP · 10 MB</span>
          </div>
          <label>
            <input accept="image/jpeg,image/png,image/webp" hidden multiple onChange={onFiles} type="file" />
            <Button block icon={<ImagePlus size={15} />} onClick={(event) => event.currentTarget.parentElement?.querySelector('input')?.click()}>
              添加参考图
            </Button>
          </label>
          {references.map((reference, index) => (
            <div className={styles.sessionItem} key={`${reference.name}-${index}`}>
              <span className={styles.sessionTitle}>{reference.name}</span>
              <Button aria-label={`移除 ${reference.name}`} icon={<Trash2 size={13} />} onClick={() => onReferenceRemove(index)} size="small" type="text" />
            </div>
          ))}
        </div>
      )}

      {selectedSkill && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>
            <span>{selectedSkill.name}参数</span>
            <Tag color="purple">技能</Tag>
          </div>
          {selectedSkill.fields.map((field) => (
            <Input
              aria-label={field.label}
              key={field.key}
              onChange={(event) => onSkillValueChange(field.key, event.target.value)}
              placeholder={`${field.label}${field.required ? '（必填）' : ''}`}
              style={{ marginBottom: 8 }}
              value={skillValues[field.key] ?? ''}
            />
          ))}
        </div>
      )}

      <div className={styles.field}>
        <div className={styles.fieldLabel}>提示词预览</div>
        <div className={styles.promptPreview}>{preview}</div>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>Provider / Model</div>
        <Select
          aria-label="生成模型"
          options={model ? [{ label: `${capability?.provider} · ${model.label}`, value: model.id }] : []}
          style={{ width: '100%' }}
          value={model?.id}
        />
        <div style={{ marginTop: 8 }}>
          <Tag color={health?.status === 'healthy' ? 'green' : 'orange'}>
            {health?.status === 'healthy' ? '服务正常' : '服务降级'}
          </Tag>
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>生成张数</div>
        <InputNumber aria-label="生成张数" max={4} min={1} onChange={(value) => onCountChange(value ?? 1)} style={{ width: '100%' }} value={count} />
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>图片比例</div>
        <div className={styles.ratioGrid}>
          {RATIOS.map((ratio) => (
            <button
              aria-label={`比例 ${ratio}`}
              className={`${styles.ratioButton} ${aspectRatio === ratio ? styles.ratioActive : ''}`}
              key={ratio}
              onClick={() => onAspectRatioChange(ratio)}
              type="button"
            >
              {ratio}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>清晰度</div>
        <Segmented
          block
          onChange={(value) => onResolutionChange(value as ImageResolution)}
          options={['1K', '2K']}
          value={resolution}
        />
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>Mock 验收场景</div>
        <Select
          aria-label="Mock 场景"
          onChange={onScenarioChange}
          options={[
            { label: '正常流程', value: 'happy' },
            { label: '部分成功', value: 'partial' },
            { label: 'Provider 不可用', value: 'provider-unavailable' },
            { label: '资源已过期', value: 'expired' },
            { label: '删除需重试', value: 'delete-retry' },
          ]}
          style={{ width: '100%' }}
          value={scenario}
        />
      </div>

      {quota && (
        <div className={styles.quota}>
          <div className={styles.fieldLabel}>
            <span>本月额度</span>
            <span>{quota.used} / {quota.limit}</span>
          </div>
          <Progress percent={Math.round((quota.used / quota.limit) * 100)} showInfo={false} size="small" />
        </div>
      )}
    </div>
  );
}
