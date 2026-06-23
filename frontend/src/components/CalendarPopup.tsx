import { ChevronLeft, ChevronRight } from "lucide-react";
import { ReactNode } from "react";

interface CalendarDay {
  date: string;
  muted?: boolean;
  className?: string;
}

interface LeaderColor {
  name: string;
  className: string;
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
  actionButtons: ReactNode;
  leaderColors?: LeaderColor[];
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
  leaderColors,
}: CalendarPopupProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="app-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="app-dialog app-dialog-wide service-picker-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="section-heading">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2>{title}</h2>
          </div>
          <button className="text-button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="service-picker-grid calendar-popup-grid">
          <section className="service-picker-panel service-calendar-panel">
            <div className="service-calendar-heading">
              <button
                aria-label="Previous month"
                className="text-button"
                onClick={() => {
                  const [year, month] = calendarMonth.split("-").map(Number);
                  const prev = new Date(year, month - 2, 1);
                  onMonthChange(
                    `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`
                  );
                }}
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
                onClick={() => {
                  const [year, month] = calendarMonth.split("-").map(Number);
                  const next = new Date(year, month, 1);
                  onMonthChange(
                    `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`
                  );
                }}
                type="button"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="service-calendar-grid" aria-label="Calendar date picker">
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

            {leaderColors ? (
              <div className="calendar-popup-legend">
                {leaderColors.map((color) => (
                  <div className="calendar-legend-item" key={color.name}>
                    <span className={`calendar-legend-color ${color.className}`} />
                    <span>{color.name}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="service-picker-panel service-buttons-panel">
            {footerContent ? <div className="calendar-popup-footer">{footerContent}</div> : null}

            <div className="service-picker-buttons">{actionButtons}</div>
          </section>
        </div>
      </section>
    </div>
  );
}
