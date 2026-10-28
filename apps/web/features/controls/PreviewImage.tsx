"use client";
/* eslint-disable @next/next/no-img-element -- Private signed URLs and local object URLs must preserve caller-owned loading and refresh lifecycles. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight, ImageIcon, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useDialogLifecycle } from "./NativeControls";
import "./image-preview.css";

type Entry = { src: string; alt: string };
type Gallery = {
  register: (id: string, image: Entry) => void;
  unregister: (id: string) => void;
  open: (id: string, src: string) => void;
};
const GalleryContext = createContext<Gallery | null>(null);

export function ImageGallery({
  children,
  sources,
}: {
  children?: ReactNode;
  sources?: Entry[];
}) {
  const [images, setImages] = useState<Map<string, Entry>>(() => new Map());
  const [selected, setSelected] = useState<string>();
  const register = useCallback((id: string, image: Entry) => {
    setImages((old) => new Map(old).set(id, image));
  }, []);
  const unregister = useCallback((id: string) => {
    setImages((old) => {
      const next = new Map(old);
      next.delete(id);
      return next;
    });
  }, []);
  const open = useCallback(
    (id: string, src: string) => {
      const sourceIndex = sources?.findIndex((image) => image.src === src);
      setSelected(
        sourceIndex !== undefined && sourceIndex >= 0
          ? `source-${sourceIndex}`
          : id,
      );
    },
    [sources],
  );
  const context = useMemo(
    () => ({ register, unregister, open }),
    [register, unregister, open],
  );
  const entries: [string, Entry][] = sources
    ? sources.map((image, index) => [`source-${index}`, image])
    : [...images];
  // Explicit source identities belong to the list, never to mounted thumbnails.
  // Resolve the opener once at activation; later URL refreshes and deferred
  // registrations cannot replace the selected list slot's identity.
  const index = entries.findIndex(([id]) => id === selected);
  const image = entries[index]?.[1];
  return (
    <GalleryContext.Provider value={context}>
      {children}
      {image && (
        <ImagePreviewDialog
          image={image}
          position={`${index + 1} / ${entries.length}`}
          onClose={() => setSelected(undefined)}
          onPrevious={
            index > 0 ? () => setSelected(entries[index - 1]![0]) : undefined
          }
          onNext={
            index < entries.length - 1
              ? () => setSelected(entries[index + 1]![0])
              : undefined
          }
        />
      )}
    </GalleryContext.Provider>
  );
}
export function PreviewImage({
  src,
  alt = "",
  fullSource,
  rootClassName = "",
  className = "",
  onClick,
  previewEnabled = true,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  src?: string;
  fullSource?: string;
  rootClassName?: string;
  previewEnabled?: boolean;
}) {
  const group = useContext(GalleryContext);
  const id = useId();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (src && previewEnabled)
      group?.register(id, { src: fullSource ?? src, alt });
    else group?.unregister(id);
  }, [group, id, src, fullSource, alt, previewEnabled]);
  useEffect(() => () => group?.unregister(id), [group, id]);
  const image = (
    <img
      {...props}
      src={src}
      alt={alt}
      className={`zi-control-image-img ${className}`}
      onClick={previewEnabled ? undefined : onClick}
    />
  );
  if (!previewEnabled)
    return <span className={`zi-control-image ${rootClassName}`}>{image}</span>;
  return (
    <>
      <button
        ref={opener}
        type="button"
        className={`zi-control-image ${rootClassName}`}
        aria-label={`预览 ${alt || "图片"}`}
        onClick={(event) => {
          onClick?.(event as unknown as MouseEvent<HTMLImageElement>);
          if (src) {
            opener.current?.focus({ preventScroll: true });
            if (group) group.open(id, fullSource ?? src);
            else setOpen(true);
          }
        }}
      >
        {image}
      </button>
      {open && src && (
        <ImagePreviewDialog
          image={{ src: fullSource ?? src, alt }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Adapted from verified reference 2450e9a ImagePreviewDialog and image-preview.css. */
function ImagePreviewDialog({
  image,
  position,
  onClose,
  onPrevious,
  onNext,
}: {
  image: Entry;
  position?: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useDialogLifecycle(ref);
  return createPortal(
    <dialog
      ref={ref}
      className="zi-control-image-preview-dialog zi-control-image-preview-only"
      aria-label={image.alt || "图片预览"}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          (event.key === "ArrowLeft" ? onPrevious : onNext)?.();
        }
      }}
    >
      <div className="zi-control-image-preview-heading">
        <button
          type="button"
          className="zi-control-image-preview-control"
          aria-label="关闭图片"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <PreviewContent key={image.src} image={image} />
      {position && (
        <p className="zi-control-image-preview-help" aria-live="polite">
          {position}
        </p>
      )}
      {(onPrevious || onNext) && (
        <nav
          className="zi-control-image-preview-navigation"
          aria-label="图片浏览"
        >
          <button
            type="button"
            className="zi-control-image-preview-control"
            aria-label="上一张图片"
            disabled={!onPrevious}
            onClick={onPrevious}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="zi-control-image-preview-control"
            aria-label="下一张图片"
            disabled={!onNext}
            onClick={onNext}
          >
            <ChevronRight size={18} />
          </button>
        </nav>
      )}
    </dialog>,
    document.body,
  );
}
function PreviewContent({ image }: { image: Entry }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <img
        className="zi-control-image-preview-full"
        src={image.src}
        alt={image.alt}
        hidden={failed}
        onError={() => setFailed(true)}
      />
      {failed && (
        <div className="zi-control-image-preview-error" role="status">
          <ImageIcon aria-hidden />
          <p>图片暂时无法显示</p>
        </div>
      )}
    </>
  );
}
