import { useEffect, useRef } from "react";

const escapeHandlers: symbol[] = [];

export function useEscapeClose(active: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return undefined;

    const id = Symbol("escape-close");
    escapeHandlers.push(id);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || escapeHandlers[escapeHandlers.length - 1] !== id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      const index = escapeHandlers.indexOf(id);
      if (index >= 0) escapeHandlers.splice(index, 1);
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [active]);
}
