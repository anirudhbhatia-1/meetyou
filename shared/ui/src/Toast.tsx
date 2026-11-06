import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { Button } from './ui.tsx';

interface ToastMessage {
  message: string;
  undo?: () => void;
}

const ToastContext = createContext<(toast: ToastMessage) => void>(() => undefined);

/** DESIGN §6.7: one glass toast at a time; 2.8 s, or 5 s with Undo. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const show = useCallback((next: ToastMessage) => setToast(next), []);
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), toast.undo === undefined ? 2800 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-slot" role="status" aria-live="polite">
        {toast !== null && (
          <div className="toast glass">
            <span>{toast.message}</span>
            {toast.undo !== undefined && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  toast.undo?.();
                  setToast(null);
                }}
              >
                Undo
              </Button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (toast: ToastMessage) => void {
  return useContext(ToastContext);
}
