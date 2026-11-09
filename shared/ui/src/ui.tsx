import type { Meeting } from '@meetyou/contracts';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  KeyboardEvent,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from 'react';

import { Icon } from './Icon.tsx';

/** DESIGN §6.1 */
export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** React 19 passes refs as props (focus management in dialogs and menus). */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...rest} />
  );
}

/** DESIGN §6.11 */
export function Card({
  children,
  highlight = false,
  className = '',
}: {
  children: ReactNode;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${highlight ? 'card-highlight' : ''} ${className}`}>
      {children}
    </section>
  );
}

const STATUS_TEXT: Record<Meeting['status'], string> = {
  recording: 'Recording',
  processing: 'Writing notes…',
  ready: 'Ready',
  updated: 'Updated',
  failed: 'Failed',
  too_short: 'Too short',
};

/** DESIGN §6.12, colours §5.1. Status is always text as well as colour (UI-02). */
export function StatusPill({ status }: { status: Meeting['status'] }) {
  return (
    <span className={`pill pill-${status}`}>
      {status === 'recording' && <span className="rec-dot" aria-hidden />}
      {STATUS_TEXT[status]}
    </span>
  );
}

/** DESIGN §6.3 single-select filter chips. */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`chip ${o.value === value ? 'chip-on' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * DESIGN §6.2 / §20: a radio group. One stop in the tab order (the selected option); arrow keys
 * move the selection, as in a native radio group.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0 || disabled) return;
    e.preventDefault();
    const at = options.findIndex((o) => o.value === value);
    const next = options[(at + step + options.length) % options.length];
    if (next === undefined) return;
    onChange(next.value);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons[options.indexOf(next)]?.focus();
  };
  return (
    <div
      className={`segmented ${disabled ? 'segmented-disabled' : ''}`}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          disabled={disabled}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** DESIGN §6.4: 50×30 in settings, 46×28 (`compact`) in sheets and the side panel. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  compact = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch ${compact ? 'switch-compact' : ''} ${checked ? 'switch-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

/** DESIGN §6.5 */
export function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? 'Mark as not done' : 'Mark as done'}
      className={`checkbox ${checked ? 'checkbox-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      {checked && <Icon name="check" size={14} />}
    </button>
  );
}

/** DESIGN §6.6 search field with clear button. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="search">
      <Icon name="search" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
      {value !== '' && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          onClick={() => onChange('')}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

/** DESIGN §6.17: no shimmer (works under reduced motion). */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

/** DESIGN §6.15: icon, text, optional action and dismiss. */
export function Banner({
  tone,
  children,
  action,
  onDismiss,
}: {
  tone: 'info' | 'warning' | 'error';
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone !== 'info' && <Icon name="alert-triangle" />}
      <div className="banner-text">{children}</div>
      {action}
      {onDismiss !== undefined && (
        <button type="button" className="banner-dismiss" aria-label="Dismiss" onClick={onDismiss}>
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

/** DESIGN §6.14: replaces the citation chip on an item the checks could not ground. */
export function UnverifiedChip() {
  return <span className="unverified-chip">⚠ Not found in the transcript</span>;
}

/** DESIGN §6.6: 44 px (36 compact), 1 px control-line border, focus ring as buttons. */
export function TextInput({
  compact = false,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { compact?: boolean; ref?: Ref<HTMLInputElement> }) {
  return <input className={`input ${compact ? 'input-compact' : ''} ${className}`} {...rest} />;
}

export function TextArea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea className={`input textarea ${className}`} {...rest} />;
}

/** DESIGN §6.13: numbered chip after AI text; min 24×24 hit area via CSS. */
export function CitationChip({
  n,
  selected,
  onSelect,
}: {
  n: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`cite ${selected ? 'cite-on' : ''}`}
      aria-label={`Show source ${n}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {n}
    </button>
  );
}
