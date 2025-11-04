import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

type ConfirmOpts = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type ConfirmState = ConfirmOpts & {
  open: boolean;
  resolve?: (ok: boolean) => void;
  busy?: boolean;
};

type ConfirmContextType = {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  setBusy: (busy: boolean) => void;
};

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx;
};

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: '',
    description: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    danger: false,
    busy: false,
  });

  const confirm = useCallback((opts: ConfirmOpts) => {
    return new Promise<boolean>((resolve) => {
      setState({
        open: true,
        title: opts.title,
        description: opts.description,
        confirmText: opts.confirmText ?? 'Confirm',
        cancelText: opts.cancelText ?? 'Cancel',
        danger: !!opts.danger,
        busy: false,
        resolve,
      });
    });
  }, []);

  const setBusy = useCallback((busy: boolean) => {
    setState((s) => ({ ...s, busy }));
  }, []);

  const onClose = useCallback((ok: boolean) => {
    setState((s) => {
      s.resolve?.(ok);
      return { ...s, open: false, busy: false, resolve: undefined };
    });
  }, []);

  const value = useMemo(() => ({ confirm, setBusy }), [confirm, setBusy]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {state.open &&
        createPortal(
          <div className="fixed inset-0 z-[9998] flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40" onClick={() => !state.busy && onClose(false)} />
            {/* Dialog */}
            <div
              role="dialog"
              aria-modal="true"
              className="relative z-[9999] w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-gray-200 dark:border-gray-800 p-4"
            >
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div
                  className={
                    'mt-1 inline-flex h-10 w-10 items-center justify-center rounded-xl ' +
                    (state.danger ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600')
                  }
                >
                  {/* Exclamation icon */}
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2Zm1 15h-2v-2h2Zm0-4h-2V7h2Z"
                    />
                  </svg>
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold">{state.title}</h3>
                  {state.description && (
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{state.description}</p>
                  )}
                </div>
              </div>

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                  onClick={() => onClose(false)}
                  disabled={state.busy}
                >
                  {state.cancelText}
                </button>
                <button
                  className={[
                    'px-3 py-1.5 rounded-lg text-sm text-white disabled:opacity-50 inline-flex items-center gap-2',
                    state.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700',
                  ].join(' ')}
                  onClick={() => onClose(true)}
                  disabled={state.busy}
                >
                  {state.busy && (
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
                  )}
                  {state.confirmText}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </ConfirmContext.Provider>
  );
};
