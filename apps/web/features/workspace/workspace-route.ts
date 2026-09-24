import { commerceSceneSchema, COMMERCE_PLATFORMS, type CommerceBrief, type CommerceScene } from '@zimage/domain';

export type CommerceView = 'examples' | 'plan' | 'results';
export type WorkspaceRoute =
  | { kind: 'home' }
  | { kind: 'commerce'; scene: CommerceScene; platform?: CommerceBrief['platform']; template?: string }
  | { kind: 'session'; sessionId: string; taskId?: string; batchId?: string; view?: CommerceView }
  | { kind: 'invalid' }
  | { kind: 'outside' };

export function workspaceRoute(pathname: string, search = ''): WorkspaceRoute {
  const query = new URLSearchParams(search);
  if (pathname === '/' && !query.has('scene')) return { kind: 'home' };
  if (pathname === '/' || pathname.startsWith('/create/')) {
    if (pathname !== '/' && !/^\/create\/[^/]+\/?$/.test(pathname)) return { kind: 'invalid' };
    const scene = commerceSceneSchema.safeParse(pathname === '/' ? query.get('scene') : pathname.split('/')[2]);
    if (!scene.success) return { kind: 'invalid' };
    const platform = query.get('platform');
    return { kind: 'commerce', scene: scene.data,
      platform: COMMERCE_PLATFORMS.some(item => item.id === platform) ? platform as CommerceBrief['platform'] : undefined,
      template: query.get('template') ?? undefined };
  }
  if (pathname.startsWith('/sessions/')) {
    if (!/^\/sessions\/[^/]+\/?$/.test(pathname)) return { kind: 'invalid' };
    const sessionId = pathname.split('/')[2];
    if (!sessionId || !/^[a-zA-Z0-9-]+$/.test(sessionId)) return { kind: 'invalid' };
    const view = query.get('view');
    return { kind: 'session', sessionId, taskId: query.get('task') ?? undefined, batchId: query.get('batch') ?? undefined,
      view: view === 'examples' || view === 'plan' || view === 'results' ? view : undefined };
  }
  return { kind: 'outside' };
}

export function commerceHref(scene: CommerceScene, platform?: string, template?: string) {
  const query = new URLSearchParams();
  if (scene === 'xhs-poster') query.set('platform', 'xiaohongshu');
  else if (platform && platform !== 'all') query.set('platform', platform);
  if (template) query.set('template', template);
  return `/create/${scene}${query.size ? `?${query}` : ''}`;
}
export function sessionHref(id: string, taskId?: string, view?: CommerceView) {
  const query = new URLSearchParams();
  if (taskId) query.set('task', taskId);
  if (view) query.set('view', view);
  return `/sessions/${encodeURIComponent(id)}${query.size ? `?${query}` : ''}`;
}
export const isLocalCommerceDraft = (id: string | undefined) => Boolean(id?.startsWith('commerce-draft:'));
