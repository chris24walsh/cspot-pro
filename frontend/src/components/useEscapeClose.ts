import { useEffect, useRef } from "react";

interface EscapeHandler {
  id: symbol;
  priority: number;
}

const escapeHandlers: EscapeHandler[] = [];

export function useEscapeClose(active: boolean, onClose: () => void, priority = 0) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return undefined;

    const id = Symbol("escape-close");
    escapeHandlers.push({ id, priority });

    function handleKeyDown(event: KeyboardEvent) {
      const topHandler = escapeHandlers.reduce<EscapeHandler | undefined>((top, candidate) => (
        !top || candidate.priority >= top.priority ? candidate : top
      ), undefined);
      if (event.key !== "Escape" || topHandler?.id !== id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      const index = escapeHandlers.findIndex((candidate) => candidate.id === id);
      if (index >= 0) escapeHandlers.splice(index, 1);
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [active, priority]);
}
