import { X } from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";

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
  allDays: CalendarDay[];
  sundayDays: CalendarDay[];
  selectedDate: string;
  onDateSelect: (date: string) => void;
  dayContent: (day: CalendarDay) => ReactNode;
  calendarAction?: ReactNode;
  footerContent?: ReactNode;
  actionButtons?: ReactNode;
}

export function visibleCalendarDays(
  allDays: CalendarDay[],
  mode: "sundays" | "all",
  sundayDays: CalendarDay[],
) {
  return mode === "all" ? allDays : sundayDays;
}

export function groupCalendarDays(calendarDays: CalendarDay[]) {
  const groups: Array<{ key: string; days: CalendarDay[] }> = [];
  for (const day of calendarDays) {
    const key = day.date.slice(0, 7);
    const current = groups[groups.length - 1];
    if (current?.key === key) {
      current.days.push(day);
    } else {
      groups.push({ key, days: [day] });
    }
  }
  return groups;
}

function monthLabel(monthInput: string) {
  return new Date(`${monthInput}-01T12:00:00`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function CalendarPopup({
  isOpen,
  onClose,
  title,
  eyebrow,
  allDays,
  sundayDays,
  selectedDate,
  onDateSelect,
  dayContent,
  calendarAction,
  footerContent,
  actionButtons,
}: CalendarPopupProps) {
  const [viewMode, setViewMode] = useState<"sundays" | "all">("sundays");
  const calendarTimelineRef = useRef<HTMLDivElement | null>(null);
  useEscapeClose(isOpen, onClose);
  const displayedDays = useMemo(
    () => visibleCalendarDays(allDays, viewMode, sundayDays),
    [allDays, sundayDays, viewMode],
  );
  const displayedGroups = useMemo(() => groupCalendarDays(displayedDays), [displayedDays]);
  const timelineStart = displayedDays[0]?.date;
  const timelineEnd = displayedDays[displayedDays.length - 1]?.date;

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const timeline = calendarTimelineRef.current;
      if (!timeline) return;
      const dates = Array.from(timeline.querySelectorAll<HTMLElement>("[data-calendar-date]"));
      const selected = dates.find((element) => element.dataset.calendarDate === selectedDate);
      const next = dates.find((element) => (element.dataset.calendarDate ?? "") >= selectedDate);
      const target = selected ?? next ?? dates[0];
      if (!target) return;
      const targetTop = target.getBoundingClientRect().top - timeline.getBoundingClientRect().top + timeline.scrollTop;
      timeline.scrollTop = Math.max(0, targetTop - timeline.clientHeight / 3);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, selectedDate, timelineEnd, timelineStart, viewMode]);

  if (!isOpen) return null;

  function renderCalendarDay(day: CalendarDay) {
    const date = new Date(`${day.date}T12:00:00`);
    return (
      <button
        aria-label={date.toLocaleDateString(undefined, {
          day: "numeric",
          month: "long",
          weekday: "long",
          year: "numeric",
        })}
        className={`service-calendar-day ${day.muted ? "is-muted" : ""} ${
          selectedDate === day.date ? "is-selected" : ""
        } ${day.className || ""}`}
        data-calendar-date={day.date}
        key={day.date}
        onClick={() => onDateSelect(day.date)}
        type="button"
      >
        {viewMode === "sundays" ? (
          <strong className="calendar-sunday-date-label">
            {date.toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" })}
          </strong>
        ) : null}
        {dayContent(day)}
      </button>
    );
  }

  return (
    <div className="app-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`app-dialog app-dialog-wide service-picker-dialog calendar-view-${viewMode}`}
        aria-label={eyebrow ? `${eyebrow} ${title}` : title}
        onKeyDownCapture={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLButtonElement) event.preventDefault();
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
              <div className="calendar-month-navigation is-timeline">
                <strong>{viewMode === "sundays" ? "Sunday schedule" : "All dates"}</strong>
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

            <div className="calendar-timeline" ref={calendarTimelineRef}>
              {displayedGroups.map((group) => (
                <section className="calendar-month-group" key={group.key}>
                  <div className="calendar-month-label">
                    <strong>{monthLabel(group.key)}</strong>
                    {viewMode === "sundays" ? <span>{group.days.length} Sundays</span> : null}
                  </div>
                  <div className="service-calendar-grid">
                    {viewMode === "all" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
                      <span className="service-calendar-weekday" key={weekday}>{weekday}</span>
                    )) : null}
                    {viewMode === "all" ? Array.from(
                      { length: new Date(`${group.days[0].date}T12:00:00`).getDay() },
                      (_value, index) => <span aria-hidden="true" className="calendar-day-spacer" key={`spacer-${index}`} />,
                    ) : null}
                    {group.days.map(renderCalendarDay)}
                  </div>
                </section>
              ))}
            </div>

            {calendarAction ? <div className="calendar-popup-bottom-action">{calendarAction}</div> : null}
          </section>

          {footerContent || actionButtons ? <section className="service-picker-panel service-buttons-panel">
            {footerContent ? <div className="calendar-popup-footer">{footerContent}</div> : null}
            <div className="service-picker-buttons">{actionButtons}</div>
          </section> : null}
        </div>
      </section>
    </div>
  );
}
