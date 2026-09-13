'use client';

import { ThemeProvider } from '@lobehub/ui';
import { ConfigProvider } from 'antd';
import type { PropsWithChildren } from 'react';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      appearance="light"
      customTheme={{ neutralColor: 'slate', primaryColor: 'blue' }}
      defaultAppearance="light"
      defaultThemeMode="light"
      enableCustomFonts={false}
    >
      <ConfigProvider
        theme={{
          // Keep these literals aligned with globals.css; AntD derives its color palettes.
          token: {
            borderRadius: 12,
            colorPrimary: '#0066cc',
            colorInfo: '#0066cc',
            colorPrimaryHover: '#005bb5',
            colorPrimaryActive: '#004f9e',
            colorSuccess: '#237449',
            colorWarning: '#995400',
            colorError: '#b42318',
            colorText: '#1d1d1f',
            colorTextSecondary: '#65656c',
            colorTextPlaceholder: '#65656c',
            colorTextDisabled: '#8b8b92',
            colorBgLayout: '#f5f5f7',
            colorBgContainer: '#fff',
            colorBgElevated: '#fff',
            colorBgContainerDisabled: '#ececef',
            controlOutline: '#0066cc',
            controlOutlineWidth: 2,
            motionDurationFast: '0.16s',
            motionDurationMid: '0.16s',
            motionDurationSlow: '0.22s',
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
          },
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeProvider>
  );
}
