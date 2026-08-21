import type { GenerationBatch, Skill, TimelineItem } from '@zimage/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GenerationConfig } from '@/features/workspace/GenerationConfig';
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
  it('wires generation controls, references and skill fields', () => {
    const onAspectRatioChange = vi.fn();
    const onReferenceAdd = vi.fn();
    const onReferenceRemove = vi.fn();
    const onSkillValueChange = vi.fn();
    const { container } = render(
      <GenerationConfig
        aspectRatio="1:1"
        count={2}
        health={{ checkedAt: '2026-08-21', provider: 'Google', status: 'healthy' }}
        mode="image"
        onAspectRatioChange={onAspectRatioChange}
        onCountChange={vi.fn()}
        onReferenceAdd={onReferenceAdd}
        onReferenceRemove={onReferenceRemove}
        onResolutionChange={vi.fn()}
        onScenarioChange={vi.fn()}
        onSkillValueChange={onSkillValueChange}
        prompt="夹克"
        providerCapabilities={[
          {
            models: [{ aspectRatios: ['1:1'], id: 'model', label: 'Image', maxImages: 4, resolutions: ['1K', '2K'] }],
            provider: 'Google',
          },
        ]}
        quota={{ limit: 100, resetsAt: '2026-09-01', used: 25 }}
        references={[{ mimeType: 'image/png', name: 'ref.png', size: 100 }]}
        resolution="1K"
        scenario="happy"
        selectedSkill={skill}
        skillValues={{ product: '夹克' }}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: '商品名称' }), { target: { value: '风衣' } });
    expect(onSkillValueChange).toHaveBeenCalledWith('product', '风衣');
    fireEvent.click(screen.getByRole('button', { name: '比例 3:4' }));
    expect(onAspectRatioChange).toHaveBeenCalledWith('3:4');
    fireEvent.click(screen.getByRole('button', { name: '移除 ref.png' }));
    expect(onReferenceRemove).toHaveBeenCalledWith(0);

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['image'], 'new.png', { type: 'image/png' });
    expect(fileInput).not.toBeNull();
    if (fileInput) fireEvent.change(fileInput, { target: { files: [file] } });
    expect(onReferenceAdd).toHaveBeenCalled();
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

    fireEvent.click(screen.getByRole('button', { name: '新建创作' }));
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
