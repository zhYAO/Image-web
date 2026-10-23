import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHost } from "@/app/workspace-host";
import AssetsPage from "@/app/assets/page";
const identity = vi.hoisted(() => ({
  status: "authorized",
  ownerId: "local",
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/assets" }));
vi.mock("@/features/auth/AuthStatusProvider", () => ({
  useAuthStatus: () => identity,
}));
vi.mock("@/app/client-workspace", () => ({
  ClientWorkspace: () => <div>私有工作区</div>,
}));
vi.mock("@/features/credits/CreditsProvider", () => ({
  CreditBalance: () => null,
}));
describe("private asset entry", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("does not mount a private runtime for the legacy synthetic HTTP identity", () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "http");
    vi.stubEnv("NEXT_PUBLIC_PHASE2_AUTH", "false");
    render(
      <WorkspaceHost>
        <AssetsPage />
      </WorkspaceHost>,
    );
    expect(screen.queryByText("私有工作区")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "登录并查看作品" }),
    ).toHaveAttribute("href", "/login?returnTo=%2Fassets");
  });
  it("uses the existing runtime for verified formal authentication", () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "http");
    vi.stubEnv("NEXT_PUBLIC_PHASE2_AUTH", "true");
    render(
      <WorkspaceHost>
        <AssetsPage />
      </WorkspaceHost>,
    );
    expect(screen.getByText("私有工作区")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "登录并查看作品" }),
    ).not.toBeInTheDocument();
  });
});
