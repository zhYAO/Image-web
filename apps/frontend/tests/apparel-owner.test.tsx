import type { ReactNode } from "react";
import { NavigationProvider } from "../src/platform/navigation";
import { act, cleanup, fireEvent, render as renderUI, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ApparelGateway, ApparelTask } from '@zimage/domain';
import { ApparelWorkspace } from '../../web/features/commerce/ApparelWorkspace';

const render = (ui: ReactNode) => renderUI(<NavigationProvider>{ui}</NavigationProvider>);

const ids = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const task: ApparelTask = { id: ids[8]!, sessionId: ids[9]!, engine: 'apparel-catalog', revision: 1, archived: false, createdAt: 'now', updatedAt: 'now', runs: [], plan: {
  engine: 'apparel-catalog', scene: 'apparel-catalog', layoutVersion: '1.0.0',
  brief: { name: 'owner A private shirt', sku: 'A1', color: 'white', composition: 'linen', care: 'cold wash', size: 'M',
    measurements: { length: '65', chest: '100', shoulder: '40', sleeve: '58' }, weightRecommendation: '45-55kg', design: 'simple', fabric: 'linen' },
  sources: { mains: ids.slice(0, 5), displays: [{ id: ids[5]!, name: 'display.jpg' }], logo: ids[6]! }, fabricCrop: [0.24, 0.2, 0.76, 0.57],
} };
const props = { ownerKey: 'owner-A', sessionId: task.sessionId, references: [], onReferenceAdd: vi.fn(), onReferenceRemove: vi.fn() };
beforeEach(() => { window.sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("does not transfer old owner data after changing the apparel workspace owner", () => {
  const prepare = vi.fn(() => true);
  const old = render(<ApparelWorkspace {...props} task={task} onPrepareModelPrompt={prepare} />);
  old.unmount();
  render(<ApparelWorkspace {...props} ownerKey="owner-B" onPrepareModelPrompt={prepare} />);
  fireEvent.click(screen.getByRole("button", { name: "前往生图工作台" }));
  expect(prepare).not.toHaveBeenCalled();
});
it('does not click an old apparel ZIP after download resolves under a new mount', async () => {
  let finish!: (blob: Blob) => void;
  const download = vi.fn(() => new Promise<Blob>(resolve => { finish = resolve; }));
  const gateway = { download } as unknown as ApparelGateway;
  const complete = { ...task, runs: [{ id: ids[7]!, requestId: ids[6]!, revision: 1, status: 'succeeded' as const, createdAt: 'now', assets: [] }] };
  const create = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const view = render(<ApparelWorkspace {...props} task={complete} gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: '下载原始 JPEG ZIP' }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  view.unmount(); window.sessionStorage.clear();
  render(<ApparelWorkspace {...props} ownerKey="owner-B" />);
  await act(async () => { finish(new Blob(['owner A private zip'])); });
  expect(create).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
});
