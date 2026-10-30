declare const __ZIMAGE_ASSET_NAMESPACE__: string;
declare const __ZIMAGE_COMPATIBILITY__: unknown;
declare const __ZIMAGE_OBSERVABILITY__: import('./platform/observability').BrowserObservabilityOptions | null;
declare module '*.css';
interface Window {
  turnstile?: {
    remove(widgetId: string): void;
    render(container: HTMLElement, options: {
      callback(token: string): void;
      'error-callback'(): void;
      'expired-callback'(): void;
      sitekey: string;
      theme: 'auto' | 'light' | 'dark';
      size?: 'normal' | 'flexible' | 'compact';
    }): string;
  };
}

// Type-only facade for the retained relative legacy captcha source seen by tsc.
// Vite aliases that source to auth-captcha.tsx; next/script stays forbidden in
// the browser graph and no runtime Script shim is provided.
declare module 'next/script' {
  const Script: import('react').ComponentType<{
    id?: string;
    src: string;
    strategy?: 'afterInteractive' | 'beforeInteractive' | 'lazyOnload' | 'worker';
    onReady?: () => void;
    onError?: (error: unknown) => void;
  }>;
  export default Script;
}
