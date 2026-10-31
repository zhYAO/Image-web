/**
 * React Bits GlassSurface SVG refraction adaptation.
 * Copyright (c) 2026 David Haz. MIT + Commons Clause; see licenses/react-bits-LICENSE.md.
 * Source revision 43591e8b3fa327d45633b4e8239ff6742ef706ef:
 * src/ts-default/Components/GlassSurface/GlassSurface.tsx
 * Retains upstream transparent RGB ramps, soft center, channel separation and screen blends.
 * App adaptations: four computed corners, restrained -50/-47/-44 displacement,
 * shared/debounced lifecycle, live accessibility fallbacks. No WebGL or shape rasterizer.
 */
const SVG_NS = "http://www.w3.org/2000/svg";
const FILTER_PROPERTY = "--liquid-glass-filter";
const managers = new WeakMap();
let nextFilterId = 0;
const finite = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value) => Math.round(value * 1000) / 1000;

function radiusPair(value, width, height) {
  const parts = String(value || "0")
    .trim()
    .split(/\s+/);
  const length = (part, size) =>
    Math.max(
      0,
      String(part).endsWith("%")
        ? (finite(parseFloat(part)) * size) / 100
        : finite(parseFloat(part)),
    );
  return [length(parts[0], width), length(parts[1] || parts[0], height)];
}

/** Respect all four computed corners, including elliptical/percentage radii. */
export function resolveGlassRadii(width, height, corners = []) {
  width = Math.max(1, finite(width, 1));
  height = Math.max(1, finite(height, 1));
  const radii = Array.from({ length: 4 }, (_, index) => {
    const corner = corners[index] ?? 0;
    return Array.isArray(corner)
      ? [corner[0], corner[1] ?? corner[0]].map((value) =>
          Math.max(0, finite(value)),
        )
      : radiusPair(corner, width, height);
  });
  const [tl, tr, br, bl] = radii;
  // CSS radius normalization: opposing corners must never overlap.
  const factors = [
    1,
    width / (tl[0] + tr[0]),
    width / (bl[0] + br[0]),
    height / (tl[1] + bl[1]),
    height / (tr[1] + br[1]),
  ];
  const factor = Math.min(...factors);
  return radii.map((pair) => pair.map((value) => round(value * factor)));
}

function roundedPath(width, height, corners, inset = 0) {
  const [tl, tr, br, bl] = corners.map((pair) =>
    pair.map((value) => Math.max(0, round(value - inset))),
  );
  const l = round(inset),
    t = l,
    r = round(width - inset),
    b = round(height - inset);
  const arc = (corner, x, y) =>
    corner[0] && corner[1]
      ? `A${corner[0]} ${corner[1]} 0 0 1 ${x} ${y}`
      : `L${x} ${y}`;
  return `M${round(l + tl[0])} ${t}H${round(r - tr[0])}${arc(tr, r, round(t + tr[1]))}V${round(b - br[1])}${arc(br, round(r - br[0]), b)}H${round(l + bl[0])}${arc(bl, l, round(b - bl[1]))}V${round(t + tl[1])}${arc(tl, round(l + tl[0]), t)}Z`;
}

