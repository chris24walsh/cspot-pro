import { ChevronLeft, ChevronRight } from "lucide-react";
import { ReactNode, useRef, type WheelEvent } from "react";

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
  footerContent?: ReactNode;
  actionButtons?: ReactNode;
}

export function shiftCalendarMonth(calendarMonth: string, offset: -1 | 1) {
  const [year, month] = calendarMonth.split("-").map(Number);
  const shifted = new Date(year, month - 1 + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
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
  footerContent,
  actionButtons,
}: CalendarPopupProps) {
  const wheelDistanceRef = useRef(0);
  const wheelResetRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

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
        className="app-dialog app-dialog-wide service-picker-dialog"
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
        <div className="service-picker-grid calendar-popup-grid">
          <section className="service-picker-panel service-calendar-panel">
            <div className="service-calendar-heading">
              <button
                aria-label="Previous month"
                className="text-button"
                onClick={() => moveMonth(-1)}
                type="button"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <strong>
                {new Date(`${calendarMonth}-01T12:00:00`).toLocaleDateString(undefined, {
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              <button
                aria-label="Next month"
                className="text-button"
                onClick={() => moveMonth(1)}
                type="button"
              >
                <ChevronRight size={16} aria-hidden="true" />
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
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <span className="service-calendar-weekday" key={day}>
                  {day}
                </span>
              ))}
              {calendarDays.map((day) => (
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

          </section>

          <section className="service-picker-panel service-buttons-panel">
            {footerContent ? <div className="calendar-popup-footer">{footerContent}</div> : null}

            <div className="service-picker-buttons">
              {actionButtons}
              <button className="text-button" onClick={onClose} type="button">
                Close
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
