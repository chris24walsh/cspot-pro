import { useEffect, useRef } from "react";

import { getChangeRevision } from "./api";

export const DURABLE_CHANGE_EVENT = "cspot-pro:durable-change";

const ACTIVE_INTERVAL_MS = 4000;
const HIDDEN_INTERVAL_MS = 30000;
const MAX_BACKOFF_MS = 60000;

export function durablePollingDelay(failures: number, hidden: boolean) {
  if (failures > 0) return Math.min(ACTIVE_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
  return hidden ? HIDDEN_INTERVAL_MS : ACTIVE_INTERVAL_MS;
}

export function useDurableChangePolling(enabled: boolean) {
  const lastRevisionRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let timer: number | undefined;
    let failures = 0;

    const schedule = (delay: number) => {
      if (!cancelled) timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      try {
        const revision = await getChangeRevision();
        if (cancelled) return;
        const previous = lastRevisionRef.current;
        lastRevisionRef.current = revision;
        failures = 0;
        if (previous !== null && previous !== revision) {
          window.dispatchEvent(new CustomEvent(DURABLE_CHANGE_EVENT, { detail: revision }));
        }
        schedule(durablePollingDelay(0, document.hidden));
      } catch {
        failures += 1;
        schedule(durablePollingDelay(failures, document.hidden));
      }
    };

    const handleVisibility = () => {
      if (document.hidden) return;
      if (timer !== undefined) window.clearTimeout(timer);
      schedule(0);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    schedule(0);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled]);
}

export function useDurableChange(callback: () => void, enabled = true) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return undefined;
    const handleChange = () => callbackRef.current();
    window.addEventListener(DURABLE_CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(DURABLE_CHANGE_EVENT, handleChange);
  }, [enabled]);
}
