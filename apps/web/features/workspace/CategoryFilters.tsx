'use client';

import { useLayoutEffect, useRef } from 'react';
import styles from './session-sidebar.module.css';

export type Category = 'all' | 'general' | 'commerce';
export const categories: [Category, string][] = [
  ['all', '全部'],
  ['general', '普通创作'],
  ['commerce', '电商生图'],
];

// Selected geometry adaptation of React Bits GooeyNav (MIT + Commons Clause).
// Pinned source and unchanged license: public/licenses/gooey-nav-LICENSE.md.
// Only the indicator moves; buttons and labels are stable native controls.
export function CategoryFilters({
  value,
  onChange,
  inert = false,
}: {
  value: Category;
  onChange: (value: Category) => void;
  inert?: boolean;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<((animate: boolean) => void) | null>(null);

  useLayoutEffect(() => {
    const group = groupRef.current;
    const indicator = indicatorRef.current;
    if (!group || !indicator) return;
    const measure = (animate: boolean) => {
      const selected = group.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (!selected) return;
      const box = group.getBoundingClientRect();
      const rect = selected.getBoundingClientRect();
      if (box.width <= 0 || rect.width <= 0 || rect.height <= 0) {
        delete group.dataset.indicatorReady;
        return;
      }
      // Resize/reopen is a geometry correction, not another selection animation.
      if (!animate) indicator.style.transition = 'none';
      Object.assign(indicator.style, {
        transform: `translate(${rect.left - box.left}px, ${rect.top - box.top}px)`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      group.dataset.indicatorReady = 'true';
      if (!animate) {
        indicator.getBoundingClientRect();
        indicator.style.removeProperty('transition');
      }
    };
    measureRef.current = measure;
    measure(false);
    const resize = () => measure(false);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(group);
    group.querySelectorAll('button').forEach((button) => observer?.observe(button));
    window.addEventListener('resize', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      measureRef.current = null;
      delete group.dataset.indicatorReady;
    };
  }, []);

  useLayoutEffect(() => {
    measureRef.current?.(true);
  }, [value, inert]);

  return (
    <div
      ref={groupRef}
      className={styles.categories}
      role="group"
      aria-label="会话分类"
      inert={inert}
    >
      <span
        ref={indicatorRef}
        className={styles.categoryIndicator}
        data-gooey-indicator=""
        aria-hidden="true"
      />
      {categories.map(([key, label]) => (
        <button key={key} type="button" onClick={() => onChange(key)} aria-pressed={value === key}>
          {label}
        </button>
      ))}
    </div>
  );
}
