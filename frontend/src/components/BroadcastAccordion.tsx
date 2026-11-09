import type { ReactNode, SyntheticEvent } from "react";

/** Native details keeps keyboard support, including on older mobile browsers. */
export function contractOtherBroadcastControls(event: SyntheticEvent<HTMLDetailsElement>) {
  const opened = event.currentTarget;
  if (event.target !== opened) return;
  if (!(opened instanceof HTMLDetailsElement) || !opened.open) return;
  if (!opened.matches(".broadcast-control-category, .broadcast-config-accordion")) return;
  opened.closest(".service-broadcast-admin-live-controls, .broadcast-settings")?.querySelectorAll<HTMLDetailsElement>(".broadcast-control-category, .broadcast-config-accordion").forEach(details => {
    if (details !== opened) details.open = false;
  });
}

export function BroadcastAccordionSummary({ children, status, statusLabel = status }: {
  children: ReactNode;
  status: string;
  statusLabel?: string;
}) {
  return <summary><span className="broadcast-accordion-heading"><span>{children}</span><small aria-label={statusLabel} title={statusLabel}>{status}</small></span></summary>;
}
