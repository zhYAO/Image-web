import type { CSSProperties } from "react";

export type WorkspaceIconName =
  "create" | "commerce" | "conversation" | "filter" | "collapse" | "expand";

/** Original rounded glyphs; stable, muted tints keep each conversation recognizable. */
export function WorkspaceIcon({
  name,
  seed = "",
  size = 24,
}: {
  name: WorkspaceIconName;
  seed?: string;
  size?: number;
}) {
  const hash = Array.from(seed).reduce(
    (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
    0,
  );
  const color = seed
    ? ["#8269aa", "#7e819f", "#a07999", "#678b98"][hash % 4]
    : "var(--z-primary)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ color, flexShrink: 0 } as CSSProperties}
    >
      {name === "create" && (
        <>
          <path
            d="M16 4c1.4 6.8 5.2 10.6 12 12-6.8 1.4-10.6 5.2-12 12C14.6 21.2 10.8 17.4 4 16 10.8 14.6 14.6 10.8 16 4Z"
            fill="currentColor"
            fillOpacity=".12"
          />
          <path d="M13 16h6m-3-3v6" />
        </>
      )}
      {name === "commerce" && (
        <>
          <path
            d="m7 12-1.5 13c-.2 1.8 1 3 2.8 3h15.4c1.8 0 3-1.2 2.8-3L25 12Z"
            fill="currentColor"
            fillOpacity=".12"
          />
          <path d="M11 13V9a5 5 0 0 1 10 0v4M12 19c2.5 2.2 5.5 2.2 8 0" />
        </>
      )}
      {name === "conversation" && (
        <>
          <path
            d="M5 13c0-5 4-8 11-8s11 3 11 8v6c0 5-4 8-11 8h-2l-6 2 1-5c-3-1-4-3-4-6Z"
            fill="currentColor"
            fillOpacity=".1"
          />
          <path d="M11 13h10m-10 5h6" />
          <circle cx="24" cy="7" r="3.5" fill="var(--z-panel)" />
        </>
      )}
      {name === "filter" && (
        <>
          <path d="M6 9h20M6 23h20" />
          <rect
            x="11"
            y="5"
            width="6"
            height="8"
            rx="3"
            fill="var(--z-panel)"
          />
          <rect
            x="19"
            y="19"
            width="6"
            height="8"
            rx="3"
            fill="var(--z-panel)"
          />
        </>
      )}
      {(name === "collapse" || name === "expand") && (
        <>
          <rect
            x="5"
            y="6"
            width="22"
            height="20"
            rx="6"
            fill="currentColor"
            fillOpacity=".08"
          />
          <path d="M12 7v18" />
          <path d={name === "collapse" ? "m21 12-4 4 4 4" : "m18 12 4 4-4 4"} />
        </>
      )}
    </svg>
  );
}
