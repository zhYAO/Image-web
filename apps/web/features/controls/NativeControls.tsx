"use client";

import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Glass } from "@/features/brand/Glass";
import "./native-controls.css";

type ActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "default" | "text" | "link" | "dashed";
  size?: "small" | "middle" | "large";
  icon?: ReactNode;
  busy?: boolean;
  danger?: boolean;
  shape?: "circle" | "round";
  block?: boolean;
};
export const ActionButton = forwardRef<HTMLButtonElement, ActionProps>(
  function ActionButton(
    {
      variant = "default",
      size,
      icon,
      busy,
      danger,
      shape,
      block,
      disabled,
      className = "",
      children,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        data-variant={variant}
        data-size={size}
        data-danger={danger || undefined}
        data-shape={shape}
        data-block={block || undefined}
        className={`zi-control-button ${className}`}
      >
        {(busy || icon) && (
          <span className="zi-control-button-icon">
            {busy ? <BusyIndicator /> : icon}
          </span>
        )}
        {children}
      </button>
    );
  },
);
export const TextField = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
    size?: "small" | "middle" | "large";
    onEnter?: (event: KeyboardEvent<HTMLInputElement>) => void;
  }
>(function TextField(
  { size, onEnter, onKeyDown, className = "", ...props },
  ref,
) {
  return (
    <input
      {...props}
      ref={ref}
      data-size={size}
      className={`zi-control-input ${className}`}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key === "Enter" && !event.nativeEvent.isComposing)
          onEnter?.(event);
      }}
    />
  );
});
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    autoResize?: { minRows?: number; maxRows?: number };
    borderless?: boolean;
  }
