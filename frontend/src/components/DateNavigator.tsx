import { CalendarDays, ChevronLeft, ChevronRight, History } from "lucide-react";
import type { ReactNode } from "react";

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
}: DateNavigatorProps) {
  return (
    <div className="date-navigator">
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
      {historyContent}
    </div>
  );
}
