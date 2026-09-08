import type { WorkspaceGateway } from '@zimage/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { setupWorkspaceTest, CapturingGateway, SeedreamOnlyGateway, MultiModelGateway, ControlledImageGateway, FailOnceImageGateway, createTestGateway } from './workspace-test-fixtures';

describe('UnifiedWorkspace', () => {
  setupWorkspaceTest();

  it('keeps the create-image tool enabled after a queued request', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    const imageTool = screen.getByRole('button', { name: '创建图片' });
    fireEvent.click(imageTool);
    expect(imageTool).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '生成商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(gateway.lastImageRequest).toBeDefined());
    expect(gateway.lastChatRequest).toBeUndefined();
    expect(imageTool).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders an image conversation turn immediately while queue admission is pending', async () => {
    const gateway = createTestGateway(ControlledImageGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '生成一只在海边奔跑的白猫' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    expect(screen.getByTestId('optimistic-image-turn')).toHaveTextContent('生成一只在海边奔跑的白猫');
    expect(screen.getAllByText('等待队列处理')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: '创作输入' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '创建图片' })).toHaveAttribute('aria-pressed', 'true');

    gateway.releaseImageAdmission();
    await waitFor(() => expect(screen.queryByTestId('optimistic-image-turn')).not.toBeInTheDocument());
  });

  it('retries a failed image admission in the same conversation turn', async () => {
    const gateway = createTestGateway(FailOnceImageGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '生成需要重试的商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    const retry = await screen.findByRole('button', { name: '重试生成' });
    expect(screen.getAllByText('生成需要重试的商品图')).toHaveLength(1);
    fireEvent.click(retry);

    await waitFor(() => expect(gateway.attempts).toBe(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试生成' })).not.toBeInTheDocument());
    expect(screen.getAllByText('生成需要重试的商品图')).toHaveLength(1);
  });

  it('uses the first available image provider for the initial image request', async () => {
    const gateway = createTestGateway(SeedreamOnlyGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '请生成一张白底马克杯商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() => expect(gateway.lastImageRequest).toBeDefined());
    expect(gateway.lastImageRequest?.provider).toBe('seedream');
  });

  it('blocks a direct image request for an unavailable image provider', async () => {
    const gateway = createTestGateway(SeedreamOnlyGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.click(screen.getByRole('button', { name: /图片设置/ }));
    fireEvent.click(screen.getByRole('button', { name: 'gemini · Gemini 3 Pro Image' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '请生成一张白底马克杯商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    expect(await screen.findByText('所选服务暂时不可用，请选择其他 provider。')).toBeInTheDocument();
    expect(gateway.lastImageRequest).toBeUndefined();
  });

  it('allows ordinary chat when only the selected image provider is unavailable', async () => {
    const gateway = createTestGateway(SeedreamOnlyGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.click(screen.getByRole('button', { name: /图片设置/ }));
    fireEvent.click(screen.getByRole('button', { name: 'gemini · Gemini 3 Pro Image' }));
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '只讨论白底商品图的构图原则' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() => expect(gateway.lastChatRequest).toBeDefined());
    expect(gateway.lastImageRequest).toBeUndefined();
  });

  it('forwards the generation id from a failed asset into single recreation', async () => {
    const gateway = createTestGateway(CapturingGateway);
    const session = await gateway.createSession('失败批次');
    const pending = await gateway.submitImage({
      aspectRatio: '1:1',
      count: 1,
      model: 'seedream-4.5',
      prompt: '失败图片',
      provider: 'seedream',
      resolution: '2K',
      scenario: 'provider-unavailable',
      sessionId: session.id,
    });
    await waitFor(async () => expect((await gateway.getGenerationBatch(pending.id)).status).toBe('failed'));
    const failed = await gateway.getGenerationBatch(pending.id);
    const generationId = failed.assets[0]!.id;

    render(<UnifiedWorkspace gateway={gateway} />);
    fireEvent.click(await screen.findByRole('button', { name: '失败批次' }));
    await screen.findByText('失败图片');
    fireEvent.click(screen.getByRole('button', { name: '重新生成第 1 张' }));

    await waitFor(() => expect(gateway.lastRecreateRequest).toBeDefined());
    expect(gateway.lastRecreateRequest).toEqual({
      batchId: failed.id,
      generationId,
      scope: 'single',
    });
  });

  it('only renders the mock scenario selector for a real mock gateway', async () => {
    const mockGateway = createTestGateway();
    const delegatedGateway = new Proxy({} as WorkspaceGateway, {
      get(_target, property) {
        const value = Reflect.get(mockGateway, property, mockGateway) as unknown;
        return typeof value === 'function' ? value.bind(mockGateway) : value;
      },
    });

    const { unmount } = render(<UnifiedWorkspace gateway={delegatedGateway} />);
    await screen.findByText('你好，想创作什么？');
    expect(screen.queryByRole('combobox', { name: 'Mock 场景' })).not.toBeInTheDocument();
    unmount();

    render(<UnifiedWorkspace gateway={mockGateway} />);
    await screen.findByText('你好，想创作什么？');
    expect(screen.getByRole('combobox', { name: 'Mock 场景' })).toBeInTheDocument();
  });

  it('uses the selected provider, model and generation parameters in the image request', async () => {
    const gateway = createTestGateway(MultiModelGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));

    fireEvent.click(screen.getByRole('button', { name: '图片设置 Studio Wide 1:1 1K 2张' }));
    fireEvent.click(screen.getByRole('button', { name: '比例 16:9' }));
    fireEvent.click(screen.getByRole('button', { name: 'Studio · Portrait' }));
    expect(screen.getByRole('button', { name: '图片设置 Studio Portrait 3:4 1K 2张' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '分辨率 2K' }));
    fireEvent.click(screen.getByRole('button', { name: '生成数量 4' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '生成一张秋日产品海报' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() => expect(gateway.lastImageRequest).toBeDefined());
    expect(gateway.lastImageRequest).toMatchObject({
      aspectRatio: '3:4',
      count: 4,
      model: 'portrait',
      provider: 'Studio',
      resolution: '2K',
    });
  }, 60_000);


});
