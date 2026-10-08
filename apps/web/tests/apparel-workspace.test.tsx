import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  cleanup,
  waitFor,
} from "@testing-library/react";
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
    vi.clearAllMocks();
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
  it("retries a lost save response with the same frozen plan without uploading sources again", async () => {
    const task = apparelTaskSchema.parse({
      id: apparelIds[7],
      sessionId: apparelIds[7],
      engine: "apparel-catalog",
      revision: 1,
      plan: apparelFixture,
      createdAt: "now",
      updatedAt: "now",
      runs: [],
    });
    const upload = vi.fn(
      async (_session: string, ref: { id?: string }) => ref.id!,
    );
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("响应丢失"))
      .mockImplementationOnce(async (_id, input) => ({
        ...task,
        revision: 2,
        plan: input.plan,
      }));
    const onTask = vi.fn();
    render(
      <ApparelWorkspace
        {...props}
        sessionId={task.sessionId}
        task={task}
        gateway={{ upload, save } as unknown as ApparelGateway}
        onTask={onTask}
      />,
    );
    fireEvent.change(screen.getByLabelText("衣长"), {
      target: { value: "68" },
    });
    fireEvent.change(screen.getByLabelText("Design"), {
      target: { value: "新的设计说明" },
    });
    fireEvent.change(screen.getByLabelText("面料裁切左"), {
      target: { value: "0.22" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存为新版本" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("响应丢失");
    expect(onTask).not.toHaveBeenCalled();
    expect(screen.getByLabelText("衣长")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "继续保存同一请求" }));
    await waitFor(() => expect(onTask).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledTimes(7);
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(save.mock.calls[1]![1]).toMatchObject({
      expectedRevision: 1,
      plan: {
        brief: { measurements: { length: "68" }, design: "新的设计说明" },
        fabricCrop: [0.22, 0.2, 0.76, 0.57],
      },
    });
    expect(screen.getByLabelText("衣长")).toBeEnabled();
  });
  it("keeps the render request identity after failure and disables rendering unsaved edits", async () => {
    const task = apparelTaskSchema.parse({
      id: apparelIds[7],
      sessionId: apparelIds[7],
      engine: "apparel-catalog",
      revision: 1,
      plan: apparelFixture,
      createdAt: "now",
      updatedAt: "now",
      runs: [],
    });
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("排版暂不可用"))
      .mockResolvedValueOnce(task);
    const onTask = vi.fn();
    render(
      <ApparelWorkspace
        {...props}
        sessionId={task.sessionId}
        task={task}
        gateway={{ submit } as unknown as ApparelGateway}
        onTask={onTask}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "开始整套排版" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("排版暂不可用");
    fireEvent.click(screen.getByRole("button", { name: "开始整套排版" }));
    await waitFor(() =>
      expect(onTask).toHaveBeenCalledWith(task, task.sessionId),
    );
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
    fireEvent.change(screen.getByLabelText("颜色"), {
      target: { value: "编辑后的白色" },
    });
    expect(screen.getByRole("button", { name: "开始整套排版" })).toBeDisabled();
    expect(submit).toHaveBeenCalledTimes(2);
  });
});
