'use client';

import { UnifiedWorkspace } from './UnifiedWorkspace';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo } from 'react';
import { commerceHref, workspaceRoute } from './workspace-route';
import { useAuthStatus } from '@/features/auth/AuthStatusProvider';

export function WorkspaceApplication() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();
  const { ownerId } = useAuthStatus();
  const route = useMemo(() => workspaceRoute(pathname, search), [pathname, search]);
  const navigate = useCallback((url: string, replace = false) => {
    if (replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  }, [router]);
  useEffect(() => {
    if ((pathname === '/' || pathname === '/workspace') && route.kind === 'commerce') navigate(commerceHref(route.scene, route.platform, route.template), true);
  }, [pathname, route, navigate]);
  return <UnifiedWorkspace route={route} onNavigate={navigate} ownerKey={ownerId ?? 'local'} />;
}
