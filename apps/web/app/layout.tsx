import "antd/dist/reset.css";
import "./globals.css";
import '@/features/brand/bridge.css';
import '@/features/brand/liquid-glass.css';

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { ApplicationShell } from './application-shell';

export const metadata: Metadata = {
  description: "聊天与 AI 生图一体化创作工作区",
  title: "ZImage · 一句话开始创作",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{document.documentElement.dataset.zTheme=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch(e){}})()` }} />
      </head>
      <body>
        <Suspense fallback={children}><ApplicationShell>{children}</ApplicationShell></Suspense>
      </body>
    </html>
  );
}
