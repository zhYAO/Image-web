import { describe, expect, it } from 'vitest';

import { parseAssistantMessageSegments } from '@/features/workspace/assistant-message-segments';

describe('parseAssistantMessageSegments', () => {
  it('separates reasoning from the surrounding Markdown', () => {
    expect(parseAssistantMessageSegments('开场\n<think>分析 **重点**</think>\n结论', false)).toEqual([
      { content: '开场\n', type: 'markdown' },
      {
        children: [{ content: '分析 **重点**', type: 'markdown' }],
        complete: true,
        metadata: {},
        tag: 'think',
        type: 'reasoning',
      },
      { content: '\n结论', type: 'markdown' },
    ]);
  });

  it('normalizes aliases, safe metadata and nested supported tags', () => {
    expect(parseAssistantMessageSegments(
      '<reasoning>先判断<tool_call name="search" ignored="secret">查询</tool_call>'
        + '<observation status="ok">结果</observation></reasoning>',
      false,
    )).toEqual([
      {
        children: [
          { content: '先判断', type: 'markdown' },
          {
            children: [{ content: '查询', type: 'markdown' }],
            complete: true,
            metadata: { name: 'search' },
            tag: 'tool_call',
            type: 'tool_call',
          },
          {
            children: [{ content: '结果', type: 'markdown' }],
            complete: true,
            metadata: { status: 'ok' },
            tag: 'observation',
            type: 'tool_result',
          },
        ],
        complete: true,
        metadata: {},
        tag: 'reasoning',
        type: 'reasoning',
      },
    ]);
  });

  it('does not parse supported-looking tags inside Markdown code', () => {
    const content = [
      '`<think>行内示例</think>`',
      '',
      '```xml',
      '<tool name="demo">代码示例</tool>',
      '```',
    ].join('\n');

    expect(parseAssistantMessageSegments(content, false)).toEqual([{ content, type: 'markdown' }]);
  });

  it('keeps unknown and mismatched closing tags as safe Markdown text', () => {
    expect(parseAssistantMessageSegments('<custom>普通</custom><think>分析</tool></think>', false)).toEqual([
      { content: '<custom>普通</custom>', type: 'markdown' },
      {
        children: [{ content: '分析</tool>', type: 'markdown' }],
        complete: true,
        metadata: {},
        tag: 'think',
        type: 'reasoning',
      },
    ]);
  });

  it('keeps an open block live while streaming and renders it literally when the stream ends', () => {
    expect(parseAssistantMessageSegments('<tool tool="generate_image">准备参数', true)).toEqual([
      {
        children: [{ content: '准备参数', type: 'markdown' }],
        complete: false,
        metadata: { tool: 'generate_image' },
        tag: 'tool',
        type: 'tool_call',
      },
    ]);
    expect(parseAssistantMessageSegments('<tool tool="generate_image">准备参数', false)).toEqual([
      { content: '<tool tool="generate_image">准备参数', type: 'markdown' },
    ]);
  });

  it('buffers a possible tag prefix during streaming but renders it literally after completion', () => {
    expect(parseAssistantMessageSegments('答案<thi', true)).toEqual([
      { content: '答案', type: 'markdown' },
    ]);
    expect(parseAssistantMessageSegments('答案<thi', false)).toEqual([
      { content: '答案<thi', type: 'markdown' },
    ]);
  });
});
