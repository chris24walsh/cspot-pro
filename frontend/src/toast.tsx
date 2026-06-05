import { useEffect, useState } from "react";

const TOAST_EVENT = "cspot:toast";

interface ToastEventDetail {
  message: string;
}

interface ToastItem {
  id: number;
  message: string;
}

export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent<ToastEventDetail>(TOAST_EVENT, { detail: { message } }));
}

export function ToastViewport() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    function handleToast(event: Event) {
      const detail = (event as CustomEvent<ToastEventDetail>).detail;
      const message = detail?.message?.trim();
      if (!message) {
        return;
      }

      const id = Date.now() + Math.random();
      setToasts((current) => [...current.slice(-2), { id, message }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 2400);
    }

    window.addEventListener(TOAST_EVENT, handleToast);
    return () => window.removeEventListener(TOAST_EVENT, handleToast);
  }, []);

  if (!toasts.length) {
    return null;
  }

  return (
    <div className="toast-viewport" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className="screen-toast" key={toast.id}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
