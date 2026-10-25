import { CalendarDays, ChevronLeft, ChevronRight, History, UserRound } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function formatNavigatorDate(value: string | null | undefined) {
  if (!value) {
    return "Choose date";
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? "Choose date"
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

interface DateNavigatorProps {
  label: string;
  pickerLabel: string;
  previousLabel: string;
  nextLabel: string;
  historyLabel: string;
  onOpenPicker: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onHistory: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  historyDisabled?: boolean;
  pickerDisabled?: boolean;
  historyExpanded?: boolean;
  historyContent?: ReactNode;
  assignmentLabel?: string;
  assignmentInitial?: string | null;
  assignmentTitle?: string;
  onAssignment?: () => void;
  assignmentDisabled?: boolean;
}

export function DateNavigator({
  label,
  pickerLabel,
  previousLabel,
  nextLabel,
  historyLabel,
  onOpenPicker,
  onPrevious,
  onNext,
  onHistory,
  previousDisabled = false,
  nextDisabled = false,
  historyDisabled = false,
  pickerDisabled = false,
  historyExpanded = false,
  historyContent,
  assignmentLabel,
  assignmentInitial,
  assignmentTitle = "Leader",
  onAssignment,
  assignmentDisabled = false,
}: DateNavigatorProps) {
  const historyButton = useRef<HTMLButtonElement>(null);
  const historyLayer = useRef<HTMLDivElement>(null);
  const [historyPosition, setHistoryPosition] = useState({ left: 12, top: 0, maxHeight: 430 });

  useLayoutEffect(() => {
    if (!historyContent) return;
    const reposition = () => {
      const button = historyButton.current;
      const layer = historyLayer.current;
      if (!button || !layer) return;
      const anchor = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const left = Math.max(viewportLeft + 12, Math.min(anchor.right - layer.offsetWidth, viewportLeft + viewportWidth - layer.offsetWidth - 12));
      const top = Math.max(viewportTop + 12, Math.min(anchor.bottom + 6, viewportTop + viewportHeight - Math.min(180, layer.offsetHeight) - 12));
      const maxHeight = Math.max(0, Math.min(430, viewportTop + viewportHeight - top - 12));
      setHistoryPosition((current) => current.left === left && current.top === top && current.maxHeight === maxHeight ? current : { left, top, maxHeight });
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    if (historyButton.current) observer.observe(historyButton.current);
    if (historyLayer.current) observer.observe(historyLayer.current);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [Boolean(historyContent)]);

  return (
    <div className={`date-navigator ${onAssignment ? "has-assignment" : ""}`}>
      <button aria-label={previousLabel} className="section-icon-button" disabled={previousDisabled} onClick={onPrevious} title={previousLabel} type="button">
        <ChevronLeft size={14} aria-hidden="true" />
      </button>
      <button className="text-button date-navigator-date" disabled={pickerDisabled} onClick={onOpenPicker} title={pickerLabel} type="button">
        <CalendarDays size={14} aria-hidden="true" />
        <span>{label}</span>
      </button>
      <button aria-label={nextLabel} className="section-icon-button" disabled={nextDisabled} onClick={onNext} title={nextLabel} type="button">
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      <button
        ref={historyButton}
        aria-expanded={historyExpanded}
        aria-label={historyLabel}
        className="section-icon-button date-navigator-history"
        disabled={historyDisabled}
        onClick={onHistory}
        title={historyLabel}
        type="button"
      >
        <History size={14} aria-hidden="true" />
        <span className="date-navigator-history-label">History</span>
      </button>
      {onAssignment ? (
        <button
          aria-label={assignmentTitle}
          className="text-button date-navigator-assignment"
          disabled={assignmentDisabled}
          onClick={onAssignment}
          title={assignmentTitle}
          type="button"
        >
          <span className="date-navigator-assignment-mobile" aria-hidden="true">
            {assignmentInitial ? assignmentInitial.slice(0, 1).toUpperCase() : <UserRound size={13} />}
          </span>
          <UserRound className="date-navigator-assignment-icon" size={13} aria-hidden="true" />
          <span className="date-navigator-assignment-label">{assignmentLabel || "Leader"}</span>
        </button>
      ) : null}
      {historyContent ? createPortal(
        <div ref={historyLayer} className="date-navigator-history-layer" style={{ left: historyPosition.left, top: historyPosition.top, maxHeight: historyPosition.maxHeight }}>
          {historyContent}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