>(function TextArea(
  { autoResize, borderless, className = "", style, ...props },
  forwarded,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !autoResize) return;
    const computed = getComputedStyle(node);
    const line = parseFloat(computed.lineHeight) || 22;
    const padding =
      (parseFloat(computed.paddingTop) || 0) +
      (parseFloat(computed.paddingBottom) || 0);
    node.style.height = "auto";
    node.style.height = `${Math.max(line * (autoResize.minRows ?? 1) + padding, Math.min(node.scrollHeight, line * (autoResize.maxRows ?? 20) + padding))}px`;
    node.style.overflowY =
      node.scrollHeight > line * (autoResize.maxRows ?? 20) + padding
        ? "auto"
        : "hidden";
  }, [props.value, autoResize]);
  return (
    <textarea
      {...props}
      rows={autoResize?.minRows ?? props.rows}
      ref={(node) => {
        ref.current = node;
        if (typeof forwarded === "function") forwarded(node);
        else if (forwarded) forwarded.current = node;
      }}
      style={style}
      data-borderless={borderless || undefined}
      className={`zi-control-input zi-control-textarea ${className}`}
    />
  );
});
export function BusyIndicator({
  size,
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { size?: "small" | "default" | "large" }) {
  return (
    <span
      {...props}
      role={props.role ?? "status"}
      aria-label={props["aria-label"] ?? "加载中"}
      data-size={size}
      className={`zi-control-spinner ${className}`}
    />
  );
}
export function StatusBadge({
  tone,
  children,
  className = "",
}: {
  tone?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span data-tone={tone} className={`zi-control-badge ${className}`}>
      {children}
    </span>
  );
}
export function InlineNotice({
  title,
  description,
  action,
  tone = "info",
  dismissible,
  onDismiss,
  className = "",
  role = "alert",
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
  role?: string;
}) {
  return (
    <div
      role={role}
      data-tone={tone}
      className={`zi-control-notice ${className}`}
    >
      <div>
        {title && <strong>{title}</strong>}
        {description && <div>{description}</div>}
      </div>
      {action}
      {dismissible && (
        <ActionButton variant="text" aria-label="关闭" onClick={onDismiss}>
          <X size={16} />
        </ActionButton>
      )}
    </div>
  );
}
export function ControlCluster({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <div className={`zi-control-cluster ${className}`}>{children}</div>;
}

// Native top-layer lifecycle adapted from reference 2450e9a CommerceDialog.
// The browser owns focus containment; restore the actual opener on unmount.
let locks = 0;
let savedOverflow = "";
export function useDialogLifecycle(ref: { current: HTMLDialogElement | null }) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const focused = document.activeElement as HTMLElement | null;
    if (!locks++) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    node.showModal();
    node
      .querySelector<HTMLElement>(
        "[autofocus],button,input,textarea,select,a[href]",
      )
      ?.focus({ preventScroll: true });
    return () => {
      if (node.open) node.close();
      if (!--locks) document.body.style.overflow = savedOverflow;
      if (focused?.isConnected) focused.focus({ preventScroll: true });
    };
  }, [ref]);
}
type DialogProps = {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  width?: number | string;
  confirmLabel?: string;
  onConfirm?: () => void;
  hideCancel?: boolean;
  placement?: "left" | "right";
};
export function ContentDialog(props: DialogProps) {
  return props.open ? <DialogContent {...props} /> : null;
}
function DialogContent({
  title,
  children,
  onClose,
  footer,
  className = "",
  width,
  confirmLabel = "确定",
  onConfirm,
  hideCancel,
  placement,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useDialogLifecycle(ref);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className={`zi-control-dialog ${placement ? "zi-control-drawer" : ""} ${className}`}
      data-placement={placement}
      style={
        {
          "--zi-dialog-width": typeof width === "number" ? `${width}px` : width,
        } as CSSProperties
      }
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="zi-control-dialog-heading">
        <h2 id={id}>{title}</h2>
        <ActionButton variant="text" aria-label="关闭" onClick={onClose}>
          <X size={18} />
        </ActionButton>
      </div>
      <div
        className={
          placement ? "zi-control-drawer-body" : "zi-control-dialog-body"
        }
      >
        {children}
      </div>
      {footer !== null && (
        <div className="zi-control-dialog-footer">
          {footer ?? (
            <>
              {!hideCancel && (
                <ActionButton onClick={onClose}>取消</ActionButton>
              )}
              {onConfirm && (
                <ActionButton variant="primary" onClick={onConfirm}>
                  {confirmLabel}
                </ActionButton>
              )}
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
export function SideDrawer({
  children,
  ...props
}: Omit<DialogProps, "footer">) {
  return (
    <ContentDialog
      {...props}
      placement={props.placement ?? "right"}
      footer={null}
    >
      {children}
    </ContentDialog>
  );
}

// Position and outside/Escape behavior adapted from reference AnchoredPopover.
export function AnchoredPanel({
  content,
  children,
  label = "操作",
  placement = "rightTop",
}: {
  content: ReactNode | ((close: () => void) => ReactNode);
  children: ReactElement;
  label?: string;
  placement?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement>();
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({
    visibility: "hidden",
  });
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = panel.current?.offsetWidth || 244;
      const height = panel.current?.offsetHeight || 140;
      setPosition({
        position: "fixed",
        left: Math.max(
          12,
          Math.min(
            window.innerWidth - width - 12,
            placement.startsWith("right") ? rect.right + 10 : rect.left,
          ),
        ),
        top: Math.max(12, Math.min(window.innerHeight - height - 12, rect.top)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, placement]);
  useEffect(() => {
    if (!anchor) return;
    panel.current
      ?.querySelector<HTMLElement>('input,button,a[href],[tabindex="0"]')
      ?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !anchor.contains(event.target as Node)
      )
        setAnchor(undefined);
    };
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        // A child native dialog owns its cancel key and focus containment.
        const activeDialog = document.activeElement?.closest("dialog");
        if (activeDialog && activeDialog !== anchor.closest("dialog")) return;
        event.preventDefault();
        event.stopPropagation();
        setAnchor(undefined);
        anchor.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, [anchor]);
  const child = children as ReactElement<{
    onClick?: (event: React.MouseEvent<HTMLElement>) => void;
    "aria-expanded"?: boolean;
    "aria-haspopup"?: string;
  }>;
  return (
    <>
      {cloneElement(child, {
        "aria-expanded": !!anchor,
        "aria-haspopup": "dialog",
        onClick: (event) => {
          child.props.onClick?.(event);
          const trigger = event.currentTarget;
          setAnchor((old) => (old ? undefined : trigger));
        },
      })}
      {anchor &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={label}
            className="zi-control-popover"
            style={position}
          >
            <Glass>{typeof content === "function" ? content(() => { setAnchor(undefined); anchor.focus(); }) : content}</Glass>
          </div>,
          anchor.closest("dialog") ?? document.body,
        )}
    </>
  );
}
export function Hint({
  title,
  children,
}: {
  title: string;
  children: ReactElement;
}) {
  return isValidElement(children)
    ? cloneElement(children as ReactElement<{ title?: string }>, { title })
    : children;
}
export function ConfirmAction({
  title,
  description,
  confirmLabel = "确定",
  cancelLabel = "取消",
  onConfirm,
  disabled,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  };
  const child = children as ReactElement<{
    onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  }>;
  return (
    <>
      {cloneElement(child, {
        onClick: (event) => {
          child.props.onClick?.(event);
          if (!disabled) {
            setError("");
            setOpen(true);
          }
        },
      })}
      <ContentDialog
        open={open}
        title={title}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        footer={
          <>
            <ActionButton disabled={busy} onClick={() => setOpen(false)}>
              {cancelLabel}
            </ActionButton>
            <ActionButton
              danger
              busy={busy}
              variant="primary"
              onClick={() => void confirm()}
            >
              {confirmLabel}
            </ActionButton>
          </>
        }
      >
        {description && <p>{description}</p>}
        {error && <p role="alert">{error}</p>}
      </ContentDialog>
    </>
  );
}
