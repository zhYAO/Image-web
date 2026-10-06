import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { ApparelWorkspace } from "@/features/commerce/ApparelWorkspace";
import { apparelTaskSchema, type ApparelGateway } from "@zimage/domain";
import { apparelFixture, apparelIds } from "./apparel-fixtures";
const props = {
  sessionId: "draft:apparel",
  ownerKey: "account-a",
  references: [],
  onReferenceAdd: vi.fn(),
  onReferenceRemove: vi.fn(),
  onReferenceUploaded: vi.fn(),
  onTask: vi.fn(),
};
describe("apparel form in the shared commerce workspace", () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.clear();
  });
  it("uses upload/form inputs, preserves fields on refresh and isolates accounts", () => {
    const first = render(<ApparelWorkspace {...props} />);
    expect(screen.getByLabelText("主图 1")).toHaveAttribute(
      "accept",
      "image/jpeg",
    );
    expect(screen.getByLabelText("透明 PNG Logo")).toHaveAttribute(
      "accept",
      "image/png",
    );
    fireEvent.change(screen.getByLabelText("商品名称"), {
      target: { value: "亚麻衬衫" },
    });
    first.unmount();
    const second = render(<ApparelWorkspace {...props} />);
    expect(screen.getByLabelText("商品名称")).toHaveValue("亚麻衬衫");
    second.unmount();
    render(<ApparelWorkspace {...props} ownerKey="account-b" />);
    expect(screen.getByLabelText("商品名称")).toHaveValue("");
    expect(screen.queryByLabelText("模型")).not.toBeInTheDocument();
  });
  it("assigns uploaded photos through shared reference callbacks", () => {
    render(<ApparelWorkspace {...props} />);
    const file = new File(["jpeg"], "1.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("主图 1"), {
      target: { files: [file] },
    });
    expect(props.onReferenceAdd).toHaveBeenCalledWith([file]);
  });
  it("keeps a stale form intact and lets the user load the newer whole-set revision", () => {
    const task = apparelTaskSchema.parse({
      id: apparelIds[7],
      sessionId: "session",
      engine: "apparel-catalog",
      revision: 1,
      plan: apparelFixture,
      createdAt: "2026-10-06",
      updatedAt: "2026-10-06",
      runs: [],
    });
    const gateway = {} as ApparelGateway;
    const view = render(
      <ApparelWorkspace {...props} gateway={gateway} task={task} />,
    );
    fireEvent.change(screen.getByLabelText("颜色"), {
      target: { value: "本地编辑" },
    });
    const latest = {
      ...task,
      revision: 2,
      plan: { ...task.plan, brief: { ...task.plan.brief, color: "最新白色" } },
    };
    view.rerender(
      <ApparelWorkspace {...props} gateway={gateway} task={latest} />,
    );
    expect(screen.getByLabelText("颜色")).toHaveValue("本地编辑");
    expect(screen.getByRole("button", { name: "保存为新版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "加载最新方案" }));
    expect(screen.getByLabelText("颜色")).toHaveValue("最新白色");
    expect(screen.getByRole("button", { name: "保存为新版本" })).toBeEnabled();
  });
});
