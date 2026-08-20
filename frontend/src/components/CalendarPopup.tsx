import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ReactNode, useMemo, useRef, useState, type WheelEvent } from "react";
import { useEscapeClose } from "./useEscapeClose";

interface CalendarDay {
  date: string;
  muted?: boolean;
  className?: string;
}

interface CalendarPopupProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  calendarMonth: string;
  onMonthChange: (month: string) => void;
  calendarDays: CalendarDay[];
  selectedDate: string;
  onDateSelect: (date: string) => void;
  dayContent: (day: CalendarDay) => ReactNode;
  calendarAction?: ReactNode;
  footerContent?: ReactNode;
  actionButtons?: ReactNode;
}

export function shiftCalendarMonth(calendarMonth: string, offset: -1 | 1) {
  const [year, month] = calendarMonth.split("-").map(Number);
  const shifted = new Date(year, month - 1 + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

export function visibleCalendarDays(calendarDays: CalendarDay[], mode: "sundays" | "all") {
  if (mode === "all") return calendarDays;
  return calendarDays.filter(
    (day) => !day.muted && new Date(`${day.date}T12:00:00`).getDay() === 0,
  );
}

export function CalendarPopup({
  isOpen,
  onClose,
  title,
  eyebrow,
  calendarMonth,
  onMonthChange,
  calendarDays,
  selectedDate,
  onDateSelect,
  dayContent,
  calendarAction,
  footerContent,
  actionButtons,
}: CalendarPopupProps) {
  const [viewMode, setViewMode] = useState<"sundays" | "all">("sundays");
  const wheelDistanceRef = useRef(0);
  const wheelResetRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  useEscapeClose(isOpen, onClose);
  const displayedDays = useMemo(
    () => visibleCalendarDays(calendarDays, viewMode),
    [calendarDays, viewMode],
  );

  if (!isOpen) {
    return null;
  }

  function moveMonth(offset: -1 | 1) {
    onMonthChange(shiftCalendarMonth(calendarMonth, offset));
  }

  function handleCalendarWheel(event: WheelEvent<HTMLDivElement>) {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    wheelDistanceRef.current += event.deltaY;
    if (wheelResetRef.current !== null) window.clearTimeout(wheelResetRef.current);
    wheelResetRef.current = window.setTimeout(() => { wheelDistanceRef.current = 0; }, 180);
    if (Math.abs(wheelDistanceRef.current) < 45) return;
    moveMonth(wheelDistanceRef.current > 0 ? 1 : -1);
    wheelDistanceRef.current = 0;
  }

  return (
    <div className="app-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`app-dialog app-dialog-wide service-picker-dialog calendar-view-${viewMode}`}
        aria-label={eyebrow ? `${eyebrow} ${title}` : title}
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
        <div className={`service-picker-grid calendar-popup-grid ${footerContent || actionButtons ? "" : "is-calendar-only"}`}>
          <section className="service-picker-panel service-calendar-panel">
            <div className="service-calendar-heading">
              <div className="calendar-month-navigation">
                <button aria-label="Previous month" className="section-icon-button" onClick={() => moveMonth(-1)} type="button">
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <strong>
                  {new Date(`${calendarMonth}-01T12:00:00`).toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  })}
                </strong>
                <button aria-label="Next month" className="section-icon-button" onClick={() => moveMonth(1)} type="button">
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="calendar-view-toggle" aria-label="Calendar days" role="group">
                <button aria-pressed={viewMode === "sundays"} className={viewMode === "sundays" ? "active" : ""} onClick={() => setViewMode("sundays")} type="button">
                  Sundays
                </button>
                <button aria-pressed={viewMode === "all"} className={viewMode === "all" ? "active" : ""} onClick={() => setViewMode("all")} type="button">
                  All days
                </button>
              </div>
              <button aria-label="Close calendar" className="section-icon-button calendar-popup-close" onClick={onClose} type="button">
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div
              className="service-calendar-grid is-scrollable"
              aria-label="Calendar date picker"
              onTouchEnd={(event) => {
                const start = touchStartYRef.current;
                touchStartYRef.current = null;
                if (start === null) return;
                const distance = start - event.changedTouches[0].clientY;
                if (Math.abs(distance) >= 42) moveMonth(distance > 0 ? 1 : -1);
              }}
              onTouchStart={(event) => { touchStartYRef.current = event.touches[0].clientY; }}
              onWheel={handleCalendarWheel}
            >
              {(viewMode === "sundays" ? ["Sunday"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).map((day) => (
                <span className="service-calendar-weekday" key={day}>
                  {day}
                </span>
              ))}
              {displayedDays.map((day) => (
                <button
                  className={`service-calendar-day ${day.muted ? "is-muted" : ""} ${
                    selectedDate === day.date ? "is-selected" : ""
                  } ${day.className || ""}`}
                  key={day.date}
                  onClick={() => onDateSelect(day.date)}
                  type="button"
                >
                  {dayContent(day)}
                </button>
              ))}
            </div>

            {calendarAction ? <div className="calendar-popup-bottom-action">{calendarAction}</div> : null}
          </section>

          {footerContent || actionButtons ? <section className="service-picker-panel service-buttons-panel">
            {footerContent ? <div className="calendar-popup-footer">{footerContent}</div> : null}

            <div className="service-picker-buttons">
              {actionButtons}
            </div>
          </section> : null}
        </div>
      </section>
    </div>
  );
}
