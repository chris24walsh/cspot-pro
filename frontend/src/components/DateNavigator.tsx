import { CalendarDays, ChevronLeft, ChevronRight, History, Layers3, UserRound } from "lucide-react";
import type { ReactNode } from "react";

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
  serviceTypeLabel?: string;
  serviceTypeExpanded?: boolean;
  serviceTypeContent?: ReactNode;
  onServiceType?: () => void;
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
  serviceTypeLabel,
  serviceTypeExpanded = false,
  serviceTypeContent,
  onServiceType,
  assignmentLabel,
  assignmentInitial,
  assignmentTitle = "Leader",
  onAssignment,
  assignmentDisabled = false,
}: DateNavigatorProps) {
  return (
    <div className={`date-navigator ${onServiceType ? "has-service-type" : ""} ${onAssignment ? "has-assignment" : ""}`}>
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
      {onServiceType ? (
        <button aria-expanded={serviceTypeExpanded} aria-label="Choose service type" className="text-button date-navigator-service-type" onClick={onServiceType} title="Choose the type used when creating a service" type="button">
          <Layers3 size={14} aria-hidden="true" />
          <span>{serviceTypeLabel || "Service type"}</span>
        </button>
      ) : null}
      <button
        aria-expanded={historyExpanded}
        aria-label={historyLabel}
        className="section-icon-button date-navigator-history"
        disabled={historyDisabled}
        onClick={onHistory}
        title={historyLabel}
        type="button"
      >
        <History size={14} aria-hidden="true" />
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
      {historyContent}
      {serviceTypeContent}
    </div>
  );
}
