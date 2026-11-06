import { useEffect } from 'react';

import { usePipelineStore } from '../store.js';

/** How long a success toast stays; error toasts stay longer so validation text can be read. */
export const TOAST_MS = 3000;
export const ERROR_TOAST_MS = 8000;

/** Transient message for save/load outcomes (Req 10.6). */
export function Toast() {
  const toast = usePipelineStore((s) => s.toast);
  const dismissToast = usePipelineStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, toast.kind === 'error' ? ERROR_TOAST_MS : TOAST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toast, dismissToast]);

  if (!toast) return null;
  return (
    <div
      className={`toast toast-${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onClick={dismissToast}
    >
      {toast.message}
    </div>
  );
}
