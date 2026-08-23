import type { GenerationBatch, ProviderCapability, Skill, TimelineItem } from '@zimage/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  GenerationParameterPopover,
  normalizeGenerationSelection,
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
};

describe('workspace presentation components', () => {
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
      createdAt: '2026',
      id: 'batch',
      prompt: '商品图',
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

    fireEvent.click(screen.getByRole('button', { name: '批量下载' }));
    fireEvent.click(screen.getByRole('button', { name: '重试失败项' }));
    fireEvent.click(screen.getByRole('button', { name: '按原参数生成' }));
    expect(onDownloadBatch).toHaveBeenCalledWith(batch);
    expect(onRecreate).toHaveBeenNthCalledWith(1, batch, 'failed');
    expect(onRecreate).toHaveBeenNthCalledWith(2, batch, 'all');
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
});
