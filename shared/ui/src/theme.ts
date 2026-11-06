import { useCallback, useEffect, useState } from 'react';

/**
 * Appearance (Anirudh, 2026-11-06): light by default, dark when the user picks it; the system
 * theme is not followed. tokens.css switches on `<html data-theme="dark">`.
 * Kept in `localStorage` per browser profile, a per-viewer convenience: the extension pages share
 * one origin, the web app has its own. TODO(S4-12): save it with the account settings too.
 */
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'minutes.theme';

export function parseTheme(value: unknown): Theme {
  return value === 'dark' ? 'dark' : 'light';
}

function readTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    // Storage can be blocked; the default still renders.
    return 'light';
  }
}

export function applyTheme(theme: Theme, doc: Document = document): void {
  doc.documentElement.dataset.theme = theme;
}

/** Call before the first render so a dark page never flashes light. */
export function initTheme(): void {
  applyTheme(readTheme());
}

/** The current theme and a setter; follows changes made in other tabs or extension pages. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === THEME_KEY) setThemeState(parseTheme(event.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Not saved; the choice still applies until the page closes.
    }
  }, []);
  return [theme, setTheme];
}
