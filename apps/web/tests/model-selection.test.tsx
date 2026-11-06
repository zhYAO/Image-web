import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { HttpWorkspaceGateway } from '@/gateways/http-workspace-gateway';
import { CapturingGateway, createTestGateway, setupWorkspaceTest } from './workspace-test-fixtures';

describe('real chat model selector', () => {
  setupWorkspaceTest();
  it('selects the registered remaining provider with keyboard and sends its ID through the existing chat request', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    const trigger = screen.getByRole('combobox', { name: '聊天模型 豆包' });
    fireEvent.keyDown(trigger, { key:'ArrowDown' });
    const list = screen.getByRole('listbox', { name:'聊天模型' });
    fireEvent.keyDown(list, { key:'Home' });
    fireEvent.keyDown(list, { key:'Enter' });
    expect(screen.getByRole('combobox', { name:'聊天模型 豆包' })).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name:'创作输入' }), { target:{ value:'解释构图' } });
    fireEvent.click(screen.getByRole('button', { name:'发送创作请求' }));
    await waitFor(() => expect(gateway.lastChatRequest?.chatModel).toBe('doubao'));
    let body: Record<string, unknown> = {};
    const http = new HttpWorkspaceGateway({ fetcher: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(`data: ${JSON.stringify({ type:'message.completed', messageId:crypto.randomUUID(), content:'完成' })}\n\n`);
    } });
    const events = [];
    for await (const event of http.streamChat(gateway.lastChatRequest!)) events.push(event);
    expect(body.chatModel).toBe('doubao');
    expect(body.tools).toBeUndefined();
    expect(events[0]?.type).toBe('message.completed');
  });
  it('closes a model list on Escape and outside pointer input without changing the selection', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');
    const trigger = screen.getByRole('combobox', { name:'聊天模型 豆包' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox'), { key:'Escape' });
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('textbox', { name:'创作输入' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-label','聊天模型 豆包');
  });
});
