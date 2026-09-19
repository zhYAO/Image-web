import "antd/dist/reset.css";
import "./globals.css";

import { CreditsProvider } from "@/features/credits/CreditsProvider";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { WorkspaceHost } from './workspace-host';
import { AuthStatusProvider } from "@/features/auth/AuthStatusProvider";
import { AppProviders } from "./providers";

export const metadata: Metadata = {
  description: "聊天与 AI 生图一体化创作工作区",
  title: "ZImage · 一句话开始创作",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AppProviders>
          <AuthStatusProvider>
            <CreditsProvider><Suspense fallback={children}><WorkspaceHost>{children}</WorkspaceHost></Suspense></CreditsProvider>
          </AuthStatusProvider>
        </AppProviders>
      </body>
    </html>
  );
}
