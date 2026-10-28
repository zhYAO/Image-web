import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_PROVIDER_CAPABILITIES } from '@zimage/domain';
import { HttpCommerceGateway } from '@/gateways/http-commerce-gateway';
import { CommerceTaskCard } from '@/features/commerce/CommerceTaskCard';
import { downloadCommerceFile } from '@/features/commerce/commerce-ui';
import { safeExportTask, safeExportIds as ids } from './commerce-safe-export-fixtures';

describe('explicit EC03 safe PNG action', () => {
  let fetcher: ReturnType<typeof vi.fn>;
  let gateway: HttpCommerceGateway;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', URL);
    URL.createObjectURL = vi.fn(() => 'blob:synthetic-safe-export');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetcher);
    gateway = new HttpCommerceGateway(async () => { throw new Error('synthetic preview unavailable'); });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function card(task = safeExportTask()) {
    return render(<CommerceTaskCard task={task} gateway={gateway} capabilities={IMAGE_PROVIDER_CAPABILITIES} onTask={vi.fn()} onDiscuss={vi.fn()} />);
  }

  it('offers separate PNG action and warning, leaves default JPG unchanged, and sends the current selected generation', async () => {
    const task = safeExportTask();
    // A later failed candidate must not replace the current successful selection.
    task.runs[0]!.items.push({ ...task.runs[0]!.items[0]!, generationId: ids.request, status: 'failed' });
    card(task);
    expect(screen.getByRole('combobox', { name: '导出格式' })).toHaveTextContent('JPG');
    expect(screen.getByText(/整图（含文字）.*缩小.*不能补回缺失内容/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '安全导出第 1 张 PNG' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`/api/creative-tasks/${ids.task}/download`);
    expect(JSON.parse(init.body)).toMatchObject({ mode: 'single', format: 'png', safeExport: 'ec03-white-8', selections: [{ slotId: ids.slot, generationId: ids.generation }] });
    await waitFor(() => expect(screen.getByText('已下载 commerce-safe-image.png。')).toHaveAttribute('role', 'status'));
    expect(screen.getByRole('combobox', { name: '导出格式' })).toHaveTextContent('JPG');
  });

  it.each(['soft-studio', 'detail-hero'])('does not offer safe export for %s', templateId => {
    const task = safeExportTask(); task.templateId = templateId;
    card(task);
    expect(screen.queryByRole('button', { name: /安全导出/ })).toBeNull();
  });
  it.each([{ outputSpec: 'standard' as const }, { targetWidth: 970 }, { targetHeight: 600 }])('does not offer safe export for A+ metadata %j', metadata => {
    const task = safeExportTask(); Object.assign(task.slots[0]!, metadata);
    card(task);
    expect(screen.queryByRole('button', { name: /安全导出/ })).toBeNull();
  });
  it('allows archived results, but excludes expired or missing candidates', () => {
    const task = safeExportTask(); task.archived = true;
    const view = card(task);
    expect(screen.getByRole('button', { name: /安全导出/ })).toBeEnabled();
    task.runs[0]!.items[0]!.expired = true;
    view.unmount(); card(task);
    expect(screen.queryByRole('button', { name: /安全导出/ })).toBeNull();
  });
  it('refuses safe export in mock mode rather than downloading an unmodified original', async () => {
    const mockGateway = { export: vi.fn() };
    await expect(downloadCommerceFile(mockGateway as unknown as HttpCommerceGateway, safeExportTask(), [ids.slot], 'single', 'png', undefined, 'ec03-white-8')).rejects.toThrow(/安全导出/);
    expect(mockGateway.export).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not attach the safety strategy to a default download', async () => {
    await downloadCommerceFile(gateway, safeExportTask(), [ids.slot], 'single', 'jpg');
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ mode: 'single', format: 'jpg' });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).not.toHaveProperty('safeExport');
  });
  it('reports a refused safe export without retrying or downloading an original fallback', async () => {
    fetcher.mockResolvedValue(Response.json({ message: '安全导出尺寸不支持。' }, { status: 400 }));
    card();
    fireEvent.click(screen.getByRole('button', { name: /安全导出/ }));
    await waitFor(() => expect(screen.getByText('安全导出尺寸不支持。')).toBeInTheDocument());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });
});
