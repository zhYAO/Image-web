'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import './glide-select.css';

/** React Bits / David Haz (2026), MIT + Commons Clause.
 * Visual selection adapted from 43591e8b3fa327d45633b4e8239ff6742ef706ef
 * through ZImage reference 2450e9a. License: public/licenses/react-bits-LICENSE.md.
 * Real application options/callbacks remain owned by callers. */
export interface GlideOption {
  value: string;
  label: ReactNode;
  textValue: string;
  detail?: ReactNode;
  disabled?: boolean;
}
interface GlideSelectProps {
  options: readonly GlideOption[];
  value?: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  includeValueInLabel?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  placement?: 'top' | 'bottom';
  menuWidth?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function GlideSelect({ options, value, onChange, ariaLabel, includeValueInLabel = false,
  placeholder = '请选择', disabled = false, className = '', placement = 'bottom', menuWidth = 280,
  open: controlledOpen, onOpenChange }: GlideSelectProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const opened = controlledOpen ?? internalOpen;
  const usable = options.map((item, index) => item.disabled ? -1 : index).filter(index => index >= 0);
  const selected = options.findIndex(item => item.value === value);
  const [active, setActive] = useState(-1);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const [pill, setPill] = useState<CSSProperties>({ opacity: 0 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', at: 0 });
  const id = useId();
  const show = opened && !disabled && usable.length > 0;
  const changeOpen = useCallback((next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);
  const close = useCallback((restore = false) => {
    if (restore) trigger.current?.focus({ preventScroll: true });
    changeOpen(false);
  }, [changeOpen]);
  const open = () => {
    if (disabled || !usable.length) return;
    setHost(trigger.current?.closest('dialog') || document.body);
    setActive(selected >= 0 && !options[selected]?.disabled ? selected : usable[0]!);
    search.current = { text: '', at: 0 };
    changeOpen(true);
  };
  const pick = (index: number) => {
    const item = options[index];
    if (!item || item.disabled) return;
    if (item.value !== value) onChange(item.value);
    close(true);
  };

  useLayoutEffect(() => {
    if (!show) return;
    // Controlled callers can open before an input event (e.g. restored panel state).
    if (!host) { setHost(trigger.current?.closest('dialog') || document.body); return; }
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, menuWidth), window.innerWidth - 24);
    const wanted = Math.min(menu.current?.scrollHeight || options.length * 48 + 10, 280);
    const below = Math.max(0, window.innerHeight - rect.bottom - 18);
    const above = Math.max(0, rect.top - 18);
    const down = placement === 'bottom'
      ? below >= Math.min(wanted, 140) || below >= above
      : above < Math.min(wanted, 140) && below > above;
    const height = Math.min(wanted, down ? below : above);
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: down ? rect.bottom + 6 : Math.max(12, rect.top - height - 6), width, maxHeight: height,
      transformOrigin: down ? 'top left' : 'bottom left' });
    list.current?.focus({ preventScroll: true });
  }, [show, host, menuWidth, placement, options.length]);

  useLayoutEffect(() => {
    if (!show || !host) return;
    const item = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    setPill(item ? { transform: `translateY(${item.offsetTop}px)`, height: item.offsetHeight, opacity: 1 } : { opacity: 0 });
    item?.scrollIntoView?.({ block: 'nearest' });
  }, [active, show, host]);

  useEffect(() => {
    if (!opened) return;
    // External disabling invalidates a focused popup; close its controlled state too.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (disabled || !options.some(item => !item.disabled)) { close(); return; }
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || (!root.current?.contains(target) && !menu.current?.contains(target))) close();
    };
    const layout = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node) || !menu.current?.contains(target)) close(Boolean(menu.current?.contains(document.activeElement)));
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', layout, true);
    window.addEventListener('resize', layout);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', layout, true);
      window.removeEventListener('resize', layout);
    };
  }, [opened, disabled, options, close]);

  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    const key = event.key;
    if (!show) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
        event.preventDefault(); open();
        if (key === 'Home' || key === 'End') setActive(key === 'Home' ? usable[0]! : usable.at(-1)!);
      }
      return;
    }
    if (key === 'Escape' || key === 'Tab') {
      if (key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      close(true); return;
    }
    if (key === 'Enter' || key === ' ') { event.preventDefault(); pick(active >= 0 ? active : selected); return; }
    const at = usable.indexOf(active);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      const next = key === 'Home' ? 0 : key === 'End' ? usable.length - 1 : Math.max(0, Math.min(usable.length - 1, at + (key === 'ArrowDown' ? 1 : -1)));
      setActive(usable[next]!);
    } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const text = now - search.current.at < 700 ? search.current.text + key : key;
      search.current = { text, at: now };
      const repeated = [...text].every(char => char === text[0]);
      const needle = (repeated ? key : text).toLocaleLowerCase();
      for (let step = repeated ? 1 : 0; step <= usable.length; step++) {
        const next = usable[(Math.max(0, at) + step) % usable.length]!;
        if (options[next]!.textValue.toLocaleLowerCase().startsWith(needle)) { setActive(next); break; }
      }
    }
  };
  return <div className={`glide-select ${className}`} ref={root}>
    <button type="button" role="combobox" ref={trigger} className="glide-select__trigger"
      aria-label={includeValueInLabel && selected >= 0 ? `${ariaLabel} ${options[selected]!.textValue}` : ariaLabel}
      aria-haspopup="listbox" aria-expanded={show} aria-controls={show ? `${id}-list` : undefined}
      disabled={disabled || !usable.length} onKeyDown={keyboard}
      onClick={() => show ? close(true) : open()}>
      <span className="glide-select__label">{options[selected]?.label ?? placeholder}</span>
      <ChevronDown className="glide-select__chevron" aria-hidden size={13}/>
    </button>
    {show && host && createPortal(<div ref={menu} style={position} className="glide-select__menu">
      <div ref={list} id={`${id}-list`} className="glide-select__list" role="listbox" aria-label={ariaLabel}
        tabIndex={-1} aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined} onKeyDown={keyboard}>
        <span className="glide-select__pill" style={pill} aria-hidden/>
        {options.map((item, index) => <div key={item.value} id={`${id}-${index}`} role="option"
          aria-selected={item.value === value} data-value={item.value} aria-disabled={item.disabled || undefined} data-index={index}
          className="glide-select__option" onClick={() => pick(index)}
          onPointerEnter={event => { if (event.pointerType !== 'touch' && !item.disabled) setActive(index); }}>
          <span className="glide-select__name">{item.label}{item.detail && <small>{item.detail}</small>}</span>
          <Check className="glide-select__check" aria-hidden data-on={item.value === value} size={14}/>
        </div>)}
      </div>
    </div>, host)}
  </div>;
}
