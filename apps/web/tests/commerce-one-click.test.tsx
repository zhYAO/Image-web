import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCommerceSlots, IMAGE_PROVIDER_CAPABILITIES, type CommerceGateway, type CommerceTask } from '@zimage/domain';
import { CommerceWizard } from '@/features/commerce/CommerceWizard';
import { readPending, submissionStorageKey, submitCommerceOnce } from '@/features/commerce/commerce-submission';
import { loadCommerceDraft, saveCommerceDraft } from '@/features/commerce/commerce-draft-storage';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { useWorkspaceStore } from '@/store/workspace-store';
import { commerceHref, sessionHref, workspaceRoute } from '@/features/workspace/workspace-route';
import { mergeSessionActivity, sessionCategory } from '@/features/workspace/session-category';
import { createTestGateway, setupWorkspaceTest } from './workspace-test-fixtures';

setupWorkspaceTest();
beforeEach(() => { sessionStorage.clear(); window.history.replaceState({}, '', '/'); });
const settings = { provider: 'seedream', model: 'doubao-seedream-5.0-pro', aspectRatio: '1:1' as const, resolution: '2K' as const };

describe('commerce navigation and durable drafts', () => {
  it('preserves legacy scenes and real task/view addresses', () => {
    expect(workspaceRoute('/create')).toEqual({ kind: 'catalogue' });
    expect(workspaceRoute('/', 'scene=xhs-poster&platform=xiaohongshu')).toMatchObject({ kind: 'commerce', scene: 'xhs-poster' });
    expect(commerceHref('xhs-poster')).toBe('/create/xhs-poster?platform=xiaohongshu');
    expect(workspaceRoute('/create/unknown')).toEqual({ kind: 'invalid' });
    expect(workspaceRoute('/sessions/mock-123', 'task=abc&view=results')).toEqual({ kind: 'session', sessionId: 'mock-123', taskId: 'abc', view: 'results' });
    expect(sessionHref('mock-123', 'abc', 'results')).toBe('/sessions/mock-123?task=abc&view=results');
  });

  it('browses scenes without creating sessions and restores the correct scene draft on back', async () => {
    const gateway = createTestGateway();
    const create = vi.spyOn(gateway, 'createSession');
    const props = { gateway, onNavigate: vi.fn(), ownerKey: 'owner' };
    const view = render(<UnifiedWorkspace {...props} route={{ kind: 'commerce', scene: 'product-set' }} />);
    fireEvent.change(await screen.findByLabelText('商品描述', {}, { timeout: 10000 }), { target: { value: '米白色棉质衬衫，宽松版型。' } });
    act(() => useWorkspaceStore.getState().setSelectedChatModel('doubao'));
    view.rerender(<UnifiedWorkspace {...props} route={{ kind: 'catalogue' }} />);
    await screen.findByRole('heading', { name: '电商生图' });
    expect(screen.queryByRole('textbox', { name: '创作输入' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: '商品描述' })).toBeNull();
    view.rerender(<UnifiedWorkspace {...props} route={{ kind: 'commerce', scene: 'product-set' }} />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '商品描述' })).toHaveValue('米白色棉质衬衫，宽松版型。'));
    view.rerender(<UnifiedWorkspace {...props} route={{ kind: 'home' }} />);
    await screen.findByRole('textbox', { name: '创作输入' }, { timeout: 10000 });
    view.rerender(<UnifiedWorkspace {...props} route={{ kind: 'commerce', scene: 'product-main' }} />);
    await screen.findByText('在左侧上传或拖放商品图片，开始创作。');
    expect(screen.getByRole('textbox', { name: '商品描述' })).toHaveValue('');
    view.rerender(<UnifiedWorkspace {...props} route={{ kind: 'commerce', scene: 'product-set' }} />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '商品描述' })).toHaveValue('米白色棉质衬衫，宽松版型。'), { timeout: 10000 });
    expect(useWorkspaceStore.getState().selectedChatModel).toBe('doubao');
    expect(create).not.toHaveBeenCalled();
    view.unmount();
    render(<UnifiedWorkspace {...props} route={{ kind: 'commerce', scene: 'product-set' }} />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '商品描述' })).toHaveValue('米白色棉质衬衫，宽松版型。'), { timeout: 10000 });
    expect(create).not.toHaveBeenCalled();
  });

  it('does not create a replacement for missing or unauthorized history', async () => {
    const gateway = createTestGateway();
    const create = vi.spyOn(gateway, 'createSession');
    render(<UnifiedWorkspace gateway={gateway} route={{ kind: 'session', sessionId: 'missing' }} onNavigate={vi.fn()} />);
    expect(await screen.findByText('会话不存在、已删除或无权访问。', {}, { timeout: 10000 })).toBeVisible();
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the catalogue visible when a background draft save finishes', async () => {
    const gateway = createTestGateway();
    let finish!: () => void;
    const original = gateway.commerce.create.bind(gateway.commerce);
    const create = vi.spyOn(gateway.commerce, 'create').mockImplementation(async input => {
      await new Promise<void>(resolve => { finish = resolve; });
      return original(input);
    });
    const onNavigate = vi.fn();
    const props = { gateway, onNavigate, ownerKey: 'delayed-owner' };
    const view = render(<UnifiedWorkspace {...props} route={{ kind: 'commerce', scene: 'product-set' }} />);
    fireEvent.change(await screen.findByLabelText('商品描述'), { target: { value: '陶瓷杯，白色陶瓷。' } });
    act(() => useWorkspaceStore.getState().setReferences([{ id: crypto.randomUUID(), name: 'product.png', size: 1, mimeType: 'image/png', status: 'ready' }]));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    view.rerender(<UnifiedWorkspace {...props} route={{ kind: 'catalogue' }} />);
    await screen.findByRole('heading', { name: '电商生图' });
    await act(async () => { finish(); await create.mock.results[0]!.value; });
    expect(screen.getByRole('heading', { name: '电商生图' })).toBeVisible();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(await gateway.commerce.list(create.mock.calls[0]![0].sessionId)).toHaveLength(1);
  });

  it('merges image and chat, prioritizes commerce, preserves types on rename and marks unresolved metadata', () => {
    const base = { id: '1', title: '电商标题不会作为证据', status: 'active' as const, createdAt: '', updatedAt: '' };
    expect(sessionCategory(base)).toBe('unknown');
    expect(sessionCategory({ ...base, activityTypes: ['image', 'chat'] })).toBe('general');
    expect(sessionCategory({ ...base, activityTypes: ['image', 'poster'] })).toBe('commerce');
    expect(sessionCategory(base, true)).toBe('commerce');
    expect(mergeSessionActivity([{ ...base, title: '改名' }], [{ ...base, activityTypes: ['commerce'] }])[0]?.activityTypes).toEqual(['commerce']);
  });

  it('replays a lost create response after remount with the original session and request identity', async () => {
    const gateway = createTestGateway();
    const ensure = vi.fn(async (title: string, id: string) => (await gateway.createSession(title, id)).id);
    const original = gateway.commerce.create.bind(gateway.commerce);
    const create = vi.spyOn(gateway.commerce, 'create');
    create.mockImplementationOnce(async input => { await original(input); throw new Error('response lost'); });
    const onSaved = vi.fn();
    const props = { scene: 'product-set' as const, sessionId: 'commerce-draft:owner:product-set', draftKey: 'owner:product-set', ensureSession: ensure,
      gateway: gateway.commerce, references: [{ id: crypto.randomUUID(), name: 'shirt.png', size: 1, mimeType: 'image/png' as const, status: 'ready' as const }],
      settings, capabilities: IMAGE_PROVIDER_CAPABILITIES, onSaved, onReferenceAdd: vi.fn(), onReferenceRemove: vi.fn(), onReferenceUploaded: vi.fn(), onClose: vi.fn() };
    const view = render(<CommerceWizard {...props} />);
    fireEvent.change(screen.getByLabelText('商品描述'), { target: { value: '米白色棉质衬衫。宽松版型，适合日常通勤。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText('response lost');
    const savedInput = create.mock.calls[0]![0];
    expect(loadCommerceDraft(props.draftKey)?.creation?.requestId).toBe(savedInput.requestId);
    view.unmount();
    render(<CommerceWizard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[1]![0]).toEqual(savedInput);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect((await gateway.commerce.list(savedInput.sessionId))).toHaveLength(1);
    expect(savedInput.plan.brief).toMatchObject({ name: '米白色棉质衬衫', description: '米白色棉质衬衫。宽松版型，适合日常通勤。' });
    expect(savedInput.plan.slots.map(slot => slot.textMode)).toEqual(['none', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto']);
  });

  it('restores the global instruction baseline without overwriting individually edited slots', async () => {
    const gateway = createTestGateway();
    const session = await gateway.createSession();
    const referenceId = crypto.randomUUID();
    const brief = { name: '衬衫', description: '米白色棉质衬衫', facts: '', sellingPoints: '', platform: 'taobao' as const,
      placement: '商品展示', productReferenceIds: [referenceId], styleReferenceIds: [] };
    const slots = buildCommerceSlots(brief, 'product-set', 2, settings).map((slot, index) => ({ ...slot, instruction: index ? '保留独立要求' : '旧整套要求' }));
    saveCommerceDraft('instruction-recovery', { scene: 'product-set', brief, count: 2, templateId: 'soft-studio', instruction: '新整套要求', lastBuiltInstruction: '旧整套要求', roles: {},
      plan: { scene: 'product-set', brief, templateId: 'soft-studio', slots } });
    const onSaved = vi.fn();
    render(<CommerceWizard scene="product-set" sessionId={session.id} draftKey="instruction-recovery" gateway={gateway.commerce}
      references={[{ id: referenceId, name: 'shirt.png', size: 1, mimeType: 'image/png', status: 'ready' }]} settings={settings}
      capabilities={IMAGE_PROVIDER_CAPABILITIES} onSaved={onSaved} onReferenceAdd={vi.fn()} onReferenceRemove={vi.fn()} onReferenceUploaded={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect((await gateway.commerce.list(session.id))[0]?.slots.map(slot => slot.instruction)).toEqual(['新整套要求', '保留独立要求']);
  });
});

describe('one-click submission recovery', () => {
  it('coalesces concurrent submits and replays the exact request after an unknown response', async () => {
    const task = { id: crypto.randomUUID(), revision: 1, slots: [{ id: crypto.randomUUID() }], runs: [] } as unknown as CommerceTask;
    let reject!: (reason: Error) => void;
    const submit = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const gateway = { submit } as unknown as CommerceGateway;
    const first = submitCommerceOnce(gateway, task);
    expect(submitCommerceOnce(gateway, task)).toBe(first);
    const expected = submit.mock.calls[0]![1];
    await act(async () => { reject(new Error('unknown')); await expect(first).rejects.toThrow('unknown'); });
    expect(readPending(submissionStorageKey(task.id))?.requestId).toBe(expected.requestId);
    submit.mockResolvedValueOnce({ ...task, runs: [{ requestId: expected.requestId }] });
    const recovered = await submitCommerceOnce(gateway, task);
    expect(submit.mock.calls[1]![1]).toEqual(expected);
    await submitCommerceOnce(gateway, recovered);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(readPending(submissionStorageKey(task.id))).toBeUndefined();
  });
});
