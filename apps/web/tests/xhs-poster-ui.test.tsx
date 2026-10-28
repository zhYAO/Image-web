import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { COMMERCE_TEMPLATES, IMAGE_PROVIDER_CAPABILITIES, type CommercePlan } from '@zimage/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceWizard } from '@/features/commerce/CommerceWizard';
import { createTestGateway } from './workspace-test-fixtures';

beforeEach(() => sessionStorage.clear());

async function wizard(initialTemplateId?: string, seedPlan?: CommercePlan) {
  const gateway = createTestGateway();
  const session = await gateway.createSession('海报测试');
  const create = vi.spyOn(gateway.commerce, 'create');
  render(<CommerceWizard scene="xhs-poster" seedPlan={seedPlan} initialTemplateId={initialTemplateId} sessionId={session.id} gateway={gateway.commerce} references={[]} capabilities={IMAGE_PROVIDER_CAPABILITIES} settings={{ provider: 'seedream', model: 'doubao-seedream-5.0-pro', aspectRatio: '1:1', resolution: '2K' }} onReferenceAdd={() => {}} onReferenceRemove={() => {}} onReferenceUploaded={() => {}} onSaved={() => {}} onClose={() => {}} />);
  return { create };
}
async function choose(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(await screen.findByRole('option', { name:option }));
}
function fill() {
  fireEvent.change(screen.getByLabelText('海报标题'), { target: { value: '周末生活提案' } });
  fireEvent.change(screen.getByLabelText('海报内容'), { target: { value: '整理书桌\n散步放松\n阅读随笔\n做一顿饭\n写下灵感\n早点休息\n慢慢喝茶' } });
}
async function preview(count = 1) {
  fireEvent.click(screen.getByRole('button', { name: '调整分图方案' }));
  await waitFor(() => expect(screen.getByRole('button', { name: `一键生成 ${count} 张` })).toBeEnabled());
}
describe('小红书海报字段方案', () => {
  it('uses a scene-compatible initial template and saves content without product references at 3:4 2K', async () => {
    const { create } = await wizard('xhs-retro'); fill();
    await preview();
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0].plan).toMatchObject({ templateId: 'xhs-retro', brief: { contentMode: 'content', platform: 'xiaohongshu', productReferenceIds: [] }, slots: [{ aspectRatio: '3:4', resolution: '2K', role: '海报封面' }] });
  });
  it('ignores an initial template from another scene and retains product image validation', async () => {
    await wizard('soft-studio');
    expect(screen.getByLabelText('风格模板').closest('.glide-select')).toHaveTextContent('清新种草');
    await choose('海报内容类型', '商品种草');
    fireEvent.change(screen.getByLabelText('商品名称'), { target: { value: '陶瓷杯' } });
    fireEvent.click(screen.getByRole('button', { name: '调整分图方案' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请上传至少一张清晰的真实商品图');
    expect(screen.getByRole('button', { name: /一键生成/ })).toBeEnabled();
  });
  it('keeps a historical template when explicitly upgrading its model before saving', async () => {
    const seedPlan: CommercePlan = {
      scene: 'xhs-poster', templateId: 'soft-studio',
      brief: { name: '历史标题', facts: '已有内容', sellingPoints: '', platform: 'xiaohongshu', placement: '图文内容', contentMode: 'content', productReferenceIds: [], styleReferenceIds: [] },
      slots: [{ id: crypto.randomUUID(), role: '海报封面', exactText: '历史标题\n已有内容', instruction: '', referenceIds: [], provider: 'gemini', model: 'gemini-3-pro-image', aspectRatio: '3:4', resolution: '2K' }],
    };
    const { create } = await wizard('xhs-retro', seedPlan);
    const historical = COMMERCE_TEMPLATES.find(template => template.id === 'soft-studio')!;
    expect(screen.getByLabelText('风格模板').closest('.glide-select')).toHaveTextContent(`历史模板 · ${historical.name}`);
    for (const guidance of screen.getAllByText(historical.guidance)) expect(guidance).toBeVisible();
    expect(seedPlan.slots[0]!.model).toBe('gemini-3-pro-image');
    fireEvent.click(screen.getByRole('button', { name: '使用当前默认参数创建新版本' }));
    await preview();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0].plan.templateId).toBe('soft-studio');
    expect(create.mock.calls[0]?.[0].plan.slots[0]).toMatchObject({ provider: 'seedream', model: 'doubao-seedream-5.0-pro', resolution: '2K' });
    expect(seedPlan.slots[0]!.model).toBe('gemini-3-pro-image');
  });
  it('splits eight cards and preserves edited copy and roles after content change and count reduction', async () => {
    const { create } = await wizard(); fill();
    await choose('方案图片数量', '8'); await preview(8);
    fireEvent.click(screen.getByRole('button', { name: '编辑第 2 张：内容卡片' }));
    expect(screen.getByLabelText('第 2 张文案')).toHaveValue('整理书桌');
    fireEvent.change(screen.getByLabelText('第 2 张文案'), { target: { value: '我的编辑文案' } });
    fireEvent.change(screen.getByLabelText('第 2 张角色'), { target: { value: '自定义内容卡' } });
    fireEvent.change(screen.getByLabelText('海报内容'), { target: { value: '新段落一\n新段落二' } });
    await choose('方案图片数量', '3'); await preview(3);
    expect(screen.getByLabelText('第 2 张文案')).toHaveValue('我的编辑文案');
    expect(screen.getByLabelText('第 2 张角色')).toHaveValue('自定义内容卡');
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0].plan.slots).toHaveLength(3);
    expect(create.mock.calls[0]?.[0].plan.slots[2]?.exactText).toBe('新段落二');
  });
});
