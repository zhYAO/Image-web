import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  ActionButton,
  AnchoredPanel,
  ConfirmAction,
  ContentDialog,
  SideDrawer,
  TextArea,
  TextField,
} from "../features/controls/NativeControls";
import { ImageGallery, PreviewImage } from "../features/controls/PreviewImage";

describe("native controls", () => {
  it("keeps the selected explicit slot open when its signed full source refreshes", () => {
    const view = (fullSource: string) => (
      <ImageGallery sources={[{ src: fullSource, alt: "Result" }]}>
        <PreviewImage
          src="/thumbnail.jpg"
          fullSource={fullSource}
          alt="Result"
        />
      </ImageGallery>
    );
    const rendered = render(view("/signed-old.jpg"));
    fireEvent.click(screen.getByAltText("Result"));
    const viewer = screen.getByRole("dialog");
    expect(viewer.querySelector("img")).toHaveAttribute(
      "src",
      "/signed-old.jpg",
    );
    rendered.rerender(view("/signed-refreshed.jpg"));
    expect(screen.getByRole("dialog")).toBe(viewer);
    expect(viewer.querySelector("img")).toHaveAttribute(
      "src",
      "/signed-refreshed.jpg",
    );
  });
  it("keeps an explicit gallery selection when a deferred thumbnail mounts", () => {
    const sources = [
      { src: "/first.jpg", alt: "First" },
      { src: "/last.jpg", alt: "Last" },
    ];
    const view = (mounted: boolean) => (
      <ImageGallery sources={sources}>
        <PreviewImage src="/first.jpg" alt="First" />
        {mounted && <PreviewImage src="/last.jpg" alt="Last" />}
      </ImageGallery>
    );
    const rendered = render(view(false));
    fireEvent.click(screen.getByAltText("First"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    const viewer = screen.getByRole("dialog");
    expect(viewer.querySelector("img")).toHaveAttribute("src", "/last.jpg");
    rendered.rerender(view(true));
    expect(screen.getByRole("dialog")).toBe(viewer);
    expect(viewer.querySelector("img")).toHaveAttribute("src", "/last.jpg");
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });
  it("cancels a portaled image viewer without cancelling its underlying drawer", () => {
    const closeDrawer = vi.fn();
    render(
      <SideDrawer open title="Assets" onClose={closeDrawer}>
        <PreviewImage src="/nested.jpg" alt="Nested" />
      </SideDrawer>,
    );
    fireEvent.click(screen.getByAltText("Nested"));
    fireEvent(
      screen.getByRole("dialog", { name: "Nested" }),
      new Event("cancel", { cancelable: true }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Nested" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Assets" })).toBeInTheDocument();
    expect(closeDrawer).not.toHaveBeenCalled();
  });
  it("cancels a nested content dialog without cancelling its parent", () => {
    const closeDrawer = vi.fn();
    const closeChild = vi.fn();
    render(
      <SideDrawer open title="Assets" onClose={closeDrawer}>
        <ContentDialog open title="Details" onClose={closeChild}>
          Details body
        </ContentDialog>
      </SideDrawer>,
    );
    fireEvent(
      screen.getByRole("dialog", { name: "Details" }),
      new Event("cancel", { cancelable: true }),
    );
    expect(closeChild).toHaveBeenCalledOnce();
    expect(closeDrawer).not.toHaveBeenCalled();
  });
  it("lets a nested native confirmation own Escape without dismissing its popover", () => {
    render(
      <AnchoredPanel
        label="Session actions"
        content={
          <ConfirmAction title="Delete session?" onConfirm={() => {}}>
            <ActionButton>Remove</ActionButton>
          </ConfirmAction>
        }
      >
        <ActionButton>Actions</ActionButton>
      </AnchoredPanel>,
    );
    fireEvent.click(screen.getByText("Actions"));
    fireEvent.click(screen.getByText("Remove"));
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    fireEvent(
      screen.getByRole("dialog", { name: "Delete session?" }),
      new Event("cancel", { cancelable: true }),
    );
    expect(
      screen.getByRole("dialog", { name: "Session actions" }),
    ).toBeInTheDocument();
  });
  it("keeps asynchronous confirmation open and busy until deletion settles", async () => {
    let finish!: () => void;
    const deleted = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <ConfirmAction
        title="Delete session?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={deleted}
      >
        <ActionButton>Remove</ActionButton>
      </ConfirmAction>,
    );
    fireEvent.click(screen.getByText("Remove"));
    fireEvent.click(screen.getByText("Delete"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeDisabled();
    finish();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
  it("preserves failed confirmations for retry", async () => {
    render(
      <ConfirmAction
        title="Delete session?"
        confirmLabel="Delete"
        onConfirm={async () => {
          throw new Error("Try again");
        }}
      >
        <ActionButton>Remove</ActionButton>
      </ConfirmAction>,
    );
    fireEvent.click(screen.getByText("Remove"));
    fireEvent.click(screen.getByText("Delete"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("uses native dialogs and restores focus after Escape cancellation", async () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <ActionButton onClick={() => setOpen(true)}>Open</ActionButton>
          <ContentDialog
            open={open}
            title="Settings"
            onClose={() => setOpen(false)}
          >
            Body
          </ContentDialog>
        </>
      );
    }
    render(<Example />);
    const opener = screen.getByText("Open");
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    expect(dialog.tagName).toBe("DIALOG");
    fireEvent(
      dialog,
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    await waitFor(() => expect(opener).toHaveFocus());
  });
  it("keeps controlled input and textarea values and native keyboard callbacks", () => {
    const change = vi.fn();
    const enter = vi.fn();
    render(
      <>
        <TextField
          aria-label="Title"
          value="Draft"
          onChange={change}
          onEnter={enter}
        />
        <TextArea
          aria-label="Prompt"
          value="Hello"
          onChange={change}
          autoResize={{ minRows: 2, maxRows: 5 }}
        />
      </>,
    );
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "New" },
    });
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Enter" });
    expect(change).toHaveBeenCalledOnce();
    expect(enter).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Prompt")).toHaveValue("Hello");
  });
  it("navigates only its mounted image group and uses the full image override", () => {
    render(
      <>
        <ImageGallery>
          <PreviewImage src="/thumb-a.jpg" fullSource="/full-a.jpg" alt="A" />
          <PreviewImage src="/b.jpg" alt="B" />
        </ImageGallery>
        <ImageGallery>
          <PreviewImage src="/c.jpg" alt="C" />
        </ImageGallery>
      </>,
    );
    fireEvent.click(screen.getByAltText("A"));
    expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute(
      "src",
      "/full-a.jpg",
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute(
      "src",
      "/b.jpg",
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute(
      "src",
      "/b.jpg",
    );
  });
});
