export type AssistantMessageSegment = MarkdownSegment | StructuredSegment;

export interface MarkdownSegment {
  content: string;
  type: 'markdown';
}

export interface StructuredSegment {
  children: AssistantMessageSegment[];
  complete: boolean;
  metadata: {
    name?: string;
    status?: string;
    tool?: string;
  };
  tag: SupportedTag;
  type: 'reasoning' | 'tool_call' | 'tool_result';
}

type SupportedTag = 'observation' | 'reasoning' | 'think' | 'tool' | 'tool_call' | 'tool_result';

interface OpenSegment {
  segment: StructuredSegment;
  startIndex: number;
  target: AssistantMessageSegment[];
}

const tagTypes: Record<SupportedTag, StructuredSegment['type']> = {
  observation: 'tool_result',
  reasoning: 'reasoning',
  think: 'reasoning',
  tool: 'tool_call',
  tool_call: 'tool_call',
  tool_result: 'tool_result',
};

const supportedTags = Object.keys(tagTypes) as SupportedTag[];
const tagPattern = /<\s*(\/)?\s*(think|reasoning|tool|tool_call|tool_result|observation)\b([^>]*)>/gi;
const attributePattern = /\b(name|tool|status)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

function createCodeMask(content: string) {
  const mask = Array.from<boolean>({ length: content.length }).fill(false);
  let delimiterLength = 0;
  let index = 0;

  while (index < content.length) {
    if (content[index] !== '`') {
      if (delimiterLength > 0) mask[index] = true;
      index += 1;
      continue;
    }

    let runLength = 1;
    while (content[index + runLength] === '`') runLength += 1;
    const closesCode = delimiterLength > 0 && runLength >= delimiterLength;
    const opensCode = delimiterLength === 0;
    for (let offset = 0; offset < runLength; offset += 1) mask[index + offset] = true;
    if (opensCode) delimiterLength = runLength;
    else if (closesCode) delimiterLength = 0;
    index += runLength;
  }

  return mask;
}

function appendMarkdown(target: AssistantMessageSegment[], content: string) {
  if (!content) return;
  const last = target.at(-1);
  if (last?.type === 'markdown') last.content += content;
  else target.push({ content, type: 'markdown' });
}

function safeMetadata(attributes: string): StructuredSegment['metadata'] {
  const metadata: StructuredSegment['metadata'] = {};
  attributePattern.lastIndex = 0;
  for (const match of attributes.matchAll(attributePattern)) {
    const key = match[1]?.toLowerCase() as keyof StructuredSegment['metadata'] | undefined;
    const rawValue = match[2] ?? match[3] ?? match[4];
    if (!key || rawValue === undefined) continue;
    const value = rawValue.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
    if (value) metadata[key] = value;
  }
  return metadata;
}

function splitPendingTagPrefix(content: string) {
  const openingIndex = content.lastIndexOf('<');
  if (openingIndex < 0) return { content, pending: '' };
  const candidate = content.slice(openingIndex);
  const match = /^<\s*(\/)?\s*([a-z_]*)$/i.exec(candidate);
  if (!match) return { content, pending: '' };
  const namePrefix = match[2]?.toLowerCase() ?? '';
  if (!supportedTags.some((tag) => tag.startsWith(namePrefix))) return { content, pending: '' };
  return { content: content.slice(0, openingIndex), pending: candidate };
}

export function parseAssistantMessageSegments(
  content: string,
  streaming: boolean,
): AssistantMessageSegment[] {
  const root: AssistantMessageSegment[] = [];
  const stack: OpenSegment[] = [];
  const codeMask = createCodeMask(content);
  let cursor = 0;

  const currentTarget = () => stack.at(-1)?.segment.children ?? root;
  tagPattern.lastIndex = 0;
  for (const match of content.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    if (codeMask[index]) continue;
    appendMarkdown(currentTarget(), content.slice(cursor, index));

    const rawTag = match[0];
    const closing = Boolean(match[1]);
    const tag = match[2]?.toLowerCase() as SupportedTag;
    if (closing) {
      const active = stack.at(-1);
      if (!active || active.segment.tag !== tag) appendMarkdown(currentTarget(), rawTag);
      else {
        active.segment.complete = true;
        stack.pop();
      }
    } else {
      const target = currentTarget();
      const segment: StructuredSegment = {
        children: [],
        complete: false,
        metadata: safeMetadata(match[3] ?? ''),
        tag,
        type: tagTypes[tag],
      };
      target.push(segment);
      stack.push({ segment, startIndex: index, target });
    }
    cursor = index + rawTag.length;
  }

  let trailing = content.slice(cursor);
  if (streaming) trailing = splitPendingTagPrefix(trailing).content;
  appendMarkdown(currentTarget(), trailing);

  const firstOpen = stack.at(0);
  if (!streaming && firstOpen) {
    const segmentIndex = firstOpen.target.indexOf(firstOpen.segment);
    if (segmentIndex >= 0) {
      firstOpen.target.splice(segmentIndex);
      appendMarkdown(firstOpen.target, content.slice(firstOpen.startIndex));
    }
  }
  return root;
}
