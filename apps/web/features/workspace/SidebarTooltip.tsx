'use client';

import { cloneElement, useEffect, useState, type HTMLAttributes, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Glass } from '@/features/brand/Glass';
import styles from './workspace.module.css';

type TriggerProps = HTMLAttributes<HTMLElement>;

/** Enhance the existing trigger without changing the rail's direct-child layout. */
export function SidebarTooltip({ enabled, title, children }: {
  enabled: boolean; title: string; children: ReactElement<TriggerProps>;
}) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!position) return;
    const dismiss = () => setPosition(null);
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    document.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      document.removeEventListener('keydown', keyboard);
    };
  }, [position]);
  const show = (element: HTMLElement) => {
    if (!enabled || window.innerWidth < 768) return;
    const rect = element.getBoundingClientRect();
    const edge = element.closest('aside')?.getBoundingClientRect().right ?? rect.right;
    setPosition({ left: edge + 10, top: Math.min(window.innerHeight - 52, Math.max(12, rect.top + rect.height / 2 - 17)) });
  };
  return <>
    {cloneElement(children, {
      onMouseEnter: event => { children.props.onMouseEnter?.(event); if (!event.defaultPrevented) show(event.currentTarget); },
      onMouseLeave: event => { children.props.onMouseLeave?.(event); setPosition(null); },
      onFocus: event => { children.props.onFocus?.(event); if (!event.defaultPrevented) show(event.currentTarget); },
      onBlur: event => { children.props.onBlur?.(event); setPosition(null); },
      onPointerDown: event => { children.props.onPointerDown?.(event); setPosition(null); },
    })}
    {enabled && position && createPortal(<div role="tooltip" className={styles.sidebarTooltipPosition} style={position}>
      <Glass className={styles.sidebarTooltip}>{title}</Glass>
    </div>, document.body)}
  </>;
}