/** Pure map builder for rectangular, rounded and capsule-shaped surfaces. */
export function buildLiquidGlassMap(width, height, corners = []) {
  width = Math.max(1, Math.round(finite(width, 1)));
  height = Math.max(1, Math.round(finite(height, 1)));
  const radii = resolveGlassRadii(width, height, corners),
    inset = Math.min(width, height) * 0.035;
  const edge = roundedPath(width, height, radii),
    center = roundedPath(width, height, radii, inset);
  // Upstream transparent ramps and explicit SVG blur keep the map self-contained.
  const svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="${SVG_NS}"><defs><linearGradient id="red" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/></linearGradient><linearGradient id="blue" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/></linearGradient><filter id="soft" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="11" /></filter></defs><rect width="${width}" height="${height}" fill="black"/><path d="${edge}" fill="url(#red)"/><path d="${edge}" fill="url(#blue)" style="mix-blend-mode:difference"/><path d="${center}" fill="hsl(0 0% 50% / .93)" filter="url(#soft)"/></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

function svgNode(document, name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  return node;
}

function createFilter(document, id) {
  const filter = svgNode(document, "filter", {
    id,
    "color-interpolation-filters": "sRGB",
    filterUnits: "userSpaceOnUse",
    primitiveUnits: "userSpaceOnUse",
    x: 0,
    y: 0,
  });
  const image = svgNode(document, "feImage", {
    x: 0,
    y: 0,
    preserveAspectRatio: "none",
    result: "map",
  });
  filter.append(image);
  const matrices = [
    "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0",
    "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0",
    "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0",
  ];
  ["red", "green", "blue"].forEach((channel, index) => {
    filter.append(
      svgNode(document, "feDisplacementMap", {
        in: "SourceGraphic",
        in2: "map",
        xChannelSelector: "R",
        yChannelSelector: "G",
        scale: -50 + index * 3,
        result: `disp-${channel}`,
      }),
    );
    filter.append(
      svgNode(document, "feColorMatrix", {
        in: `disp-${channel}`,
        type: "matrix",
        values: matrices[index],
        result: channel,
      }),
    );
  });
  filter.append(
    svgNode(document, "feBlend", {
      in: "red",
      in2: "green",
      mode: "screen",
      result: "rg",
    }),
  );
  filter.append(
    svgNode(document, "feBlend", {
      in: "rg",
      in2: "blue",
      mode: "screen",
      result: "output",
    }),
  );
  filter.append(
    svgNode(document, "feGaussianBlur", { in: "output", stdDeviation: 0.7 }),
  );
  return { filter, image };
}

function createManager(document) {
  const view = document.defaultView;
  const states = new Map(),
    pending = new Set();
  const preferences = [
    "(prefers-reduced-transparency: reduce)",
    "(prefers-contrast: more)",
    "(forced-colors: active)",
    "(prefers-reduced-motion: reduce)",
  ]
    .map((query) => view?.matchMedia?.(query))
    .filter(Boolean);
  const userAgent = view?.navigator?.userAgent || "";
  // Matches upstream's conservative SVG-backdrop support gate.
  const incompatible =
    /Firefox/.test(userAgent) ||
    (/Safari/.test(userAgent) && !/Chrome/.test(userAgent));
  const supported =
    !incompatible &&
    !!view?.CSS?.supports?.(
      "backdrop-filter",
      "url(#liquid-glass-support) blur(7px)",
    );
  let holder,
    defs,
    observer,
    timer,
    suspended = false;
  const allowed = () =>
    supported && !suspended && !preferences.some((query) => query.matches);
  const restoreFilter = (state) => {
    state.filter?.remove();
    state.filter = null;
    state.image = null;
    state.signature = "";
    state.element.classList.remove("is-liquid-refracted");
    if (state.previousFilter)
      state.element.style.setProperty(
        FILTER_PROPERTY,
        state.previousFilter,
        state.previousPriority,
      );
    else state.element.style.removeProperty(FILTER_PROPERTY);
  };
  const removeEmptyHolder = () => {
    if (holder && !defs.childElementCount) {
      holder.remove();
      holder = defs = null;
    }
  };
  const ensureDefs = () => {
    if (!holder) {
      holder = svgNode(document, "svg", {
        class: "liquid-glass-defs",
        "aria-hidden": "true",
        focusable: "false",
        width: 0,
        height: 0,
      });
      defs = svgNode(document, "defs");
      holder.append(defs);
      (document.body || document.documentElement).append(holder);
    }
    return defs;
  };
  const sync = (state) => {
    if (
      !allowed() ||
      !state.element.isConnected ||
      state.element.matches?.('.surface-white,[data-liquid-glass="off"]')
    ) {
      restoreFilter(state);
      removeEmptyHolder();
      return;
    }
    // Filter coordinates are local border-box pixels, before CSS transforms.
    // A rotated/scaled card's visual bounding rectangle is not its map size.
    const element = state.element;
    const rect =
      typeof element.offsetWidth === "number" &&
      typeof element.offsetHeight === "number"
        ? { width: element.offsetWidth, height: element.offsetHeight }
        : element.getBoundingClientRect();
    const width = Math.round(rect.width),
      height = Math.round(rect.height);
    if (width < 1 || height < 1) {
      restoreFilter(state);
      removeEmptyHolder();
      return;
    }
    const style = view.getComputedStyle(state.element);
    const radii = resolveGlassRadii(width, height, [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ]);
    const signature = `${width}x${height}:${JSON.stringify(radii)}`;
    if (signature === state.signature) return;
    if (!state.filter) {
      Object.assign(state, createFilter(document, state.id));
      ensureDefs().append(state.filter);
    }
    for (const node of [state.filter, state.image]) {
      node.setAttribute("width", width);
      node.setAttribute("height", height);
    }
    state.image.setAttribute("href", buildLiquidGlassMap(width, height, radii));
    state.signature = signature;
    state.element.style.setProperty(FILTER_PROPERTY, `url("#${state.id}")`);
    state.element.classList.add("is-liquid-refracted");
  };
  const flush = () => {
    timer = undefined;
    const targets = [...pending];
    pending.clear();
    targets.forEach((state) => {
      if (states.has(state.element)) sync(state);
    });
  };
  const schedule = (targets) => {
    for (const state of targets) pending.add(state);
    view.clearTimeout(timer);
    // Rebuild once geometry settles, never on every transition/resize frame.
    timer = view.setTimeout(flush, 140);
  };
  const onResize = () => schedule(states.values());
  const observe = () => {
    if (!allowed()) return;
    if (view.ResizeObserver && !observer)
      observer = new view.ResizeObserver((entries) =>
        schedule(
          entries.map((entry) => states.get(entry.target)).filter(Boolean),
        ),
      );
    if (observer)
      for (const state of states.values()) observer.observe(state.element);
  };
  const onPreference = () => {
    view.clearTimeout(timer);
    pending.clear();
    observer?.disconnect();
    if (allowed()) {
      observe();
      states.forEach(sync);
    } else {
      states.forEach(restoreFilter);
      removeEmptyHolder();
    }
  };
  const onPageHide = () => {
    suspended = true;
    onPreference();
  };
  const onPageShow = () => {
    suspended = false;
    onPreference();
  };
  for (const query of preferences) {
    if (query.addEventListener) query.addEventListener("change", onPreference);
    else query.addListener?.(onPreference);
  }
  view?.addEventListener?.("resize", onResize, { passive: true });
  view?.addEventListener?.("pagehide", onPageHide);
  view?.addEventListener?.("pageshow", onPageShow);
  const destroy = () => {
    view?.clearTimeout(timer);
    pending.clear();
    observer?.disconnect();
    for (const query of preferences) {
      if (query.removeEventListener)
        query.removeEventListener("change", onPreference);
      else query.removeListener?.(onPreference);
    }
    view?.removeEventListener?.("resize", onResize);
    view?.removeEventListener?.("pagehide", onPageHide);
    view?.removeEventListener?.("pageshow", onPageShow);
    holder?.remove();
    holder = defs = null;
    managers.delete(document);
  };
  return {
    add(element) {
      let state = states.get(element);
      if (!state) {
        state = {
          element,
          id: `liquid-glass-${++nextFilterId}`,
          references: 0,
          signature: "",
          hadClass: element.classList.contains("liquid-glass"),
          previousFilter: element.style.getPropertyValue(FILTER_PROPERTY),
          previousPriority: element.style.getPropertyPriority(FILTER_PROPERTY),
        };
        states.set(element, state);
        element.classList.add("liquid-glass");
        observe();
        sync(state);
      }
      state.references++;
      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (--state.references > 0) return;
        observer?.unobserve(element);
        pending.delete(state);
        restoreFilter(state);
        states.delete(element);
        if (!state.hadClass) element.classList.remove("liquid-glass");
        removeEmptyHolder();
        if (!states.size) destroy();
      };
      dispose.refresh = () => {
        if (!disposed) schedule([state]);
      };
      return dispose;
    },
  };
}

/** Idempotent per-element enhancement. Calling each returned disposer releases its owner. */
export function enhanceLiquidGlass(element) {
  if (
    !element?.ownerDocument?.defaultView ||
    element.matches?.('.surface-white,[data-liquid-glass="off"]')
  )
    return () => {};
  const document = element.ownerDocument;
  let manager = managers.get(document);
  if (!manager) {
    manager = createManager(document);
    managers.set(document, manager);
  }
  return manager.add(element);
}
