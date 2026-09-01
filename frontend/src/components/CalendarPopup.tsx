import { X } from "lucide-react";
import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useEscapeClose } from "./useEscapeClose";

export interface CalendarDay {
  date: string;
  muted?: boolean;
  className?: string;
  itemCount?: number;
  itemLabel?: string;
  itemLabelPlural?: string;
}

interface CalendarPopupProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  allDays: CalendarDay[];
  sundayDays: CalendarDay[];
  resolveDay: (date: string) => CalendarDay;
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

function shiftedDate(dateInput: string, dayOffset: number) {
  const date = new Date(`${dateInput}T12:00:00`);
  date.setDate(date.getDate() + dayOffset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function calendarWeekBounds(dateInput: string) {
  const date = new Date(`${dateInput}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const start = shiftedDate(dateInput, -date.getDay());
  return { start, end: shiftedDate(start, 6) };
}

export function calendarItemCountLabel(day: CalendarDay) {
  if (!day.itemCount || day.itemCount < 1) return "";
  const singular = day.itemLabel ?? "item";
  const plural = day.itemLabelPlural ?? `${singular}s`;
  return `${day.itemCount} ${day.itemCount === 1 ? singular : plural}`;
}

export function extendCalendarDays(
  baseDays: CalendarDay[],
  beforeChunks: number,
  afterChunks: number,
  sundaysOnly: boolean,
  resolveDay: (date: string) => CalendarDay = (date) => ({ date }),
) {
  if (!baseDays.length) return [];
  const step = sundaysOnly ? 7 : 1;
  const chunkSize = sundaysOnly ? 26 : 183;
  const dates = new Map(baseDays.map((day) => [day.date, day]));
  const firstDate = baseDays[0].date;
  const lastDate = baseDays[baseDays.length - 1].date;
  for (let index = 1; index <= beforeChunks * chunkSize; index += 1) {
    const date = shiftedDate(firstDate, -index * step);
    dates.set(date, resolveDay(date));
  }
  for (let index = 1; index <= afterChunks * chunkSize; index += 1) {
    const date = shiftedDate(lastDate, index * step);
    dates.set(date, resolveDay(date));
  }
  return [...dates.values()].sort((left, right) => left.date.localeCompare(right.date));
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
  resolveDay,
  selectedDate,
  onDateSelect,
  dayContent,
  calendarAction,
  footerContent,
  actionButtons,
}: CalendarPopupProps) {
  const [viewMode, setViewMode] = useState<"sundays" | "all">("all");
  const [extensions, setExtensions] = useState({ allBefore: 0, allAfter: 0, sundayBefore: 0, sundayAfter: 0 });
  const calendarTimelineRef = useRef<HTMLDivElement | null>(null);
  const prependScrollHeightRef = useRef<number | null>(null);
  const prependRestoreFrameRef = useRef<number | null>(null);
  const appendPendingRef = useRef(false);
  useEscapeClose(isOpen, onClose);
  const initialDays = visibleCalendarDays(allDays, viewMode, sundayDays);
  const displayedDays = useMemo(() => extendCalendarDays(
    initialDays,
    viewMode === "all" ? extensions.allBefore : extensions.sundayBefore,
    viewMode === "all" ? extensions.allAfter : extensions.sundayAfter,
    viewMode === "sundays",
    resolveDay,
  ), [extensions, initialDays, resolveDay, viewMode]);
  const displayedGroups = useMemo(() => groupCalendarDays(displayedDays), [displayedDays]);
  const selectedWeek = useMemo(() => calendarWeekBounds(selectedDate), [selectedDate]);

  useEffect(() => {
    setExtensions({ allBefore: 0, allAfter: 0, sundayBefore: 0, sundayAfter: 0 });
  }, [allDays[0]?.date, allDays[allDays.length - 1]?.date, sundayDays[0]?.date, sundayDays[sundayDays.length - 1]?.date]);

  useEffect(() => {
    if (isOpen) setViewMode("all");
  }, [isOpen]);

  useLayoutEffect(() => {
    const timeline = calendarTimelineRef.current;
    const previousHeight = prependScrollHeightRef.current;
    if (!timeline || previousHeight === null) return;
    const previousScrollBehavior = timeline.style.scrollBehavior;
    timeline.dataset.calendarPositioned = "false";
    timeline.style.scrollBehavior = "auto";
    timeline.scrollTop += timeline.scrollHeight - previousHeight;
    prependScrollHeightRef.current = null;
    if (prependRestoreFrameRef.current !== null) window.cancelAnimationFrame(prependRestoreFrameRef.current);
    prependRestoreFrameRef.current = window.requestAnimationFrame(() => {
      if (calendarTimelineRef.current === timeline) {
        timeline.style.scrollBehavior = previousScrollBehavior;
        timeline.dataset.calendarPositioned = "true";
      }
      prependRestoreFrameRef.current = null;
    });
  }, [displayedDays.length]);

  useEffect(() => () => {
    if (prependRestoreFrameRef.current !== null) window.cancelAnimationFrame(prependRestoreFrameRef.current);
  }, []);

  useLayoutEffect(() => {
    appendPendingRef.current = false;
  }, [displayedDays.length]);

  useEffect(() => {
    if (!isOpen) return;
    const timeline = calendarTimelineRef.current;
    if (timeline) timeline.dataset.calendarPositioned = "false";
    let positionedFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      const currentTimeline = calendarTimelineRef.current;
      if (!currentTimeline) return;
      const dates = Array.from(currentTimeline.querySelectorAll<HTMLElement>("[data-calendar-date]"));
      const selected = dates.find((element) => element.dataset.calendarDate === selectedDate);
      const next = dates.find((element) => (element.dataset.calendarDate ?? "") >= selectedDate);
      const target = selected ?? next ?? dates[0];
      if (!target) return;
      const targetTop = target.getBoundingClientRect().top - currentTimeline.getBoundingClientRect().top + currentTimeline.scrollTop;
      const previousScrollBehavior = currentTimeline.style.scrollBehavior;
      currentTimeline.style.scrollBehavior = "auto";
      currentTimeline.scrollTop = Math.max(0, targetTop - currentTimeline.clientHeight / 2 + target.offsetHeight / 2);
      positionedFrame = window.requestAnimationFrame(() => {
        if (calendarTimelineRef.current === currentTimeline) {
          currentTimeline.style.scrollBehavior = previousScrollBehavior;
          currentTimeline.dataset.calendarPositioned = "true";
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (positionedFrame !== null) window.cancelAnimationFrame(positionedFrame);
    };
  }, [isOpen, selectedDate, viewMode]);

  if (!isOpen) return null;

  function renderCalendarDay(day: CalendarDay) {
    const date = new Date(`${day.date}T12:00:00`);
    const itemCountLabel = calendarItemCountLabel(day);
    const isSelectedWeek = viewMode === "all"
      && selectedWeek !== null
      && day.date >= selectedWeek.start
      && day.date <= selectedWeek.end;
    return (
      <button
        aria-current={selectedDate === day.date ? "date" : undefined}
        aria-label={`${date.toLocaleDateString(undefined, {
          day: "numeric",
          month: "long",
          weekday: "long",
          year: "numeric",
        })}${itemCountLabel ? `, ${itemCountLabel}` : ""}`}
        className={`service-calendar-day ${day.muted ? "is-muted" : ""} ${
          selectedDate === day.date ? "is-selected" : ""
        } ${isSelectedWeek ? "is-selected-week" : ""} ${day.className || ""}`}
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
        {itemCountLabel ? (
          <small aria-label={itemCountLabel} className="calendar-item-count" title={itemCountLabel}>
            {day.itemCount}
          </small>
        ) : null}
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
                <button aria-pressed={viewMode === "sundays"} className={viewMode === "sundays" ? "active" : ""} onClick={() => {
                  if (calendarTimelineRef.current) calendarTimelineRef.current.dataset.calendarPositioned = "false";
                  setViewMode("sundays");
                }} type="button">
                  Sundays
                </button>
                <button aria-pressed={viewMode === "all"} className={viewMode === "all" ? "active" : ""} onClick={() => {
                  if (calendarTimelineRef.current) calendarTimelineRef.current.dataset.calendarPositioned = "false";
                  setViewMode("all");
                }} type="button">
                  All days
                </button>
              </div>
              <button aria-label="Close calendar" className="section-icon-button calendar-popup-close" onClick={onClose} type="button">
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div
              className="calendar-timeline"
              onScroll={(event) => {
                const timeline = event.currentTarget;
                if (timeline.dataset.calendarPositioned !== "true") return;
                if (timeline.scrollTop < 160 && prependScrollHeightRef.current === null) {
                  prependScrollHeightRef.current = timeline.scrollHeight;
                  setExtensions((current) => viewMode === "all"
                    ? { ...current, allBefore: current.allBefore + 1 }
                    : { ...current, sundayBefore: current.sundayBefore + 1 });
                }
                if (timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 240 && !appendPendingRef.current) {
                  appendPendingRef.current = true;
                  setExtensions((current) => viewMode === "all"
                    ? { ...current, allAfter: current.allAfter + 1 }
                    : { ...current, sundayAfter: current.sundayAfter + 1 });
                }
              }}
              ref={calendarTimelineRef}
            >
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
