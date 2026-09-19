import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnifiedWorkspace } from "@/features/workspace/UnifiedWorkspace";
import {
  createTestGateway,
  setupWorkspaceTest,
} from "./workspace-test-fixtures";

describe("commerce entry and session deletion", () => {
  setupWorkspaceTest();
  it("keeps failed entry out of chat and retries the requested scene", async () => {
    window.history.replaceState({}, "", "/?scene=product-set");
    const gateway = createTestGateway();
    vi.spyOn(gateway, "createSession").mockRejectedValueOnce(new Error("暂时无法创建会话"));
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText("暂时无法打开创作空间");
    expect(screen.queryByRole("textbox", { name: "创作输入" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新打开" }));
    // The editor is now a separate chunk; wait for that user-visible region after retry.
    expect(await screen.findByRole("region", { name: "商品套图向导" }, { timeout: 10000 })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "创作输入" })).toBeNull();
  });
  it("never exposes the chat composer while an explicit commerce entry initializes", async () => {
    window.history.replaceState({}, "", "/?scene=product-set");
    const gateway = createTestGateway();
    const original = gateway.listSessions.bind(gateway);
    let release!: () => void;
    vi.spyOn(gateway, "listSessions").mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original();
    });
    render(<UnifiedWorkspace gateway={gateway} />);
    expect(screen.queryByRole("textbox", { name: "创作输入" })).toBeNull();
    await act(async () => release());
    expect(
      await screen.findByRole("region", { name: "商品套图向导" }),
    ).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "创作输入" })).toBeNull();
    window.history.replaceState({}, "", "/");
  });
  it.each([false, true])("confirms deletion and keeps the list busy until success (list refresh fails: %s)", async (refreshFails) => {
    const gateway = createTestGateway();
    const session = await gateway.createSession("待删除测试会话");
    const original = gateway.deleteSession.bind(gateway);
    let release!: () => void;
    const remove = vi
      .spyOn(gateway, "deleteSession")
      .mockImplementation(async (id) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return original(id);
      });
    render(<UnifiedWorkspace gateway={gateway} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "删除 待删除测试会话" }),
    );
    expect(remove).not.toHaveBeenCalled();
    if (refreshFails) vi.spyOn(gateway, "listSessions").mockRejectedValueOnce(new Error("refresh unavailable"));
    fireEvent.click(await screen.findByRole("button", { name: "确认删除" }));
    expect(remove).toHaveBeenCalledWith(session.id);
    const list = screen.getByRole("region", { name: "会话列表" });
    expect(list).toHaveAttribute("aria-busy", "true");
    expect(
      within(list).getByRole("button", { name: "待删除测试会话" }),
    ).toBeVisible();
    await act(async () => release());
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "待删除测试会话" }),
      ).toBeNull(),
    );
    expect(list).toHaveAttribute("aria-busy", "false");
  });
});
