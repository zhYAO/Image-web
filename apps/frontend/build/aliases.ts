import { fileURLToPath } from 'node:url';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/** Narrow temporary bridges; no general Next or server-module compatibility. */
export function frontendAliases() {
  return [
    { find: '@/features/platform/client-runtime', replacement: path('../src/platform/client-runtime.ts') },
    { find: '@/app/use-media-query', replacement: path('../src/platform/use-media-query.ts') },
    { find: 'next/link', replacement: path('../src/platform/link.tsx') },
    { find: 'next/image', replacement: path('../src/platform/image.tsx') },
    { find: 'next/navigation', replacement: path('../src/platform/next-navigation.ts') },
    { find: 'next/dynamic', replacement: path('../src/platform/dynamic.tsx') },
    { find: /^(?:.*\/)?AuthStatusProvider(?:\.tsx)?$/, replacement: path('../src/platform/auth-status.tsx') },
    { find: /^(?:.*\/)?use-auth-captcha(?:\.tsx)?$/, replacement: path('../src/platform/auth-captcha.tsx') },
    { find: /^(?:.*\/)?load-workspace(?:\.ts)?$/, replacement: path('../src/platform/load-workspace.ts') },
    { find: /^(?:.*\/)?catalogue-runtime(?:\.ts)?$/, replacement: path('../src/platform/catalogue-runtime.ts') },
    { find: /^(?:.*\/)?apparel-display-config(?:\.ts)?$/, replacement: path('../src/platform/apparel-display-config.ts') },
    { find: /^(?:.*\/)?mock-credit-ledger(?:\.ts)?$/, replacement: path('../src/platform/credit-events.ts') },
    { find: /^(?:.*\/)?creative-text-gateway(?:\.ts)?$/, replacement: path('../src/platform/creative-text-gateway.ts') },
    { find: /^@\/gateways$/, replacement: path('../src/platform/gateways.ts') },
    { find: '@/features/brand/IntentLink', replacement: path('../src/platform/intent-link.tsx') },
    { find: /^(?:.*\/)?LandingAuth(?:\.tsx)?$/, replacement: path('../src/platform/landing-auth.tsx') },
    { find: '@/lib/public-assets', replacement: path('../src/platform/public-assets.ts') },
    { find: '@legacy', replacement: path('../../web') },
    { find: '@', replacement: path('../../web') },
    { find: '@zimage/domain', replacement: path('../../../packages/domain/src/index.ts') },
  ];
}
