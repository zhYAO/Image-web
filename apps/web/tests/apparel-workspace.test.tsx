import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  cleanup,
  waitFor,
  within,
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
};
describe("apparel form in the shared commerce workspace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    sessionStorage.clear();
  });
  it("excludes expired gallery URLs and resets visibility when the whole run changes", async () => {
    vi.stubEnv("NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED", "true");
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function () {
        return { observe: vi.fn(), disconnect: vi.fn() };
      }),
    );
    const asset = (id: string, name: string, expired = false) => ({
      id,
      name,
      expired,
      url: `/private/${id}`,
      width: 750,
      height: 1000,
      mimeType: "image/jpeg",
      expiresAt: "2026-10-14T00:00:00Z",
    });
    const task = apparelTaskSchema.parse({
      id: apparelIds[7],
      sessionId: "session",
      engine: "apparel-catalog",
      revision: 1,
      plan: apparelFixture,
      createdAt: "now",
      updatedAt: "now",
      runs: [
        {
          id: apparelIds[3],
          requestId: apparelIds[4],
          revision: 1,
          status: "succeeded",
          createdAt: "now",
          assets: [
            asset(apparelIds[0]!, "首图/1.jpg"),
            asset(apparelIds[1]!, "末图.jpg"),
            asset(apparelIds[2]!, "过期图.jpg", true),
          ],
        },
      ],
    });
    const view = render(<ApparelWorkspace {...props} task={task} />);
    expect(screen.getByText("结果已过期")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "加载 过期图.jpg" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "下载原始 JPEG ZIP" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "加载 首图/1.jpg" }));
    fireEvent.click(screen.getByRole("img", { name: "首图/1.jpg" }));
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "关闭图片" }));
    const replacement = {
      ...task,
      runs: [{ ...task.runs[0]!, id: apparelIds[5]! }],
    };
    view.rerender(<ApparelWorkspace {...props} task={replacement} />);
    expect(screen.queryByRole("img", { name: "首图/1.jpg" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "加载 首图/1.jpg" }),
    ).toBeInTheDocument();
  });
  it("shows inspectable AI layout examples without adopting fictional product data", () => {
    render(<ApparelWorkspace {...props} />);
    const example = screen.getByRole("img", {
      name: "原创 AI 服装示例 · 主图 1",
    });
    expect(screen.getByText(/虚构商品，仅展示排版/)).toBeInTheDocument();
    fireEvent.click(example);
    expect(screen.getByLabelText("商品名称")).toHaveValue("");
    expect(screen.getByLabelText("面料成分")).toHaveValue("");
    expect(screen.getByLabelText("上架尺码")).toHaveValue("");
    expect(props.onReferenceAdd).not.toHaveBeenCalled();
    expect(props.onTask).not.toHaveBeenCalled();
  });
  it("keeps eleven inspectable examples compact while retaining expandable business notes", () => {
    render(<ApparelWorkspace {...props} />);
    const examples = screen.getByRole("region", { name: "服装排版效果示例" });
    const notes = within(examples).getByText("示例说明与成品保留规则").closest("details");
    expect(notes).not.toHaveAttribute("open");
    expect(within(examples).getAllByRole("button", { name: /^预览 原创 AI 服装示例/ })).toHaveLength(11);
    expect(notes).toHaveTextContent("虚构商品，仅展示排版");
    expect(notes).toHaveTextContent("90 天");
    fireEvent.click(within(examples).getByRole("button", { name: "预览 原创 AI 服装示例 · 主图 1" }));
    expect(screen.getByText("1 / 11")).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute("src", expect.stringContaining("main-1.jpg"));
    expect(screen.getByLabelText("商品名称")).toHaveValue("");
    expect(props.onReferenceAdd).not.toHaveBeenCalled();
    expect(props.onTask).not.toHaveBeenCalled();
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
    expect(screen.queryByLabelText("面料裁切左")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "加载最新方案" }));
    expect(screen.getByLabelText("颜色")).toHaveValue("最新白色");
  });
  it("prepares an editable Chinese draft without creating tasks, submitting or uploading", () => {
    const onPrepareModelPrompt = vi.fn(() => true);
    const gateway = { create: vi.fn(), save: vi.fn(), upload: vi.fn(), submit: vi.fn() };
    const task = apparelTaskSchema.parse({ id: apparelIds[7], sessionId: "session", engine: "apparel-catalog",
      revision: 1, plan: apparelFixture, createdAt: "2026-10-06", updatedAt: "2026-10-06", runs: [] });
    render(<ApparelWorkspace {...props} task={task} gateway={gateway as unknown as ApparelGateway} onPrepareModelPrompt={onPrepareModelPrompt} />);
    expect(onPrepareModelPrompt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "前往生图工作台" }));
    expect(onPrepareModelPrompt).toHaveBeenCalledWith(expect.stringContaining(apparelFixture.brief.name), []);
    for (const operation of Object.values(gateway)) expect(operation).not.toHaveBeenCalled();
  });
  it("does not prepare a prompt for invalid product information", () => {
    const onPrepareModelPrompt = vi.fn();
    render(<ApparelWorkspace {...props} onPrepareModelPrompt={onPrepareModelPrompt} />);
    fireEvent.click(screen.getByRole("button", { name: "前往生图工作台" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(onPrepareModelPrompt).not.toHaveBeenCalled();
  });
});
