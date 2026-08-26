import type { GenerationBatch, ProviderCapability, Skill, TimelineItem } from '@zimage/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  ChatModelPopover,
  GenerationParameterPopover,
  normalizeGenerationSelection,
  SkillPopover,
} from '@/features/workspace/GenerationConfig';
import { SessionSidebar } from '@/features/workspace/SessionSidebar';
import { WorkspaceTimeline } from '@/features/workspace/WorkspaceTimeline';
import { useWorkspaceStore } from '@/store/workspace-store';

const skill: Skill = {
  description: '商品白底图',
  fields: [{ key: 'product', label: '商品名称', required: true }],
  icon: '◇',
  id: 'white',
  name: '白底图',
  promptTemplate: '生成 {product}',
  requiresImageTool: true,
  version: '1.0.0',
};

const socialSkill: Skill = {
  ...skill,
  description: '生活化社媒氛围',
  fields: [{ key: 'scene', label: '使用场景', required: true }],
  icon: '✦',
  id: 'social',
  name: '种草图',
};

describe('workspace presentation components', () => {
  it('lets image-mode users edit the resolved skill prompt before submission', () => {
    const onPromptChange = vi.fn();
    render(
      <SkillPopover
        editablePrompt
        onClear={vi.fn()}
        onOpenChange={vi.fn()}
        onPromptChange={onPromptChange}
        onSelectSkill={vi.fn()}
        onSkillValueChange={vi.fn()}
        open
        prompt="生成 风衣"
        selectedSkill={skill}
        skills={[skill, socialSkill]}
        skillValues={{ product: '风衣' }}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: '最终提示词' }), {
      target: { value: '生成高级感风衣白底图' },
    });
    expect(onPromptChange).toHaveBeenCalledWith('生成高级感风衣白底图');
  });

  it('lists available skills and selects one without closing the popover', () => {
    const onOpenChange = vi.fn();
    const onSelectSkill = vi.fn();
    render(
      <SkillPopover
        onClear={vi.fn()}
        onOpenChange={onOpenChange}
        onSelectSkill={onSelectSkill}
        onSkillValueChange={vi.fn()}
        open
        prompt=""
        skills={[skill, socialSkill]}
        skillValues={{}}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '技能配置' });
    expect(dialog).toHaveTextContent('白底图商品白底图');
    expect(dialog).toHaveTextContent('种草图生活化社媒氛围');
    fireEvent.click(screen.getByRole('button', { name: '选择技能 种草图' }));
    expect(onSelectSkill).toHaveBeenCalledWith('social');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('selects chat providers independently and shows shared health', () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn();
    render(
      <ChatModelPopover
        health={[
          { checkedAt: '2026-08-24T00:00:00.000Z', provider: 'doubao', status: 'healthy' },
          { checkedAt: '2026-08-24T00:00:00.000Z', provider: 'minimax', status: 'degraded' },
        ]}
        onOpenChange={onOpenChange}
        onSelect={onSelect}
        open
        selectedModel="doubao"
      />,
    );
    expect(screen.getByRole('dialog', { name: '聊天模型' })).toHaveTextContent('服务正常');
    fireEvent.click(screen.getByRole('button', { name: 'minimax · MiniMax' }));
    expect(onSelect).toHaveBeenCalledWith('minimax');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the parameter popover closed until clicked and closes it with outside click or Escape', () => {
    const onAspectRatioChange = vi.fn();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <GenerationParameterPopover
        aspectRatio="1:1"
        count={2}
        model={{ aspectRatios: ['1:1', '16:9'], id: 'model', label: 'Image', maxImages: 2, resolutions: ['2K'] }}
        onAspectRatioChange={onAspectRatioChange}
        onCountChange={vi.fn()}
        onResolutionChange={vi.fn()}
        onOpenChange={onOpenChange}
        open={false}
        resolution="2K"
      />,
    );

    expect(screen.queryByRole('dialog', { name: '生成参数' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生成参数 1:1 2K 2张' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <GenerationParameterPopover
        aspectRatio="1:1"
        count={2}
        model={{ aspectRatios: ['1:1', '16:9'], id: 'model', label: 'Image', maxImages: 2, resolutions: ['2K'] }}
        onAspectRatioChange={onAspectRatioChange}
        onCountChange={vi.fn()}
        onResolutionChange={vi.fn()}
        onOpenChange={onOpenChange}
        open
        resolution="2K"
      />,
    );
    expect(screen.getByRole('dialog', { name: '生成参数' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '比例 16:9' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '比例 3:4' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成数量 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成数量 3' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '比例 16:9' }));
    expect(onAspectRatioChange).toHaveBeenCalledWith('16:9');
    fireEvent.mouseDown(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('normalizes generation values against the newly selected model capability', () => {
    const capabilities: ProviderCapability[] = [
      {
        models: [
          { aspectRatios: ['1:1', '16:9'], id: 'wide', label: 'Wide', maxImages: 2, resolutions: ['1K'] },
          { aspectRatios: ['3:4', '1:1'], id: 'portrait', label: 'Portrait', maxImages: 4, resolutions: ['1K', '2K'] },
        ],
        provider: 'Studio',
      },
    ];

    expect(normalizeGenerationSelection(capabilities, {
      aspectRatio: '16:9', count: 4, model: 'wide', provider: 'Studio', resolution: '2K',
    })).toEqual({ aspectRatio: '16:9', count: 2, model: 'wide', provider: 'Studio', resolution: '1K' });
    expect(normalizeGenerationSelection(capabilities, {
      aspectRatio: '16:9', count: 2, model: 'portrait', provider: 'Studio', resolution: '1K',
    })).toEqual({ aspectRatio: '3:4', count: 2, model: 'portrait', provider: 'Studio', resolution: '1K' });
  });

  it('supports create, select, rename, cancel and delete session actions', () => {
    const onCreate = vi.fn();
    const onDelete = vi.fn();
    const onRename = vi.fn();
    const onSelect = vi.fn();
    render(
      <SessionSidebar
        activeSessionId="s1"
        onCreate={onCreate}
        onDelete={onDelete}
        onRename={onRename}
        onSelect={onSelect}
        sessions={[{ createdAt: '2026', id: 's1', status: 'active', title: '测试会话', updatedAt: '2026' }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '新对话' }));
    fireEvent.click(screen.getByRole('button', { name: '测试会话' }));
    fireEvent.click(screen.getByRole('button', { name: '重命名 测试会话' }));
    fireEvent.change(screen.getByRole('textbox', { name: '会话名称' }), { target: { value: '新名称' } });
    fireEvent.click(screen.getByRole('button', { name: '保存会话名称' }));
    expect(onRename).toHaveBeenCalledWith('s1', '新名称');
    fireEvent.click(screen.getByRole('button', { name: '删除 测试会话' }));
    expect(onCreate).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith('s1');
    expect(onDelete).toHaveBeenCalledWith('s1');
  });

  it('renders all generation states and forwards batch actions', () => {
    const batch: GenerationBatch = {
      assets: [
        { id: 'ok', status: 'succeeded', url: 'data:image/svg+xml,ok' },
        { error: { code: 'UNKNOWN', message: '失败', retryable: true }, id: 'fail', status: 'failed' },
        { expired: true, id: 'expired', status: 'succeeded', url: 'data:image/svg+xml,expired' },
      ],
      config: { aspectRatio: '3:4', count: 3, resolution: '2K' },
      createdAt: '2026',
      id: 'batch',
      model: 'gemini-3-pro-image',
      prompt: '商品图',
      provider: 'Google Gemini',
      sessionId: 's1',
      source: 'chat_tool',
      status: 'partial',
    };
    const items: TimelineItem[] = [
      { content: '用户消息', createdAt: '2026', id: 'm1', role: 'user', sequence: 1, sessionId: 's1', type: 'message' },
      { batch, createdAt: '2026', id: 'g1', sequence: 2, sessionId: 's1', type: 'generation' },
      {
        actionLabel: '重试',
        createdAt: '2026',
        error: { code: 'UNKNOWN', message: '聊天失败', retryable: true },
        id: 'e1',
        sequence: 3,
        sessionId: 's1',
        type: 'error',
      },
    ];
    const onDownloadBatch = vi.fn();
    const onRecreate = vi.fn();
    render(
      <WorkspaceTimeline
        items={items}
        onDownloadBatch={onDownloadBatch}
        onRecreate={onRecreate}
        onSelectSkill={vi.fn()}
        skills={[skill]}
        streamingText="增量回答"
      />,
    );

    expect(screen.getByText('Google Gemini · gemini-3-pro-image · 3:4 · 2K')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新生成第 1 张' }));
    fireEvent.click(screen.getByRole('button', { name: '批量下载' }));
    fireEvent.click(screen.getByRole('button', { name: '重试失败项' }));
    fireEvent.click(screen.getByRole('button', { name: '按原参数生成' }));
    expect(onDownloadBatch).toHaveBeenCalledWith(batch);
    expect(onRecreate).toHaveBeenNthCalledWith(1, batch, 'single', 'ok');
    expect(onRecreate).toHaveBeenNthCalledWith(2, batch, 'failed');
    expect(onRecreate).toHaveBeenNthCalledWith(3, batch, 'all');
  });

  it('forwards empty-state skill selection and exercises all store actions', () => {
    const onSelectSkill = vi.fn();
    render(
      <WorkspaceTimeline
        items={[]}
        onDownloadBatch={vi.fn()}
        onRecreate={vi.fn()}
        onSelectSkill={onSelectSkill}
        skills={[skill]}
        streamingText=""
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /白底图/ }));
    expect(onSelectSkill).toHaveBeenCalledWith('white');

    const store = useWorkspaceStore.getState();
    store.setMode('image');
    store.setDraft('image', 'draft');
    store.setExplicitImageToolEnabled(true);
    store.selectSkill('white');
    store.setSkillValue('product', 'coat');
    store.setScenario('partial');
    store.setSessionDrawerOpen(true);
    store.setConfigDrawerOpen(true);
    expect(useWorkspaceStore.getState()).toMatchObject({
      configDrawerOpen: true,
      explicitImageToolEnabled: true,
      mode: 'image',
      scenario: 'partial',
      sessionDrawerOpen: true,
    });
  });

  it('shows the three-dot typing indicator before the first delta arrives', () => {
    render(
      <WorkspaceTimeline
        awaitingFirstDelta
        items={[
          {
            content: '给我一些配色建议',
            createdAt: '2026',
            id: 'm-user',
            role: 'user',
            sequence: 1,
            sessionId: 's1',
            type: 'message',
          },
        ]}
        onDownloadBatch={vi.fn()}
        onRecreate={vi.fn()}
        onSelectSkill={vi.fn()}
        skills={[skill]}
        streamingText=""
      />,
    );
    const indicator = screen.getByTestId('chat-typing-indicator');
    expect(indicator).toHaveAttribute('aria-label', 'AI 正在思考');
    expect(indicator.querySelectorAll('span')).toHaveLength(3);
    // Empty hero must not appear while we are waiting for the assistant.
    expect(screen.queryByText('你好，想创作什么？')).not.toBeInTheDocument();
  });

  it('replaces the typing indicator with streaming text once the first delta arrives', () => {
    render(
      <WorkspaceTimeline
        isChatStreaming
        items={[
          {
            content: '给我一些配色建议',
            createdAt: '2026',
            id: 'm-user',
            role: 'user',
            sequence: 1,
            sessionId: 's1',
            type: 'message',
          },
        ]}
        onDownloadBatch={vi.fn()}
        onRecreate={vi.fn()}
        onSelectSkill={vi.fn()}
        skills={[skill]}
        streamingText="好的，先聊聊"
      />,
    );
    expect(screen.queryByTestId('chat-typing-indicator')).not.toBeInTheDocument();
    expect(screen.getByText((_text, element) => (
      element?.tagName === 'P' && element.textContent === '好的，先聊聊'
    ))).toBeInTheDocument();
    expect(screen.getByLabelText('AI 正在输入')).toBeInTheDocument();
  });

  it('hides the trailing cursor the instant the chat stream ends', () => {
    const { rerender } = render(
      <WorkspaceTimeline
        isChatStreaming
        items={[]}
        onDownloadBatch={vi.fn()}
        onRecreate={vi.fn()}
        onSelectSkill={vi.fn()}
        skills={[skill]}
        streamingText="已生成的回复文本"
      />,
    );
    expect(screen.getByTestId('chat-stream-cursor')).toBeInTheDocument();

    // Simulate the post-stream render where the parent promotes the
    // streaming text into the timeline items and clears streamingText.
    rerender(
      <WorkspaceTimeline
        items={[
          {
            content: '给我一些配色建议',
            createdAt: '2026',
            id: 'm-user',
            role: 'user',
            sequence: 1,
            sessionId: 's1',
            type: 'message',
          },
          {
            content: '已生成的回复文本',
            createdAt: '2026',
            id: 'm-assistant',
            role: 'assistant',
            sequence: 2,
            sessionId: 's1',
            type: 'message',
          },
        ]}
        onDownloadBatch={vi.fn()}
        onRecreate={vi.fn()}
        onSelectSkill={vi.fn()}
        skills={[skill]}
        streamingText=""
      />,
    );

    // Cursor must be gone and only one assistant bubble may remain.
    expect(screen.queryByTestId('chat-stream-cursor')).not.toBeInTheDocument();
    expect(screen.getAllByText('已生成的回复文本')).toHaveLength(1);
  });

  it('renders completed assistant messages as standard chat Markdown', () => {
    const items: TimelineItem[] = [
      {
        content: [
          '# 回复标题',
          '',
          '包含 **粗体**、*斜体* 和 `行内代码`。',
          '',
          '- 第一项',
          '- 第二项',
          '',
          '> 一段引用',
          '',
          '| 名称 | 值 |',
          '| --- | --- |',
          '| 状态 | 正常 |',
          '',
          '[访问官网](https://example.com/docs)',
          '',
          '```ts',
          'const answer: number = 42;',
          '```',
          '',
          '![示例图片](https://example.com/preview.png)',
        ].join('\n'),
        createdAt: '2026',
        id: 'm-assistant-markdown',
        role: 'assistant',
        sequence: 1,
        sessionId: 's1',
        type: 'message',
      },
    ];

    render(
      <WorkspaceTimeline
        items={items}
        onDownloadBatch={vi.fn()}
        onRecreate={vi.fn()}
        onSelectSkill={vi.fn()}
        skills={[skill]}
        streamingText=""
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: '回复标题' })).toBeInTheDocument();
    expect(screen.getByText('粗体').tagName).toBe('STRONG');
    expect(screen.getByText('斜体').tagName).toBe('EM');
    expect(screen.getByText('行内代码').tagName).toBe('CODE');
    expect(screen.getByRole('list')).toHaveTextContent('第一项');
    expect(screen.getByText('一段引用').closest('blockquote')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('状态正常');

    const link = screen.getByRole('link', { name: '访问官网' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('const answer: number = 42;').tagName).toBe('CODE');

    const image = screen.getByRole('img', { name: '示例图片' });
    expect(image).toHaveAttribute('src', 'https://example.com/preview.png');
  });

  it('keeps user-authored Markdown literal instead of formatting it', () => {
    render(
      <WorkspaceTimeline
        items={[
          {
            content: '# 用户标题\n\n**不要加粗**',
            createdAt: '2026',
            id: 'm-user-markdown',
            role: 'user',
            sequence: 1,
            sessionId: 's1',
            type: 'message',
          },
        ]}
        onDownloadBatch={vi.fn()}
        onRecreate={vi.fn()}
        onSelectSkill={vi.fn()}
        skills={[skill]}
        streamingText=""
      />,
    );

    expect(screen.getByText(/# 用户标题/)).toHaveTextContent('# 用户标题 **不要加粗**');
    expect(screen.queryByRole('heading', { name: '用户标题' })).not.toBeInTheDocument();
    expect(screen.queryByText('不要加粗')).not.toBeInTheDocument();
  });

  it('formats incomplete streaming Markdown while keeping a transient cursor', async () => {
    render(
      <WorkspaceTimeline
        isChatStreaming
        items={[]}
        onDownloadBatch={vi.fn()}
        onRecreate={vi.fn()}
        onSelectSkill={vi.fn()}
        skills={[skill]}
        streamingText={'## 流式标题\n\n- 第一项\n- **未完成'}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '流式标题' })).toBeInTheDocument();
    expect(await screen.findByRole('list')).toHaveTextContent('第一项');
    expect(await screen.findByText((_text, element) => (
      element?.tagName === 'STRONG' && element.textContent === '未完成'
    ))).toBeInTheDocument();
    expect(screen.getByTestId('chat-stream-cursor')).toBeInTheDocument();
  });

  it('does not execute raw HTML or load unsafe Markdown URLs', () => {
    render(
      <WorkspaceTimeline
        items={[
          {
            content: [
              '<script>window.markdownAttack = true</script>',
              '<img alt="原始图片" src="https://example.com/raw.png" onerror="window.markdownAttack = true">',
              '[危险链接](javascript:alert(1))',
              '![危险图片](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)',
            ].join('\n\n'),
            createdAt: '2026',
            id: 'm-assistant-unsafe-markdown',
            role: 'assistant',
            sequence: 1,
            sessionId: 's1',
            type: 'message',
          },
        ]}
        onDownloadBatch={vi.fn()}
        onRecreate={vi.fn()}
        onSelectSkill={vi.fn()}
        skills={[skill]}
        streamingText=""
      />,
    );

    expect(document.querySelector('script')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '原始图片' })).not.toBeInTheDocument();
    expect(screen.getByText('危险链接').closest('a')).not.toHaveAttribute('href', 'javascript:alert(1)');
    expect(screen.queryByRole('img', { name: '危险图片' })).not.toBeInTheDocument();
  });

  it('expands streaming reasoning and collapses it after completion', () => {
    const { rerender } = render(
      <WorkspaceTimeline
        isChatStreaming
        items={[]}
        onDownloadBatch={vi.fn()}
        onRecreate={vi.fn()}
        onSelectSkill={vi.fn()}
        skills={[skill]}
        streamingText="<think>正在分析 **构图**"
      />,
    );

    expect(screen.getByRole('button', { name: '正在思考' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('构图').closest('strong')).toBeInTheDocument();

    rerender(
      <WorkspaceTimeline
        items={[{
          content: '<think>正在分析 **构图**</think>最终答案',
          createdAt: '2026',
          id: 'm-reasoning',
          role: 'assistant',
          sequence: 1,
          sessionId: 's1',
          type: 'message',
        }]}
        onDownloadBatch={vi.fn()}
        onRecreate={vi.fn()}
        onSelectSkill={vi.fn()}
        skills={[skill]}
        streamingText=""
      />,
    );

    const summary = screen.getByRole('button', { name: '已思考' });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('构图')).not.toBeInTheDocument();
    fireEvent.click(summary);
    expect(screen.getByText('构图').tagName).toBe('STRONG');
    expect(screen.getByText('最终答案')).toBeInTheDocument();
  });

  it('renders tool calls and results as inert collapsible blocks', () => {
    render(
      <WorkspaceTimeline
        items={[{
          content: '<tool_call name="search">输入参数</tool_call><tool_result status="ok">返回结果</tool_result>',
          createdAt: '2026',
          id: 'm-tools',
          role: 'assistant',
          sequence: 1,
          sessionId: 's1',
          type: 'message',
        }]}
        onDownloadBatch={vi.fn()}
        onRecreate={vi.fn()}
        onSelectSkill={vi.fn()}
        skills={[skill]}
        streamingText=""
      />,
    );

    const toolCall = screen.getByRole('button', { name: '调用工具 · search' });
    const toolResult = screen.getByRole('button', { name: '工具结果 · ok' });
    expect(toolCall).toHaveAttribute('aria-expanded', 'false');
    expect(toolResult).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('输入参数')).not.toBeInTheDocument();
    fireEvent.click(toolCall);
    expect(screen.getByText('输入参数')).toBeInTheDocument();
  });
});
