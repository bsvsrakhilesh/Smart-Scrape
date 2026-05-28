import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

type ToastKind = 'success' | 'error' | 'info' | 'warning';
type ToastInput =
  | string
  | {
      text: string;
      kind?: ToastKind;
      duration?: number;      // ms (default 3000)
      actionLabel?: string;   // optional CTA button label
      onAction?: () => void;  // optional CTA handler
      id?: number;            // custom id if needed
    };

type Toast = {
  id: number;
  kind: ToastKind;
  text: string;
  duration: number;
  actionLabel?: string;
  onAction?: () => void;
};

type ToastContextType = {
  /**
   * Backwards compatible:
   *   notify("Saved", "success")
   * Also supports advanced:
   *   notify({ text: "Undo delete", kind: "info", actionLabel: "Undo", onAction: ... })
   */
  notify: (input: ToastInput, kind?: ToastKind) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
};

const ICONS: Record<ToastKind, React.ReactNode> = {
  success: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M9 16.2l-3.5-3.6L4 14l5 5 11-11-1.5-1.4z" />
    </svg>
  ),
  error: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
    </svg>
  ),
  info: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M11 17h2v-6h-2v6zm0-8h2V7h-2v2zm1-7a10 10 0 1 0 0 20 10 10 0 1 0 0-20z" />
    </svg>
  ),
  warning: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
    </svg>
  ),
};

const KINDS: Record<
  ToastKind,
  { bg: string; text: string; ring: string; progress: string }
> = {
  success: {
    bg: 'bg-green-600 dark:bg-green-600',
    text: 'text-white',
    ring: 'ring-green-300/40',
    progress: 'bg-green-300',
  },
  error: {
    bg: 'bg-red-600 dark:bg-red-600',
    text: 'text-white',
    ring: 'ring-red-300/40',
    progress: 'bg-red-300',
  },
  info: {
    bg: 'bg-neutral-900 dark:bg-neutral-800',
    text: 'text-white',
    ring: 'ring-neutral-300/30',
    progress: 'bg-neutral-300',
  },
  warning: {
    bg: 'bg-yellow-600 dark:bg-yellow-600',
    text: 'text-white',
    ring: 'ring-yellow-300/40',
    progress: 'bg-yellow-300',
  },
};

// A single toast view with enter/exit animation, swipe-to-dismiss, and pause-on-hover
const ToastView: React.FC<{
  data: Toast;
  onClose: (id: number) => void;
  reducedMotion?: boolean;
}> = ({ data, onClose, reducedMotion }) => {
  const { id, kind, text, actionLabel, onAction, duration } = data;
  const [hover, setHover] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const startTsRef = useRef<number | null>(null);
  const remainingRef = useRef(duration);
  const rafRef = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const translateRef = useRef(0);

  // Progress bar tick
  useEffect(() => {
    if (reducedMotion) return; // keep at 100%
    const tick = (t: number) => {
      if (!startTsRef.current) startTsRef.current = t;
      const elapsed = t - startTsRef.current;
      const pct = Math.max(0, 100 - (elapsed / remainingRef.current) * 100);
      setProgress(pct);
      if (!hover && pct > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else if (pct <= 0) {
        // auto close
        setExiting(true);
        setTimeout(() => onClose(id), 160);
      }
    };
    if (!hover) rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [hover, id, onClose, reducedMotion]);

  // Pause/resume timer on hover
  const onMouseEnter = () => {
    setHover(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    // Recompute remaining
    if (startTsRef.current) {
      const elapsed = performance.now() - startTsRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
      startTsRef.current = null;
    }
  };

  const onMouseLeave = () => {
    setHover(false);
  };

  // Swipe-to-dismiss (touch)
  const onTouchStart: React.TouchEventHandler<HTMLDivElement> = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchMove: React.TouchEventHandler<HTMLDivElement> = (e) => {
    if (touchStartX.current == null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    translateRef.current = dx;
    (e.currentTarget.style as any).transform = `translateX(${dx}px)`;
    (e.currentTarget.style as any).opacity = `${Math.max(0, 1 - Math.abs(dx) / 160)}`;
  };
  const onTouchEnd: React.TouchEventHandler<HTMLDivElement> = (e) => {
    const dx = translateRef.current;
    if (Math.abs(dx) > 120) {
      setExiting(true);
      setTimeout(() => onClose(id), 120);
    } else {
      (e.currentTarget.style as any).transform = '';
      (e.currentTarget.style as any).opacity = '';
    }
    touchStartX.current = null;
    translateRef.current = 0;
  };

  // Keyboard dismiss (Del / Backspace)
  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      setExiting(true);
      setTimeout(() => onClose(id), 120);
    }
  };

  const palette = KINDS[kind];

  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className={[
        'pointer-events-auto',
        'rounded-2xl shadow-xl ring-1', palette.ring,
        'px-3 py-2 min-w-[260px] max-w-[360px]',
        'flex items-center gap-2',
        palette.bg, palette.text,
        'focus:outline-none focus:ring-2 focus:ring-white/50',
        'transition-all duration-200',
        exiting ? 'translate-y-2 opacity-0' : 'translate-y-0 opacity-100',
      ].join(' ')}
    >
      {/* Icon */}
      <div className="shrink-0 opacity-90">{ICONS[kind]}</div>

      {/* Text */}
      <div className="text-sm leading-snug min-w-0 flex-1">
        <div className="break-words">{text}</div>
      </div>

      {/* Action (optional) */}
      {actionLabel && onAction && (
        <button
          className="btn-ghost !px-2 !py-1 !text-xs !bg-white/10 hover:!bg-white/20 rounded-lg"
          onClick={() => {
            onAction();
            setExiting(true);
            setTimeout(() => onClose(id), 120);
          }}
        >
          {actionLabel}
        </button>
      )}

      {/* Close */}
      <button
        className="btn-ghost !px-2 !py-1 rounded-lg"
        aria-label="Dismiss"
        onClick={() => {
          setExiting(true);
          setTimeout(() => onClose(id), 120);
        }}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>

      {/* Progress bar */}
      {!reducedMotion && (
        <div className="absolute left-0 right-0 bottom-0 h-0.5 overflow-hidden rounded-b-2xl">
          <div
            className={['h-full', palette.progress, 'transition-[width] duration-100'].join(' ')}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode; maxToasts?: number }> = ({
  children,
  maxToasts = 4,
}) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prefersReducedMotion = usePrefersReducedMotion();

  const close = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback<ToastContextType['notify']>((input, kindArg) => {
    // Normalize inputs: string or object
    const base: Omit<Toast, 'id'> =
      typeof input === 'string'
        ? { text: input, kind: kindArg || 'info', duration: 3000 }
        : {
            text: input.text,
            kind: input.kind || kindArg || 'info',
            duration: Math.max(1200, input.duration ?? 3000),
            actionLabel: input.actionLabel,
            onAction: input.onAction,
          };

    const id = typeof input === 'object' && input.id ? input.id : Date.now() + Math.random();
    const next: Toast = { id, ...base };

    setToasts((prev) => {
      const arr = [next, ...prev];
      return arr.slice(0, maxToasts); // cap the stack
    });
  }, [maxToasts]);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Container */}
      <div
        className="fixed bottom-4 right-4 z-[9999] flex flex-col items-end gap-2 pointer-events-none"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <ToastView
            key={t.id}
            data={t}
            onClose={close}
            reducedMotion={prefersReducedMotion}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

/** Hook: respects user's reduced motion preference */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(!!mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}
