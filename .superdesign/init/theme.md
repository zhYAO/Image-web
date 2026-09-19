# Current theme
Light only. Background #eef2ff with indigo/lavender radial gradients. Text #171725; muted #68687a; primary #4f46e5. Translucent white panels .66/.82; radii 12/18/28px; blur 22px. System sans fonts, 12–16px controls and 40px hero. Workspace breakpoints 767 and 1100px. CSS Modules + global CSS, no Tailwind.
## `apps/web/app/globals.css`

```css
:root {
  --z-bg: #eef2ff;
  --z-bg-gradient: radial-gradient(circle at 8% 2%, rgba(165, 180, 252, .5), transparent 34%), radial-gradient(circle at 92% 0%, rgba(196, 181, 253, .42), transparent 30%), linear-gradient(145deg, #f8fafc 0%, #eef2ff 48%, #f5f3ff 100%);
  --z-panel: rgba(255, 255, 255, .66);
  --z-panel-strong: rgba(255, 255, 255, .82);
  --z-text: #171725;
  --z-muted: #68687a;
  --z-border: rgba(255, 255, 255, .78);
  --z-border-subtle: rgba(99, 102, 241, .14);
  --z-primary: #4f46e5;
  --z-primary-hover: #4338ca;
  --z-primary-soft: rgba(238, 242, 255, .78);
  --z-accent: #f97316;
  --z-radius-sm: 12px;
  --z-radius-md: 18px;
  --z-radius-lg: 28px;
  --z-shadow: 0 20px 60px rgba(48, 46, 94, .12);
  --z-shadow-soft: 0 8px 28px rgba(48, 46, 94, .08);
  --z-glass-blur: 22px;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background: var(--z-bg-gradient);
  color: var(--z-text);
}

body {
  overflow: hidden;
}

a { color: var(--z-primary); }

button:focus-visible,
a:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 3px solid rgba(79, 70, 229, .32);
  outline-offset: 2px;
}

.glass-page {
  min-height: 100dvh;
  overflow: auto;
  padding: clamp(24px, 5vw, 72px) 20px;
  background: var(--z-bg-gradient);
}

.glass-card {
  border: 1px solid var(--z-border);
  border-radius: var(--z-radius-lg);
  background: var(--z-panel);
  box-shadow: var(--z-shadow);
  -webkit-backdrop-filter: blur(var(--z-glass-blur)) saturate(150%);
  backdrop-filter: blur(var(--z-glass-blur)) saturate(150%);
}

.glass-form {
  width: min(100%, 460px);
  margin: 0 auto;
  padding: clamp(28px, 5vw, 48px);
}

.glass-form h1 { margin: 8px 0 12px; font-size: clamp(28px, 5vw, 40px); letter-spacing: -.04em; }
.glass-kicker { color: var(--z-primary); font-size: 13px; font-weight: 700; letter-spacing: .08em; }
.glass-muted { color: var(--z-muted); line-height: 1.7; }
.glass-form form { display: grid; gap: 16px; margin-top: 28px; }
.glass-form label { display: grid; gap: 7px; color: var(--z-text); font-size: 14px; font-weight: 600; }
.glass-form input,
.glass-form textarea {
  width: 100%;
  border: 1px solid var(--z-border-subtle);
  border-radius: var(--z-radius-sm);
  padding: 12px 14px;
  background: rgba(255, 255, 255, .7);
  color: var(--z-text);
}
.glass-form button,
.glass-primary {
  min-height: 44px;
  border: 0;
  border-radius: var(--z-radius-sm);
  padding: 0 18px;
  background: var(--z-primary);
  color: #fff;
  cursor: pointer;
  font-weight: 700;
  box-shadow: 0 8px 18px rgba(79, 70, 229, .22);
}
.glass-form button:hover, .glass-primary:hover { background: var(--z-primary-hover); }
.glass-form nav { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
.glass-form nav button { min-height: auto; padding: 7px 10px; background: transparent; color: var(--z-primary); box-shadow: none; }
.glass-status { margin: 0; color: var(--z-primary); line-height: 1.6; }
.glass-error { margin: 0; color: #b42318; line-height: 1.6; }
.glass-prose { width: min(100%, 760px); margin: 0 auto; padding: clamp(28px, 6vw, 64px); }
.glass-prose h1 { margin-top: 0; font-size: clamp(30px, 5vw, 46px); letter-spacing: -.04em; }
.glass-prose p { color: var(--z-muted); line-height: 1.9; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; }
}

button,
input,
textarea {
  font: inherit;
}

@media (max-width: 767px) {
  .workspaceDrawer .ant-drawer-content-wrapper {
    width: 100% !important;
  }
}

```
## `apps/web/app/providers.tsx`

```tsx
'use client';

import { ThemeProvider } from '@lobehub/ui';
import { ConfigProvider } from 'antd';
import type { PropsWithChildren } from 'react';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      appearance="light"
      customTheme={{ neutralColor: 'slate', primaryColor: 'geekblue' }}
      defaultAppearance="light"
      defaultThemeMode="light"
      enableCustomFonts={false}
    >
      <ConfigProvider
        theme={{
          token: {
            borderRadius: 12,
            colorPrimary: '#4f46e5',
            colorInfo: '#4f46e5',
            colorWarning: '#f97316',
            fontFamily:
              'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          },
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeProvider>
  );
}

```
