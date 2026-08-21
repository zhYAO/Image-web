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
