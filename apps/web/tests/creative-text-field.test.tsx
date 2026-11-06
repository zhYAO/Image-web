import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { IMAGE_PROVIDER_CAPABILITIES, type CreativeTextFieldName } from '@zimage/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreativeTextField } from '@/features/commerce/CreativeTextField';
import { useWorkspaceStore } from '@/store/workspace-store';
import { CommerceWizard } from '@/features/commerce/CommerceWizard';

function Harness({ initial = '旧文案', field = 'title' }: { initial?: string; field?: CreativeTextFieldName }) {
  const [value, setValue] = useState(initial);
  return <CreativeTextField field={field} label="标题" value={value} onChange={setValue} />;
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); useWorkspaceStore.setState({ selectedChatModel: 'doubao' }); });
describe('current-field AI editing', () => {
  it.each(['product-set', 'clone', 'product-main'] as const)('uses Doubao for %s field optimization without changing the homepage model', async scene => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
    useWorkspaceStore.setState({ selectedChatModel: 'minimax' });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '已优化陶瓷杯', mock: false })));
    vi.stubGlobal('fetch', fetcher);
    render(<CommerceWizard scene={scene} sessionId={crypto.randomUUID()} references={[{ id: crypto.randomUUID(), name: 'product.png', mimeType: 'image/png', size: 1, status: 'ready' }]}
      promotedStyleIds={scene === 'clone' ? [] : undefined} capabilities={IMAGE_PROVIDER_CAPABILITIES} settings={{ provider: 'seedream', model: 'doubao-seedream-5.0-pro', aspectRatio: '1:1', resolution: '2K' }}
      onReferenceAdd={vi.fn()} onReferenceRemove={vi.fn()} onReferenceUploaded={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
    if (scene === 'product-main') fireEvent.click(screen.getByRole('button', { name: '自定义' }));
    const field = screen.getByLabelText(scene === 'clone' ? '统一复刻要求（选填）' : scene === 'product-main' ? '场景描述' : '商品描述');
    fireEvent.change(field, { target: { value: '陶瓷杯' } });
    fireEvent.click(within(field.parentElement!).getByRole('button', { name: 'AI 优化当前内容' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).chatModel).toBe('doubao');
    expect(useWorkspaceStore.getState().selectedChatModel).toBe('minimax');
  });
  it('uses the workspace chat model without creating a conversation message', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
    useWorkspaceStore.setState({ selectedChatModel: 'minimax' });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '优化文案', mock: false })));
    vi.stubGlobal('fetch', fetcher);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化当前内容' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('优化文案'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/creative-text/optimize');
    expect(JSON.parse(options.body)).toMatchObject({ chatModel: 'doubao', field: 'title', text: '旧文案' });
  });
  it.each([
    ['旧文案', '原文已保留', false],
    ['旧文案。', '仅调整格式', true],
    ['重新整理后的文案', '已润色', true],
  ] as const)('reports the actual change for %s without extra requests', async (text, status, undo) => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text, mock: false })));
    vi.stubGlobal('fetch', fetcher);
    render(<Harness field="description" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化当前内容' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(status));
    expect(screen.getByRole('textbox')).toHaveValue(text);
    expect(Boolean(screen.queryByRole('button', { name: '撤销优化' }))).toBe(undo);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ field: 'description', text: '旧文案' });
  });
  it('disables empty optimization', () => {
    render(<Harness initial=" " />);
    expect(screen.getByRole('button', { name: 'AI 优化当前内容' })).toBeDisabled();
  });
  it('retains edits during a request, then applies suggestion with one undo', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetcher);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化当前内容' }));
    expect(screen.getByRole('button', { name: 'AI 优化当前内容' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '手工新文案' } });
    await act(async () => resolve(new Response(JSON.stringify({ text: '优化文案', mock: false }))));
    expect(screen.getByRole('textbox')).toHaveValue('手工新文案');
    fireEvent.click(await screen.findByRole('button', { name: '应用建议' }));
    expect(screen.getByRole('textbox')).toHaveValue('优化文案');
    fireEvent.click(screen.getByRole('button', { name: '撤销优化' }));
    expect(screen.getByRole('textbox')).toHaveValue('手工新文案');
    expect(screen.queryByRole('button', { name: '撤销优化' })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('cancellation keeps content even when the server responds late', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化当前内容' }));
    fireEvent.click(screen.getByRole('button', { name: '取消优化' }));
    await act(async () => resolve(new Response(JSON.stringify({ text: '过时结果', mock: false }))));
    expect(screen.getByRole('textbox')).toHaveValue('旧文案');
    expect(screen.queryByRole('button', { name: '应用建议' })).not.toBeInTheDocument();
  });
  it('cancels a request when the reused field changes meaning without changing text', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
    let resolve!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
      signal = options.signal ?? undefined;
      return new Promise<Response>(done => { resolve = done; });
    }));
    const view = render(<Harness field="title" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化当前内容' }));
    view.rerender(<Harness field="name" />);
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(new Response(JSON.stringify({ text: '旧标题优化结果', mock: false }))));
    expect(screen.getByRole('textbox')).toHaveValue('旧文案');
    expect(screen.queryByRole('button', { name: '应用建议' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销优化' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 整理格式' })).toBeEnabled();
  });
  it('clears a pending suggestion when the field type changes', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const view = render(<Harness field="title" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化当前内容' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '手工内容' } });
    await act(async () => resolve(new Response(JSON.stringify({ text: '旧建议', mock: false }))));
    expect(screen.getByRole('button', { name: '应用建议' })).toBeVisible();
    view.rerender(<Harness field="name" />);
    expect(screen.getByRole('textbox')).toHaveValue('手工内容');
    expect(screen.queryByRole('button', { name: '应用建议' })).not.toBeInTheDocument();
  });
  it('clears the previous field undo without reverting its accepted text', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '已优化标题', mock: false }))));
    const view = render(<Harness field="title" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化当前内容' }));
    await screen.findByRole('button', { name: '撤销优化' });
    view.rerender(<Harness field="name" />);
    expect(screen.getByRole('textbox')).toHaveValue('已优化标题');
    expect(screen.queryByRole('button', { name: '撤销优化' })).not.toBeInTheDocument();
  });
  it('mock explicitly labels local optimization and supports undo', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'mock');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    render(<Harness initial="商品  1,000ml" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化当前内容' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('商品 1,000ml。'));
    expect(screen.getByRole('status')).toHaveTextContent('Mock');
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '撤销优化' }));
    expect(screen.getByRole('textbox')).toHaveValue('商品  1,000ml');
  });
  it('retains input on network failure', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化当前内容' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('优化失败'));
    expect(screen.getByRole('textbox')).toHaveValue('旧文案');
  });
});
