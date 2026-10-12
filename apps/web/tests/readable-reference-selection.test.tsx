import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IMAGE_PROVIDER_CAPABILITIES } from '@zimage/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceWizard } from '@/features/commerce/CommerceWizard';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { useWorkspaceStore } from '@/store/workspace-store';
import { referencePng, stubReferenceBitmap } from './reference-file-fixtures';
import { createTestGateway, setupWorkspaceTest } from './workspace-test-fixtures';

describe('readable reference selection', () => {
  setupWorkspaceTest();
  beforeEach(() => { stubReferenceBitmap(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('accepts a PNG with no declared MIME and keeps the original File and role key', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    const file = new File([referencePng], 'product.data');
    fireEvent.change(screen.getByLabelText('上传参考图'), { target: { files: [file] } });
    await screen.findByRole('img', { name: '参考图 product.data' });
    expect(useWorkspaceStore.getState().references[0]).toMatchObject({ file, name: file.name, mimeType: 'image/png', size: file.size });
    expect(useWorkspaceStore.getState().references[0]?.file).toBe(file);
  });

  it('does not attach a decode that finishes after changing composer', async () => {
    let release!: () => void;
    const decoding = vi.fn(() => new Promise(resolve => { release = () => resolve({ width: 64, height: 48, close: vi.fn() }); }));
    vi.stubGlobal('createImageBitmap', decoding);
    const { rerender } = render(<UnifiedWorkspace gateway={createTestGateway()} ownerKey="first" />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: '生成商品图' } });
    fireEvent.change(screen.getByLabelText('上传参考图'), { target: { files: [new File([referencePng], 'product.data')] } });
    await waitFor(() => expect(decoding).toHaveBeenCalledOnce());
    rerender(<UnifiedWorkspace gateway={createTestGateway()} ownerKey="second" />);
    try {
      await waitFor(() => expect(screen.getByRole('button', { name: '发送创作请求' })).not.toBeDisabled());
    } finally { release(); }
    expect(useWorkspaceStore.getState().references).toHaveLength(0);
  });

  it('lets product-set selection reach content preparation without a MIME prerequisite', async () => {
    const add = vi.fn();
    render(<CommerceWizard sessionId={crypto.randomUUID()} scene="product-set" references={[]} capabilities={IMAGE_PROVIDER_CAPABILITIES}
      settings={{ provider: 'seedream', model: 'doubao-seedream-5.0-pro', aspectRatio: '1:1', resolution: '2K' }}
      onReferenceAdd={add} onReferenceRemove={() => undefined} onReferenceUploaded={() => undefined}
      onSaved={() => undefined} onClose={() => undefined} />);
    const file = new File([referencePng], 'product.data');
    fireEvent.change(screen.getByLabelText('上传电商参考图'), { target: { files: [file] } });
    await waitFor(() => expect(add).toHaveBeenCalledWith([file]));
  });

  it('keeps preparations separate when the route changes within the same composer', async () => {
    const releases: Array<() => void> = [];
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise(resolve => {
      releases.push(() => resolve({ width: 64, height: 48, close: vi.fn() }));
    })));
    const gateway = createTestGateway();
    const { rerender } = render(<UnifiedWorkspace gateway={gateway} route={{ kind: 'home' }} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: '生成商品图' } });
    fireEvent.change(screen.getByLabelText('上传参考图'), { target: { files: [new File([referencePng], 'old.data')] } });
    await waitFor(() => expect(releases).toHaveLength(1));
    rerender(<UnifiedWorkspace gateway={gateway} route={{ kind: 'home' }} />);
    fireEvent.change(screen.getByLabelText('上传参考图'), { target: { files: [new File([referencePng], 'current.data')] } });
    await waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!();
    try {
      await screen.findByRole('img', { name: '参考图 current.data' });
      await waitFor(() => expect(screen.getByRole('button', { name: '发送创作请求' })).not.toBeDisabled());
    } finally { releases[0]!(); }
    expect(useWorkspaceStore.getState().references.map(reference => reference.name)).toEqual(['current.data']);
  });
});
