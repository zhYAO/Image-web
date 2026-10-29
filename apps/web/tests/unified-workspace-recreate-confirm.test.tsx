import type { CreditConfirmation, GenerationBatch, RecreateRequest, TimelineItem } from '@zimage/domain';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { CapturingGateway, createTestGateway, setupWorkspaceTest } from './workspace-test-fixtures';

const credit = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('@/features/credits/CreditsProvider', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/credits/CreditsProvider')>(),
  useCredits: () => ({ present: false, confirm: credit.confirm }), CreditBalance: () => null,
}));
vi.mock('@/features/workspace/WorkspaceTimeline', () => ({
  WorkspaceTimeline: ({ onRecreate, items }: { items: TimelineItem[]; onRecreate: (batch: GenerationBatch, scope: 'single' | 'all' | 'failed', id?: string) => void }) => <>
    {(['single', 'all', 'failed'] as const).map(scope => <button key={scope} onClick={() => onRecreate(batch, scope, scope === 'single' ? 'asset-1' : undefined)}>{scope}</button>)}
    <output data-testid="timeline">{items.filter(item => item.type === 'generation').map(item => item.batch.id).join(',')}</output>
  </>,
}));
const batch: GenerationBatch = {
  id: 'batch-1', sessionId: 'source-session', source: 'direct', prompt: 'test', provider: 'seedream', model: 'seedream-5.0-flash',
  config: { aspectRatio: '1:1', count: 3, resolution: '2K' }, createdAt: '2026-10-29T00:00:00Z', status: 'failed',
  assets: [{ id: 'asset-1', status: 'failed' }, { id: 'asset-2', status: 'failed', error: { code: 'CONFLICT', message: 'reconcile', retryable: false } }, { id: 'asset-3', status: 'succeeded' }],
};
class Gateway extends CapturingGateway {
  requests: RecreateRequest[] = [];
  release?: (value: GenerationBatch) => void;
  reject?: (error: Error) => void;
  override async recreateGeneration(request: RecreateRequest) {
    this.requests.push(request);
    return new Promise<GenerationBatch>((resolve, reject) => { this.release = resolve; this.reject = reject; });
  }
}
async function open() {
  await waitFor(() => expect(screen.getByRole('textbox')).not.toBeDisabled());
  const opener = await screen.findByRole('button', { name: 'single' });
  opener.focus(); fireEvent.click(opener);
  return opener;
}
const confirm = () => fireEvent.click(screen.getByRole('button', { name: '确认生成' }));
describe('recreate credit confirmation', () => {
  setupWorkspaceTest();
  beforeEach(() => { credit.confirm.mockReset().mockReturnValue({ version: 'v1', totalMinor: 120 } satisfies CreditConfirmation); });
  it.each(['button', 'escape', 'backdrop'])('cancels via %s without admission and reopens, restoring the opener', async method => {
    const gateway = createTestGateway(Gateway); batch.sessionId = (await gateway.createSession('fixture')).id;
    render(<UnifiedWorkspace gateway={gateway} />);
    const opener = await open();
    const dialog = await screen.findByRole('dialog', { name: '重新生成图片' });
    const uuid = vi.spyOn(crypto, 'randomUUID'); uuid.mockClear();
    const quota = vi.spyOn(gateway, 'getQuota'); quota.mockClear();
    if (method === 'button') fireEvent.click(screen.getByRole('button', { name: '取消' }));
    else if (method === 'escape') fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    else fireEvent.click(dialog);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus(); expect(gateway.requests).toHaveLength(0); expect(uuid).not.toHaveBeenCalled(); expect(quota).not.toHaveBeenCalled(); expect(screen.getByTestId('timeline')).toHaveTextContent('');
    fireEvent.click(opener); expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
  it.each([['single', 1], ['failed', 1], ['all', 3]] as const)('preserves %s quote and payload with duplicate suppression', async (scope, quantity) => {
    const gateway = createTestGateway(Gateway); batch.sessionId = (await gateway.createSession('fixture')).id;
    render(<UnifiedWorkspace gateway={gateway} />);
    await waitFor(() => expect(screen.getByRole('textbox')).not.toBeDisabled());
    const trigger = await screen.findByRole('button', { name: scope }); fireEvent.click(trigger); fireEvent.click(trigger);
    expect(await screen.findByRole('dialog')).toHaveTextContent(String(quantity));
    const button = screen.getByRole('button', { name: '确认生成' });
    fireEvent.click(button); fireEvent.click(button); fireEvent.click(trigger);
    expect(button).toBeDisabled(); expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]).toEqual({ batchId: batch.id, scope, generationId: scope === 'single' ? 'asset-1' : undefined, requestId: expect.any(String), billing: { version: 'v1', totalMinor: 120 } });
    expect(credit.confirm.mock.calls[0]![0][0].count).toBe(quantity);
    await act(async () => gateway.release?.({ ...batch, id: 'new-batch' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline')).toHaveTextContent('new-batch');
    fireEvent.click(screen.getByRole('button', { name: scope })); expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
  it.each([{ version: 'v2', totalMinor: 120 }, { version: 'v1', totalMinor: 240 }, undefined])('refuses changed/unavailable quote %j', async quote => {
    const gateway = createTestGateway(Gateway); batch.sessionId = (await gateway.createSession('fixture')).id; render(<UnifiedWorkspace gateway={gateway} />); await open();
    await screen.findByRole('dialog'); credit.confirm.mockReturnValue(quote); confirm();
    expect(gateway.requests).toHaveLength(0); expect(await screen.findByText('积分报价已变更，请重新确认。')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('cleans up an admission error and allows another confirmation', async () => {
    const gateway = createTestGateway(Gateway); batch.sessionId = (await gateway.createSession('fixture')).id; render(<UnifiedWorkspace gateway={gateway} />); await open(); confirm();
    await act(async () => gateway.reject?.(new Error('admission failed')));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); await open(); expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
  it('cancels owner changes and ignores obsolete asynchronous completion', async () => {
    const gateway = createTestGateway(Gateway); batch.sessionId = (await gateway.createSession('fixture')).id; const view = render(<UnifiedWorkspace gateway={gateway} ownerKey="one" />); await open();
    view.rerender(<UnifiedWorkspace gateway={gateway} ownerKey="two" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(gateway.requests).toHaveLength(0);
    await open(); confirm(); view.rerender(<UnifiedWorkspace gateway={gateway} ownerKey="three" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await open(); await act(async () => gateway.release?.({ ...batch, id: 'obsolete' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('cancels a session switch before confirmation', async () => {
    const gateway = createTestGateway(Gateway);
    const other = await gateway.createSession('other');
    batch.sessionId = (await gateway.createSession('fixture')).id;
    const view = render(<UnifiedWorkspace gateway={gateway} />);
    await open();
    view.rerender(<UnifiedWorkspace gateway={gateway} route={{ kind: 'session', sessionId: other.id }} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(gateway.requests).toHaveLength(0);
  });
  it.each([{ version: '', totalMinor: 1 }, { version: 'v1', totalMinor: -1 }, { version: 'v1', totalMinor: NaN }])('rejects invalid opening quote %j', async quote => {
    const gateway = createTestGateway(Gateway); batch.sessionId = (await gateway.createSession('fixture')).id;
    credit.confirm.mockReturnValue(quote); render(<UnifiedWorkspace gateway={gateway} />); await open();
    expect(gateway.requests).toHaveLength(0); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('积分报价暂不可用，请稍后重试。')).toBeInTheDocument();
  });
  it('shows unavailable quote feedback and allows reopening after recovery', async () => {
    const gateway = createTestGateway(Gateway); batch.sessionId = (await gateway.createSession('fixture')).id;
    render(<UnifiedWorkspace gateway={gateway} />); await open();
    credit.confirm.mockImplementation(() => { throw new Error('quote unavailable'); }); confirm();
    expect(await screen.findByText('积分报价暂不可用，请稍后重试。')).toBeInTheDocument(); expect(gateway.requests).toHaveLength(0);
    credit.confirm.mockReturnValue({ version: 'v1', totalMinor: 120 }); await open(); expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('preserves billing-disabled admission without a dialog', async () => {
    const gateway = createTestGateway(Gateway); batch.sessionId = (await gateway.createSession('fixture')).id;
    credit.confirm.mockReturnValue(undefined); render(<UnifiedWorkspace gateway={gateway} />); await open();
    expect(gateway.requests).toHaveLength(1); expect(gateway.requests[0]?.billing).toBeUndefined(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ignores a pending admission after session selection changes', async () => {
    const gateway = createTestGateway(Gateway);
    const other = await gateway.createSession('other');
    batch.sessionId = (await gateway.createSession('fixture')).id;
    const view = render(<UnifiedWorkspace gateway={gateway} />); await open(); confirm();
    const quota = vi.spyOn(gateway, 'getQuota'); quota.mockClear();
    view.rerender(<UnifiedWorkspace gateway={gateway} route={{ kind: 'session', sessionId: other.id }} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => gateway.release?.({ ...batch, id: 'obsolete-session-batch' }));
    expect(screen.getByTestId('timeline')).not.toHaveTextContent('obsolete-session-batch');
    expect(quota).not.toHaveBeenCalled();
  });
  it('ignores pending admission after unmount', async () => {
    const gateway = createTestGateway(Gateway); batch.sessionId = (await gateway.createSession('fixture')).id;
    const view = render(<UnifiedWorkspace gateway={gateway} />); await open(); confirm();
    const quota = vi.spyOn(gateway, 'getQuota'); quota.mockClear(); view.unmount();
    await act(async () => gateway.release?.({ ...batch, id: 'obsolete-unmounted-batch' }));
    expect(quota).not.toHaveBeenCalled();
  });

});
