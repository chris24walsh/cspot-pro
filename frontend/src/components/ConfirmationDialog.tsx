import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useEscapeClose } from "./useEscapeClose";

type ConfirmationOptions = {
  cancelLabel?: string;
  confirmLabel?: string;
  message: ReactNode;
  title?: string;
  tone?: "danger" | "default";
};

type PendingConfirmation = Required<Pick<ConfirmationOptions, "confirmLabel" | "title" | "tone">> &
  Pick<ConfirmationOptions, "cancelLabel" | "message"> & {
    resolve: (confirmed: boolean) => void;
  };

export function useConfirmationDialog() {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback((options: ConfirmationOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({
        cancelLabel: options.cancelLabel ?? "Cancel",
        confirmLabel: options.confirmLabel ?? "Continue",
        message: options.message,
        resolve,
        title: options.title ?? "Confirm Action",
        tone: options.tone ?? "default",
      });
    });
  }, []);

  const close = useCallback(
    (confirmed: boolean) => {
      setPending((current) => {
        current?.resolve(confirmed);
        return null;
      });
    },
    [],
  );

  useEffect(() => {
    if (!pending) {
      return undefined;
    }

    cancelButtonRef.current?.focus();
    return undefined;
  }, [pending]);

  useEscapeClose(Boolean(pending), () => close(false));

  const dialog = pending ? (
    <div className="app-dialog-backdrop" role="presentation" onMouseDown={() => close(false)}>
      <section
        aria-labelledby="confirmation-dialog-title"
        aria-modal="true"
        className="app-dialog confirmation-dialog"
        onKeyDownCapture={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLButtonElement) {
            event.preventDefault();
          }
        }}
        onKeyUpCapture={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLButtonElement) {
            event.preventDefault();
            event.target.click();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div>
          <h2 id="confirmation-dialog-title">{pending.title}</h2>
          <p>{pending.message}</p>
        </div>
        <div className="app-dialog-actions">
          <button ref={cancelButtonRef} className="text-button" onClick={() => close(false)} type="button">
            {pending.cancelLabel}
          </button>
          <button
            className={pending.tone === "danger" ? "danger-button" : "primary-button"}
            onClick={() => close(true)}
            type="button"
          >
            {pending.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  ) : null;

  return { confirm, confirmationDialog: dialog };
}
