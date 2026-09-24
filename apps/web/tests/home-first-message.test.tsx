import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/store/workspace-store";
import { UnifiedWorkspace } from "@/features/workspace/UnifiedWorkspace";
import {
  setupWorkspaceTest,
  CapturingGateway,
  createTestGateway,
} from "./workspace-test-fixtures";

describe("first message on home", () => {
  setupWorkspaceTest();
  it("shows the submitted message while session creation is pending, then sends once", async () => {
    const gateway = createTestGateway(CapturingGateway);
    const create = gateway.createSession.bind(gateway);
    let release!: () => void;
    vi.spyOn(gateway, "createSession").mockImplementationOnce(
      (title) =>
        new Promise((resolve) => {
          release = () => {
            void create(title).then(resolve);
          };
        }),
    );
    render(
      <UnifiedWorkspace
        gateway={gateway}
        route={{ kind: "home" }}
        onNavigate={vi.fn()}
      />,
    );
    await screen.findByText("你好，想创作什么？");
    await waitFor(() =>
      expect(screen.queryByText("正在加载模型配置…")).not.toBeInTheDocument(),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "创作输入" }), {
      target: { value: "帮我构思春日配色" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "创作输入" }), {
      key: "Enter",
    });
    expect(screen.getByText("帮我构思春日配色")).toBeInTheDocument();
    expect(screen.queryByText("你好，想创作什么？")).not.toBeInTheDocument();
    expect(screen.getByLabelText("AI 正在思考")).toBeInTheDocument();
    await act(async () => release());
    await waitFor(() =>
      expect(gateway.lastChatRequest?.message).toBe("帮我构思春日配色"),
    );
    expect(gateway.createSession).toHaveBeenCalledTimes(1);
    expect(
      within(screen.getByRole("log", { name: "对话时间线" })).getAllByText(
        "帮我构思春日配色",
      ),
    ).toHaveLength(1);
  });
  it.each(["resolve", "reject"] as const)(
    "keeps the destination draft and navigation when first creation %s after switching sessions",
    async (outcome) => {
      const gateway = createTestGateway(CapturingGateway);
      const existing = await gateway.createSession("已有会话");
      useWorkspaceStore.getState().activateComposer(existing.id);
      useWorkspaceStore.getState().setDraft("已有会话的未发送草稿");
      useWorkspaceStore.getState().activateComposer(undefined);
      const create = gateway.createSession.bind(gateway);
      let finish!: () => Promise<void>;
      vi.spyOn(gateway, "createSession").mockImplementationOnce(
        (title) =>
          new Promise((resolve, reject) => {
            finish = async () => {
              if (outcome === "resolve") resolve(await create(title));
              else reject(new Error("创建会话失败"));
            };
          }),
      );
      const navigate = vi.fn();
      const { rerender } = render(
        <UnifiedWorkspace
          gateway={gateway}
          route={{ kind: "home" }}
          onNavigate={navigate}
        />,
      );
      await screen.findByRole("button", { name: "已有会话" });
      await waitFor(() =>
        expect(screen.queryByText("正在加载模型配置…")).not.toBeInTheDocument(),
      );
      fireEvent.change(screen.getByRole("textbox", { name: "创作输入" }), {
        target: { value: "首页第一条消息" },
      });
      fireEvent.keyDown(screen.getByRole("textbox", { name: "创作输入" }), {
        key: "Enter",
      });
      rerender(
        <UnifiedWorkspace
          gateway={gateway}
          route={{ kind: "session", sessionId: existing.id }}
          onNavigate={navigate}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: "创作输入" })).toBeEnabled(),
      );
      expect(screen.getByRole("textbox", { name: "创作输入" })).toHaveValue(
        "已有会话的未发送草稿",
      );
      await act(async () => finish());
      await waitFor(() => {
        if (outcome === "resolve")
          expect(gateway.lastChatRequest?.message).toBe("首页第一条消息");
        else
          expect(useWorkspaceStore.getState().composers[""]?.draft).toBe(
            "首页第一条消息",
          );
      });
      expect(navigate).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox", { name: "创作输入" })).toHaveValue(
        "已有会话的未发送草稿",
      );
      expect(useWorkspaceStore.getState().activeComposerSessionId).toBe(
        existing.id,
      );
    },
  );
});
