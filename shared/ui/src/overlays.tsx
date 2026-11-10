import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { Icon } from './Icon.tsx';
import { Banner, Button } from './ui.tsx';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

/**
 * DESIGN §6.9 / §6.10 / §20: Tab stays inside the dialog, the first control (or `initial`) gets
 * focus, and focus goes back to whatever opened it when it closes.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  initial?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const root = ref.current;
    if (root === null) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initial?.current ?? focusables(root)[0] ?? root).focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables(root);
      const first = items[0];
      const last = items.at(-1);
      if (first === undefined || last === undefined) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      opener?.focus();
    };
    // Runs once per opening; the refs are stable.
  }, []);
}

/** DESIGN §6.9: scrim + glass panel, serif title and round close; `Esc` and the scrim close it. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref);
  return (
    <div className="scrim scrim-sheet" role="presentation" onClick={onClose}>
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {title}
          </h2>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {children}
        {footer !== undefined && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * DESIGN §6.10: a destructive confirmation. Cancel and the action are equal; focus starts on
 * Cancel. While the action runs nothing closes it; a failure shows `failedText` and stays open.
 */
export function AlertDialog({
  title,
  body,
  confirmLabel,
  failedText,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  failedText: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useFocusTrap(ref, cancel);
  return (
    <div className="scrim" role="presentation" onClick={busy ? undefined : onCancel}>
      <div
        ref={ref}
        className="alert"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onCancel();
        }}
      >
        <h2 id={titleId} className="alert-title">
          {title}
        </h2>
        <p id={bodyId} className="alert-body">
          {body}
        </p>
        {failed && <Banner tone="error">{failedText}</Banner>}
        <div className="alert-actions">
          <Button ref={cancel} disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setFailed(false);
              onConfirm().catch(() => {
                setFailed(true);
                setBusy(false);
              });
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface MenuEntry {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** A radio-style choice (e.g. the current template): shows a check. */
  checked?: boolean;
  disabled?: boolean;
  /** A separator line above this item. */
  separated?: boolean;
}

/**
 * DESIGN §6.8: opens under its trigger; ↑/↓/Home/End move focus, `Esc` and an outside click
 * close it and return focus to the trigger.
 */
export function Menu({
  trigger,
  label,
  items,
  helper,
  disabled,
  round,
  inline,
}: {
  /** Button content (icon and/or text). */
  trigger: ReactNode;
  /** Accessible name of the trigger (required when it is an icon). */
  label: string;
  items: readonly MenuEntry[];
  helper?: string;
  disabled?: boolean;
  /** A 36 px round icon button (DESIGN §6.1 icon). */
  round?: boolean;
  /** An inline trigger (e.g. an owner name inside a row) instead of a button-looking one. */
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const radio = items.some((i) => i.checked !== undefined);

  useEffect(() => {
    if (!open) return undefined;
    list.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus();
    const outside = (e: MouseEvent) => {
      if (wrap.current !== null && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const entries = [
      ...(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? []),
    ];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      entries[(to + entries.length) % entries.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(entries.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') close(false);
  };

  return (
    <div className="more" ref={wrap}>
      <Button
        ref={button}
        className={round === true ? 'icon-btn round' : inline === true ? 'menu-inline' : undefined}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </Button>
      {open && (
        <div className="menu" role="menu" aria-label={label} ref={list} onKeyDown={onKeyDown}>
          {helper !== undefined && <p className="menu-helper">{helper}</p>}
          {items.map((item, index) => (
            // Index key: labels repeat (two participants with the same name).
            <div key={`${index}-${item.label}`}>
              {item.separated === true && <hr className="menu-sep" />}
              <button
                type="button"
                role={radio ? 'menuitemradio' : 'menuitem'}
                aria-checked={radio ? item.checked === true : undefined}
                className={`menu-item ${item.danger === true ? 'menu-danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                <span>{item.label}</span>
                {item.checked === true && <Icon name="check" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
