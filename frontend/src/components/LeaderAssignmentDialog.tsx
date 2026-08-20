import { Shuffle, UserRound, X } from "lucide-react";
import { useMemo } from "react";

import type { Member } from "../api";
import { sundayDatesForMonth } from "../leaderSchedule";
import { calendarColor, calendarMarkers } from "../userCalendarStyle";
import { useEscapeClose } from "./useEscapeClose";

interface LeaderAssignmentDialogProps {
  areaLabel: string;
  busy?: boolean;
  currentDate: string | null;
  explicitLeaderId: string | null;
  leaderIdForDate: (date: string) => string | null;
  leaders: Member[];
  maxSundaysForLeader: (leader: Member) => number | null;
  onAssign: (leaderId: string | null) => void;
  onClose: () => void;
  onSwap: (targetDate: string) => void;
}

function dialogDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" });
}

function todayDateInput() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

export function nearbyUpcomingSundays(value: string, todayInput = todayDateInput()) {
  const center = new Date(`${value}T12:00:00`);
  if (Number.isNaN(center.getTime())) return [];
  return Array.from({ length: 13 }, (_unused, index) => {
    const date = new Date(center);
    date.setDate(center.getDate() + (index - 4) * 7);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }).filter((date) => date >= todayInput && date !== value).slice(0, 8);
}

export function LeaderAssignmentDialog({
  areaLabel,
  busy = false,
  currentDate,
  explicitLeaderId,
  leaderIdForDate,
  leaders,
  maxSundaysForLeader,
  onAssign,
  onClose,
  onSwap,
}: LeaderAssignmentDialogProps) {
  useEscapeClose(Boolean(currentDate), onClose);
  const markers = useMemo(() => calendarMarkers(leaders), [leaders]);
  const monthDates = currentDate ? sundayDatesForMonth(currentDate.slice(0, 7)) : [];
  const usage = new Map(leaders.map((leader) => [
    leader.id,
    monthDates.filter((date) => leaderIdForDate(date) === leader.id).length,
  ]));
  const currentLeaderId = currentDate ? leaderIdForDate(currentDate) : null;
  const currentLeader = leaders.find((leader) => leader.id === currentLeaderId) ?? null;

  if (!currentDate) return null;
  const isPastDate = currentDate < todayDateInput();

  return (
    <div className="app-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="app-dialog leader-assignment-dialog"
        aria-label={`${areaLabel} leader for ${dialogDate(currentDate)}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="leader-dialog-heading">
          <div>
            <p className="eyebrow">{areaLabel} leader</p>
            <h2>{dialogDate(currentDate)}</h2>
            <p>
              {currentLeader
                ? `${currentLeader.name} · ${explicitLeaderId || isPastDate ? "stored assignment" : "automatic rotation"}`
                : isPastDate ? "No stored leader for this historical date" : "No leader available in the rotation"}
            </p>
          </div>
          <button aria-label="Close leader assignment" className="section-icon-button" onClick={onClose} type="button">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="leader-dialog-section">
          <div className="leader-dialog-section-heading">
            <strong>Assign</strong>
            <span>Workload shown for this month</span>
          </div>
          <div className="leader-option-grid">
            <button
              className={!explicitLeaderId && !isPastDate ? "leader-option is-selected" : "leader-option"}
              disabled={busy || isPastDate}
              onClick={() => onAssign(null)}
              type="button"
            >
              <span className="leader-option-avatar"><UserRound size={17} aria-hidden="true" /></span>
              <span><strong>Automatic</strong><small>Use the rotation</small></span>
            </button>
            {leaders.map((leader) => {
              const maximum = maxSundaysForLeader(leader);
              const assigned = usage.get(leader.id) ?? 0;
              return (
                <button
                  className={`leader-option ${calendarColor(leader)} ${explicitLeaderId === leader.id ? "is-selected" : ""}`}
                  disabled={busy}
                  key={leader.id}
                  onClick={() => onAssign(leader.id)}
                  type="button"
                >
                  <span className={`leader-option-avatar ${leader.calendar_avatar ? "is-avatar" : ""}`}>{markers.get(leader.id)}</span>
                  <span><strong>{leader.name}</strong><small>{assigned} / {maximum ?? "∞"} Sundays</small></span>
                </button>
              );
            })}
          </div>
        </div>

        {!isPastDate ? <div className="leader-dialog-section">
          <div className="leader-dialog-section-heading">
            <strong>Swap Sundays</strong>
            <span>Moves both leaders in one step</span>
          </div>
          <div className="leader-swap-list">
            {nearbyUpcomingSundays(currentDate).map((date) => {
              const leaderId = leaderIdForDate(date);
              const leader = leaders.find((candidate) => candidate.id === leaderId) ?? null;
              return (
                <button
                  className={`leader-swap-row ${leader ? calendarColor(leader) : ""}`}
                  disabled={busy || !currentLeaderId || !leaderId}
                  key={date}
                  onClick={() => onSwap(date)}
                  type="button"
                >
                  <Shuffle size={14} aria-hidden="true" />
                  <strong>{dialogDate(date)}</strong>
                  <span>{leader?.name || "Unassigned"}</span>
                </button>
              );
            })}
          </div>
        </div> : null}
      </section>
    </div>
  );
}
