import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLanguage } from "../language";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Returns the toast API, or throws when used outside the provider. */
export function useToasts(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToasts must be used inside <ToastsProvider>");
  return api;
}

const TOAST_TIMEOUT_MS = 5000;
const MAX_VISIBLE = 3;

export function ToastsProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-(MAX_VISIBLE - 1)), { id, kind, message }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, TOAST_TIMEOUT_MS);
  }, []);

  const api = useMemo<ToastApi>(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <span className="toast-message">{toast.message}</span>
            <button
              type="button"
              className="toast-dismiss"
              aria-label={t("Dismiss notification")}
              onClick={() => setToasts((current) => current.filter((x) => x.id !== toast.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
