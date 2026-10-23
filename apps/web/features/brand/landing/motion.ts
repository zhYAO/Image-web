/** Geometry adapted from clone-web/open-design-home-clone snapshot 05c9c01. */
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export const GALLERY_INTERVAL_MS = 10_000;
export function nextCondensed(current: boolean, y: number) {
  return current ? y >= 24 : y > 64;
}
export function reelFrameState(scrolled: number, range: number, count: number) {
  const progress =
    clamp(scrolled / Math.max(1, range), 0, 1) * Math.max(0, count - 1);
  return {
    active: count ? clamp(Math.round(progress), 0, count - 1) : 0,
    offsets: Array.from(
      { length: count },
      (_, index) => clamp(index - progress, 0, 1) * 100,
    ),
  };
}
export function statementOpacity(
  top: number,
  viewportHeight: number,
  count: number,
) {
  const progress = clamp(
    (viewportHeight * 0.82 - top) / Math.max(1, viewportHeight * 0.6),
    0,
    1,
  );
  return Array.from(
    { length: count },
    (_, index) => 0.18 + 0.82 * clamp(progress * count - index, 0, 1),
  );
}
export function isReelPinned(
  width: number,
  height: number,
  reducedMotion: boolean,
) {
  return width > 880 && height > 680 && !reducedMotion;
}
export interface GalleryConditions {
  visible: boolean;
  hovered: boolean;
  focused: boolean;
  manual: boolean;
  paused: boolean;
  hidden: boolean;
  reducedMotion: boolean;
}
export function canCycleGallery(state: GalleryConditions) {
  return (
    state.visible &&
    !state.hovered &&
    !state.focused &&
    !state.manual &&
    !state.paused &&
    !state.hidden &&
    !state.reducedMotion
  );
}
