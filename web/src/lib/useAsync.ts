import { useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  error: boolean;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads data for a screen and re-runs when `deps` change; stale results are dropped.
 * TODO(S4-14): a query cache keyed by workspace and ID (DESIGN §18) once the real API exists.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data: T | undefined; error: boolean; loading: boolean }>({
    data: undefined,
    error: false,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  // The latest `load` is read at run time; `deps` decide when to run (they are its inputs).
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let current = true;
    setState((s) => ({ ...s, loading: true, error: false }));
    loadRef.current().then(
      (data) => current && setState({ data, error: false, loading: false }),
      () => current && setState({ data: undefined, error: true, loading: false }),
    );
    return () => {
      current = false;
    };
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}
