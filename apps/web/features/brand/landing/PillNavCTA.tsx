"use client";

import { useLandingAuthorized, WORKSPACE_LOGIN_HREF } from "./LandingAuth";
import { IntentLink } from "@/features/brand/IntentLink";
import type { MouseEventHandler } from "react";
import { ArrowUpRight } from "lucide-react";
import "./pill-nav-cta.css";

/**
 * Single-link adaptation of React Bits Pill Nav's circular fill / rolling labels.
 * Copyright (c) 2026 David Haz — MIT + Commons Clause.
 * Pinned source and adaptation details: docs/pill-nav-cta.md.
 */
export function PillNavCTA({
  variant = "button",
  onClick,
}: {
  variant?: "button" | "nav";
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
  const authorized = useLandingAuthorized();
  return (
    <IntentLink
      href={authorized ? "/workspace" : WORKSPACE_LOGIN_HREF}
      className={`${variant === "nav" ? "zl-nav-cta" : "zl-button zl-button-primary"} zl-pill-cta`}
      onClick={onClick}
    >
      <span className="zl-pill-cta-fill" aria-hidden="true" />
      <span className="zl-pill-cta-labels">
        <span className="zl-pill-cta-label">
          开始创作 <ArrowUpRight aria-hidden="true" />
        </span>
        <span className="zl-pill-cta-label-alt" aria-hidden="true">
          开始创作 <ArrowUpRight aria-hidden="true" />
        </span>
      </span>
    </IntentLink>
  );
}
