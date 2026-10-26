import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { WorkspaceTimeline } from '@/features/workspace/WorkspaceTimeline';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('@/features/workspace/AssistantMessageContent', () => {
  loaded();
  return { AssistantMessageContent: ({ content }: { content: string }) => <p>{content}</p> };
});

it('loads rich message rendering only when an assistant message is displayed', async () => {
  const props = { onDownloadBatch: vi.fn(), onRecreate: vi.fn(), streamingText: '' };
  const view = render(<WorkspaceTimeline {...props} items={[]} />);
  expect(loaded).not.toHaveBeenCalled();
  view.rerender(<WorkspaceTimeline {...props} items={[]} streamingText="first streamed reply" isChatStreaming />);
  expect(await screen.findByText('first streamed reply')).toBeVisible();
  expect(loaded).toHaveBeenCalledTimes(1);
  view.rerender(<WorkspaceTimeline {...props} items={[]} streamingText="updated reply" isChatStreaming />);
  expect(await screen.findByText('updated reply')).toBeVisible();
  expect(loaded).toHaveBeenCalledTimes(1);
});
