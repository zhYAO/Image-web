import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Session, TimelineItem, WorkspaceGateway } from "@zimage/domain";
import { SessionAssets } from "@/features/assets/SessionAssets";
vi.mock("@/features/workspace/WorkspaceTimeline", () => ({
  VisibleAsset: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));
const sessions: Session[] = ["one", "two"].map((id) => ({
  id,
  title: `会话 ${id}`,
  status: "active",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
}));
const timeline = (prompt: string): TimelineItem[] => [
  {
    id: prompt,
    sessionId: "one",
    type: "generation",
    sequence: 1,
    createdAt: "2026-01-01",
    batch: {
      id: prompt,
      sessionId: "one",
      source: "direct",
      status: "succeeded",
      prompt,
      provider: "test",
      model: "test",
      config: { aspectRatio: "1:1", count: 1, resolution: "1K" },
      createdAt: "2026-01-01",
      assets: [{ id: prompt, status: "succeeded" }],
    },
  },
];
describe("session asset library", () => {
  it("distinguishes a failed session list from an empty library", () => {
    const retry = vi.fn();
    render(
      <SessionAssets
        ownerKey="owner"
        sessions={[]}
        gateway={{} as WorkspaceGateway}
        error="offline"
        onRetry={retry}
      />,
    );
    expect(screen.queryByText("作品从一次创作开始")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试会话列表" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("reads only the selected real session and recovers from a failed read", async () => {
    const getTimeline = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(timeline("真实作品"));
    render(
      <SessionAssets
        ownerKey="owner"
        sessions={sessions}
        gateway={{ getTimeline } as unknown as WorkspaceGateway}
      />,
    );
    await screen.findByRole("alert");
    expect(getTimeline).toHaveBeenCalledTimes(1);
    expect(getTimeline).toHaveBeenCalledWith("one");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("1 张作品 · 当前会话");
    expect(screen.getByRole("link", { name: /查看原会话/ })).toHaveAttribute(
      "href",
      "/sessions/one",
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "搜索当前会话作品" }),
      { target: { value: "无匹配" } },
    );
    expect(screen.getByText("未找到匹配作品，请调整搜索。")).toBeVisible();
  });
  it("discards stale results across owner and session switches", async () => {
    let resolveOld!: (items: TimelineItem[]) => void;
    const getTimeline = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<TimelineItem[]>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValue(timeline("新账号作品"));
    const gateway = { getTimeline } as unknown as WorkspaceGateway;
    const { rerender } = render(
      <SessionAssets ownerKey="old" sessions={sessions} gateway={gateway} />,
    );
    rerender(
      <SessionAssets
        ownerKey="new"
        sessions={[sessions[1]!]}
        gateway={gateway}
      />,
    );
    await screen.findByText("1 张作品 · 当前会话");
    await act(async () => resolveOld(timeline("旧账号作品")));
    expect(screen.queryByText("旧账号作品")).not.toBeInTheDocument();
    expect(getTimeline.mock.calls.map((call) => call[0])).toEqual([
      "one",
      "two",
    ]);
    rerender(
      <SessionAssets ownerKey="empty" sessions={[]} gateway={gateway} />,
    );
    await waitFor(() =>
      expect(screen.queryByText("新账号作品")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { name: "作品从一次创作开始" }),
    ).toBeVisible();
  });
});
