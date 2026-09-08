import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthStatusProvider,
  notifyAuthChange,
} from "@/features/auth/AuthStatusProvider";
import { CommerceCatalogue } from "@/features/commerce/CommerceCatalogue";
import { AnonymousAuthGate } from "@/app/anonymous-auth-gate";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

describe("shared authentication presentation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    replace.mockReset();
  });
  it("shares one verified request across catalogue and workspace, including StrictMode", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHASE2_AUTH", "true");
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const view = render(
      <StrictMode>
        <AuthStatusProvider>
          <CommerceCatalogue />
        </AuthStatusProvider>
      </StrictMode>,
    );
    expect(screen.queryByRole("link", { name: "登录" })).toBeNull();
    await screen.findByRole("link", { name: "账号" });
    view.rerender(
      <StrictMode>
        <AuthStatusProvider>
          <AnonymousAuthGate>
            <span>创作已准备</span>
          </AnonymousAuthGate>
        </AuthStatusProvider>
      </StrictMode>,
    );
    expect(screen.getByText("创作已准备")).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });
  it("does not let an old in-flight account response undo a successful logout", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHASE2_AUTH", "true");
    let complete!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      ),
    );
    render(
      <AuthStatusProvider>
        <CommerceCatalogue />
      </AuthStatusProvider>,
    );
    act(() => {
      notifyAuthChange(false);
    });
    expect(screen.getByRole("link", { name: "登录" })).toBeVisible();
    await act(async () => complete(new Response("{}", { status: 200 })));
    expect(screen.getByRole("link", { name: "登录" })).toBeVisible();
  });
  it("preserves the explicit scene when an expired account redirects to login", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHASE2_AUTH", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    window.history.replaceState({}, "", "/?scene=product-set");
    render(
      <AuthStatusProvider>
        <AnonymousAuthGate>
          <span>private workspace</span>
        </AnonymousAuthGate>
      </AuthStatusProvider>,
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        "/login?returnTo=%2F%3Fscene%3Dproduct-set",
      ),
    );
    expect(screen.queryByText("private workspace")).toBeNull();
    window.history.replaceState({}, "", "/");
  });
});
