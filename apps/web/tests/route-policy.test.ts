import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_SCENES, commerceSceneSchema } from '@zimage/domain';

import { commerceHref, sessionHref, workspaceRoute } from '@/features/workspace/workspace-route';
import { normalizeReturnTo } from '@/server/auth/redirects';
import { updateSupabaseSession } from '@/lib/supabase/proxy';
import LegacyChatPage from '@/app/chat/page';
import LegacyImagePage from '@/app/image/page';
import SkillsPage from '@/app/skills/page';
import SkillPage from '@/app/skills/[id]/page';

// Exercise alias decisions without rendering a Next server or opening a browser.
vi.mock('next/navigation', () => ({ redirect: (target: string) => { throw new Error(`redirect:${target}`); } }));

const root = resolve(process.cwd(), '../..');
const policy = JSON.parse(readFileSync(`${root}/doc/separation/route-policy.json`, 'utf8')) as {
  status: string; validSceneIds: string[]; fallbackRules: string[];
  routes: { pattern: string; kind: string; target?: string; alias?: string; aliasOf?: string;
    statusCode?: number; cacheControl?: string; robots?: string; sceneIds?: string[];
    currentGuestBehavior?: string; targetGuestBehavior?: string; queryParameters?: string[] }[];
};
const scenes = ['product-main', 'product-set', 'detail', 'clone', 'social', 'style-reference', 'model', 'xhs-poster', 'apparel-catalog'];

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('frozen route policy and existing local behavior (not installed ingress)', () => {
  it('retains all nine legal scenes, including compatibility scenes outside the five primary cards', () => {
    expect(policy.status).toBe('frozen-migration-policy-not-installed-ingress');
    expect(policy.validSceneIds).toEqual(scenes);
    expect(policy.routes.find(route => route.pattern === '/create/:scene')?.sceneIds).toEqual(scenes);
    expect(COMMERCE_SCENES.map(scene => scene.id).sort()).toEqual([...scenes].sort());
    for (const scene of policy.validSceneIds) {
      expect(commerceSceneSchema.safeParse(scene).success).toBe(true);
      expect(workspaceRoute(`/create/${scene}`)).toMatchObject({ kind: 'commerce', scene });
      expect(workspaceRoute('/workspace', `scene=${scene}`)).toMatchObject({ kind: 'commerce', scene });
    }
  });

  it.each(['GET', 'HEAD'])('canonicalizes every legacy root scene for %s without auth or private data', async method => {
    for (const scene of policy.validSceneIds) {
      const request = new NextRequest(`https://fixture.test/?scene=${scene}&platform=amazon&template=detail%20one`, { method });
      const response = await updateSupabaseSession(request);
      const expected = commerceHref(commerceSceneSchema.parse(scene), 'amazon', 'detail one');
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(`https://fixture.test${expected}`);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });

  it.each(['batch', 'unknown', '', '../account'])('rejects invalid/retired root and create scene %j', async scene => {
    expect(commerceSceneSchema.safeParse(scene).success).toBe(false);
    expect(workspaceRoute(`/create/${scene}`)).toEqual({ kind: scene === '' ? 'catalogue' : 'invalid' });
    expect(workspaceRoute('/', `scene=${encodeURIComponent(scene)}`)).toEqual({ kind: 'invalid' });
    const response = await updateSupabaseSession(new NextRequest(`https://fixture.test/?scene=${encodeURIComponent(scene)}`));
    expect(response.status).toBe(404);
    expect(response.headers.get('location')).toBeNull();
  });

  it('preserves dynamic session task/batch/view and safe query/hash return paths', () => {
    const session = policy.routes.find(route => route.pattern === '/sessions/:sessionId');
    expect(session?.queryParameters).toEqual(['task', 'batch', 'view']);
    expect(workspaceRoute('/sessions/session-1', '?task=task-1&batch=history-1&view=results')).toEqual({
      kind: 'session', sessionId: 'session-1', taskId: 'task-1', batchId: 'history-1', view: 'results',
    });
    expect(workspaceRoute('/sessions/session-1/', '?view=unknown')).toMatchObject({ kind: 'session', view: undefined });
    expect(sessionHref('session-1', 'task-1', 'plan')).toBe('/sessions/session-1?task=task-1&view=plan');
    const target = '/sessions/session-1?task=task-1&batch=history-1&view=results#image-2';
    expect(normalizeReturnTo(target)).toBe(target);
    expect(normalizeReturnTo('/create/detail?platform=amazon&template=detail%20one#preview')).toBe('/create/detail?platform=amazon&template=detail%20one#preview');
    for (const path of ['/sessions/a/b', '/sessions/', '/sessions/a%2Fb']) expect(workspaceRoute(path)).toEqual({ kind: 'invalid' });
    for (const target of ['//attacker.test', 'https://attacker.test', '/api/meta', '/auth/verify', '/\\attacker.test']) expect(normalizeReturnTo(target)).toBe('/workspace');
  });

  it('keeps one workspace, business assets and canonical catalogue entry', () => {
    expect(workspaceRoute('/workspace')).toEqual({ kind: 'home' });
    expect(workspaceRoute('/')).toEqual({ kind: 'outside' });
    expect(workspaceRoute('/create')).toEqual({ kind: 'catalogue' });
    expect(workspaceRoute('/assets')).toEqual({ kind: 'assets' });
    expect(policy.routes.find(route => route.pattern === '/')?.alias).toBe('/home');
    expect(policy.routes.find(route => route.pattern === '/login')?.aliasOf).toBe('/auth');
  });

  it('retains actual legacy redirect decisions', () => {
    for (const [path, page] of [['/chat', LegacyChatPage], ['/image', LegacyImagePage], ['/skills', SkillsPage], ['/skills/:id', SkillPage]] as const) {
      const route = policy.routes.find(route => route.pattern === path);
      expect(route?.kind).toBe('redirect');
      expect(() => page()).toThrow(`redirect:${route?.target}`);
    }
  });

  it('keeps planned ingress safeguards distinct from implemented handler behavior', () => {
    expect(policy.routes.find(route => route.pattern === '/create/batch')).toMatchObject({ kind: 'retired', statusCode: 404, cacheControl: 'no-store', robots: 'noindex' });
    const account = policy.routes.find(route => route.pattern === '/account');
    expect(account?.currentGuestBehavior).toBe('server redirect /home');
    expect(account?.targetGuestBehavior).toContain('static shell without private data');
    expect(policy.fallbackRules).toEqual([
      '/api and /api/** never return SPA index.',
      'Missing JS/CSS/media or unknown routes return actual 404.',
      'Preserve existing query/hash/history behavior; do not hard reload drafts or unresolved paid requests.',
      'Public static payload never includes private account/session/asset data.',
      'Maintain old Next build resources and actual RSC protocol during the verified compatibility window.',
    ]);
    // The current route parser must never classify API, resources or unknown
    // paths as a workspace. Actual status/cache/RSC behavior needs S4+ HTTP work.
    for (const path of ['/api', '/api/no-such-route', '/missing.js', '/missing.css', '/missing.webp', '/unknown']) expect(workspaceRoute(path)).toEqual({ kind: 'outside' });
  });
});
