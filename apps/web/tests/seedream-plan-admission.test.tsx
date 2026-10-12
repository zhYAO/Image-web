import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildCommerceSlots, IMAGE_PROVIDER_CAPABILITIES } from '@zimage/domain';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { useWorkspaceStore } from '@/store/workspace-store';
import { createImageService, hashCanonicalRequest } from '@/server/image/image-service';
import { CommerceWizard } from '@/features/commerce/CommerceWizard';
import { saveCommerceDraft } from '@/features/commerce/commerce-draft-storage';
import { setupWorkspaceTest, CapturingGateway, createTestGateway } from './workspace-test-fixtures';

describe('Plan Pro admission and restored draft identity', () => {
  setupWorkspaceTest();

  it('requires an explicit model update before submitting a retired composer draft', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    act(() => { useWorkspaceStore.setState({ selectedProvider: 'seedream', selectedModelId: 'seedream-5.0-pro' }); });
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    const input = screen.getByRole('textbox', { name: '创作输入' });
    fireEvent.change(input, { target: { value: '保留原商品说明' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    expect(gateway.lastImageRequest).toBeUndefined();
    expect(input).toHaveValue('保留原商品说明');
    expect(useWorkspaceStore.getState().selectedModelId).toBe('seedream-5.0-pro');
    fireEvent.click(screen.getByRole('button', { name: '更新为 Seedream 5.0 Pro' }));
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(gateway.lastImageRequest?.model).toBe('doubao-seedream-5.0-pro'));
  });

  it.each(['seedream-5.0-flash', 'seedream-5.0-pro', 'gemini-3-pro-image'])('rejects new server admissions using %s', async model => {
    const service = createImageService({ submit: async () => { throw new Error('must not submit'); } });
    await expect(service.prepare(crypto.randomUUID(), { provider: model.startsWith('gemini') ? 'gemini' : 'seedream', model, prompt: '新请求', params: { aspectRatio: '1:1', resolution: '2K', count: 1 } }, crypto.randomUUID(), crypto.randomUUID())).rejects.toMatchObject({ code: 'bad_request', status: 400, message: expect.stringContaining('主动更新') });
  });

  it('recovers a committed retired-model request against its original registry without admitting new work', async () => {
    const userId = crypto.randomUUID(), sessionId = crypto.randomUUID();
    const request = { provider: 'seedream', model: 'seedream-5.0-pro', prompt: 'original prompt', params: { aspectRatio: '1:1' as const, resolution: '2K' as const, count: 1 }, sessionId };
    const config = { ...request.params, registryVersion: '2026-10-06.1' };
    const snapshot = { batchId: crypto.randomUUID(), sessionId, config, model: request.model, provider: request.provider, source: 'direct' as const, requestHash: await hashCanonicalRequest({ config, model: request.model, prompt: request.prompt, provider: request.provider, sessionId, source: 'direct', userId }) };
    let admissions = 0;
    const service = createImageService({ lookupSubmission: async () => snapshot, submit: async () => { admissions++; throw new Error('must not admit'); } });
    expect(await service.submit(userId, request, crypto.randomUUID(), crypto.randomUUID())).toEqual({ batchId: snapshot.batchId, sessionId, status: 'pending' });
    await expect(service.submit(userId, { ...request, prompt: 'changed prompt' }, crypto.randomUUID(), crypto.randomUUID())).rejects.toMatchObject({ code: 'conflict' });
    expect(admissions).toBe(0);
  });

  it('replays a lost commerce create response using its unchanged retired-model plan', async () => {
    const gateway = createTestGateway(CapturingGateway);
    const sessionId = crypto.randomUUID(), referenceId = crypto.randomUUID(), requestId = crypto.randomUUID();
    const settings = { provider: 'seedream', model: 'seedream-5.0-pro', aspectRatio: '1:1' as const, resolution: '2K' as const };
    const brief = { name: '原商品', facts: '白色陶瓷', sellingPoints: '', platform: 'taobao' as const, placement: '商品展示', productReferenceIds: [referenceId], styleReferenceIds: [] };
    const plan = { scene: 'product-main' as const, templateId: 'white-main', brief, slots: buildCommerceSlots(brief, 'product-main', 1, settings) };
    saveCommerceDraft(sessionId, { scene: plan.scene, brief, count: 1, templateId: plan.templateId, instruction: '', roles: {}, settings, plan, creation: { requestId, plan } });
    const task = { ...plan, id: crypto.randomUUID(), sessionId, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), slotHashes: {}, runs: [], selections: [], archived: false };
    const create = vi.spyOn(gateway.commerce, 'create').mockResolvedValue(task);
    const onSaved = vi.fn();
    render(<CommerceWizard scene={plan.scene} sessionId={sessionId} gateway={gateway.commerce} references={[{ id: referenceId, name: '商品.png', mimeType: 'image/png', size: 100, status: 'ready' }]} capabilities={IMAGE_PROVIDER_CAPABILITIES} settings={settings} onReferenceAdd={() => {}} onReferenceRemove={() => {}} onReferenceUploaded={() => {}} onSaved={onSaved} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(task, false));
    expect(create).toHaveBeenCalledExactlyOnceWith({ sessionId, requestId, plan });
  });
});
