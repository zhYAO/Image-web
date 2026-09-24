import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@zimage/domain";
import { describe, expect, it, vi } from "vitest";
import { SessionSidebar } from "@/features/workspace/SessionSidebar";

const session = {
  id: "s1",
  title: "春日商品拍摄",
  createdAt: "2026",
  updatedAt: "2026",
} as Session;
const callbacks = () => ({
  onCreate: vi.fn(),
  onCollapse: vi.fn(),
  onDelete: vi.fn(),
  onRename: vi.fn(),
  onSelect: vi.fn(),
});
describe("compact session sidebar", () => {
  it("retains icon navigation, active session, busy status and keyboard tooltips", async () => {
    const props = callbacks();
    const { rerender } = render(
      <SessionSidebar
        {...props}
        collapsed
        activeSessionId="s1"
        sessions={[session]}
        busySessionIds={new Set(["s1"])}
      />,
    );
    const button = screen.getByRole("button", { name: session.title });
    expect(button).toHaveAttribute("aria-current", "page");
    expect(button.querySelector("svg")).toBeInTheDocument();
    expect(button).not.toHaveTextContent(session.title);
    expect(
      screen.getByLabelText(`${session.title} 正在处理`),
    ).toBeInTheDocument();
    fireEvent.click(button);
    expect(props.onSelect).toHaveBeenCalledWith("s1");
    fireEvent.focus(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(session.title);
    expect(screen.getByRole("link", { name: "电商生图" })).toHaveAttribute(
      "href",
      "/create",
    );
    fireEvent.click(screen.getByRole("button", { name: "展开会话侧栏" }));
    expect(props.onCollapse).toHaveBeenCalled();
    rerender(<SessionSidebar {...props} sessions={[session]} />);
    expect(
      screen.getByRole("button", { name: session.title }),
    ).toHaveTextContent(session.title);
  });
  it("keeps rename and confirmed delete reachable in compact mode", async () => {
    const props = callbacks();
    render(<SessionSidebar {...props} collapsed sessions={[session]} />);
    fireEvent.click(
      screen.getByRole("button", { name: `${session.title} 的操作` }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: `重命名 ${session.title}` }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "会话名称" }), {
      target: { value: "新名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存会话名称" }));
    expect(props.onRename).toHaveBeenCalledWith("s1", "新名称");
    fireEvent.click(
      screen.getByRole("button", { name: `删除 ${session.title}` }),
    );
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith("s1"));
  });
  it("preserves the category while expanding and collapsing", async () => {
    const props = callbacks();
    const { rerender } = render(
      <SessionSidebar {...props} collapsed sessions={[session]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "筛选会话" }));
    fireEvent.click(await screen.findByRole("button", { name: "电商生图" }));
    expect(
      screen.queryByRole("button", { name: session.title }),
    ).not.toBeInTheDocument();
    rerender(<SessionSidebar {...props} sessions={[session]} />);
    expect(screen.getByRole("button", { name: "电商生图" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(
      screen.getByRole("button", { name: session.title }),
    ).toBeInTheDocument();
  });
});
