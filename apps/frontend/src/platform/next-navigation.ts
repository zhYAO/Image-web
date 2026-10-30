import { useMemo } from 'react';
import { useNavigation } from './navigation';

/** Temporary import adapter for existing client components; no server APIs. */
export function usePathname() { return useNavigation().pathname.replace(/\/$/, '') || '/'; }
export function useSearchParams() { return useNavigation().searchParams; }
export function useRouter() {
  const navigation = useNavigation();
  return useMemo(() => ({
    push: navigation.push, replace: navigation.replace,
    back: () => window.history.back(), forward: () => window.history.forward(),
    prefetch: () => navigation.prefetchWorkspace(),
  }), [navigation]);
}
