import { PreviewImage } from '@/features/controls/PreviewImage';

import { COMMERCE_TEMPLATES } from '@zimage/domain';
import styles from './commerce.module.css';

import { templatePreviewUrl } from './commerce-examples';

export function TemplatePreview({ templateId, role }: { templateId: string; role?: string }) {
  const template = COMMERCE_TEMPLATES.find(t => t.id === templateId);
  if (!template) return <p className={styles.note}>历史模板 · 保留已保存的方案</p>;
  if (role && role !== template.visual.previewRole) return <div className={styles.layoutPreview}><strong>{role}</strong><p>{template.guidance}</p><small>布局说明 · 当前角色暂无对应样图</small></div>;
  return <PreviewImage src={templatePreviewUrl(templateId)} alt={`${template.name} · ${template.visual.previewRole} · AI 风格示例`} />;
}
