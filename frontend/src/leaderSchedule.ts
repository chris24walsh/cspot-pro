export interface SundayLeader {
  id: string;
  name: string;
  maxSundaysPerMonth: number | null;
}

function dateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function sundayDatesAround(centerInput: string, count = 42, pastCount = 10) {
  const parsedCenter = new Date(`${centerInput}T12:00:00`);
  const center = Number.isNaN(parsedCenter.getTime()) ? new Date() : parsedCenter;
  center.setHours(12, 0, 0, 0);
  center.setDate(center.getDate() + ((7 - center.getDay()) % 7));

  const safeCount = Math.max(1, Math.floor(count));
  const safePastCount = Math.min(Math.max(0, Math.floor(pastCount)), safeCount - 1);
  const firstSunday = new Date(center);
  firstSunday.setDate(center.getDate() - safePastCount * 7);

  return Array.from({ length: safeCount }, (_value, index) => {
    const date = new Date(firstSunday);
    date.setDate(firstSunday.getDate() + index * 7);
    return dateInput(date);
  });
}

export function calendarDatesAround(centerInput: string, monthsBefore = 2, monthsAfter = 7) {
  const parsedCenter = new Date(`${centerInput}T12:00:00`);
  const center = Number.isNaN(parsedCenter.getTime()) ? new Date() : parsedCenter;
  const firstDate = new Date(center.getFullYear(), center.getMonth() - monthsBefore, 1, 12);
  const lastDate = new Date(center.getFullYear(), center.getMonth() + monthsAfter + 1, 0, 12);
  const dates: string[] = [];
  for (const cursor = new Date(firstDate); cursor <= lastDate; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(dateInput(cursor));
  }
  return dates;
}

export function sundayDatesForMonth(monthInput: string) {
  const [yearValue, monthValue] = monthInput.split("-").map(Number);
  const year = Number.isFinite(yearValue) ? yearValue : new Date().getFullYear();
  const month = Number.isFinite(monthValue) ? monthValue - 1 : new Date().getMonth();
  const cursor = new Date(year, month, 1);
  cursor.setDate(1 + ((7 - cursor.getDay()) % 7));
  const sundays: string[] = [];
  while (cursor.getMonth() === month) {
    sundays.push(dateInput(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return sundays;
}

export function buildMonthlyLeaderSchedule(
  monthInput: string,
  leaders: SundayLeader[],
  explicitAssignments: ReadonlyMap<string, string>,
) {
  const orderedLeaders = [...leaders].sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  const schedule = new Map<string, string>();
  if (!orderedLeaders.length) return schedule;

  const sundays = sundayDatesForMonth(monthInput);
  const counts = new Map(orderedLeaders.map((leader) => [leader.id, 0]));
  for (const date of sundays) {
    const assignedId = explicitAssignments.get(date);
    if (!assignedId) continue;
    schedule.set(date, assignedId);
    if (counts.has(assignedId)) counts.set(assignedId, (counts.get(assignedId) ?? 0) + 1);
  }

  const [year, month] = monthInput.split("-").map(Number);
  let cursor = Math.abs(((year || 0) * 12 + (month || 1) - 1) % orderedLeaders.length);
  for (const date of sundays) {
    if (schedule.has(date)) continue;
    for (let offset = 0; offset < orderedLeaders.length; offset += 1) {
      const leaderIndex = (cursor + offset) % orderedLeaders.length;
      const leader = orderedLeaders[leaderIndex];
      const assignedCount = counts.get(leader.id) ?? 0;
      const capacity = leader.maxSundaysPerMonth ?? Number.POSITIVE_INFINITY;
      if (assignedCount >= capacity) continue;
      schedule.set(date, leader.id);
      counts.set(leader.id, assignedCount + 1);
      cursor = (leaderIndex + 1) % orderedLeaders.length;
      break;
    }
  }
  return schedule;
}

export function effectiveLeaderIdForDate(
  date: string,
  leaders: SundayLeader[],
  explicitAssignments: ReadonlyMap<string, string>,
  todayInput = dateInput(new Date()),
) {
  const explicitLeaderId = explicitAssignments.get(date);
  if (explicitLeaderId) return explicitLeaderId;
  if (date < todayInput) return null;
  return buildMonthlyLeaderSchedule(date.slice(0, 7), leaders, explicitAssignments).get(date) ?? null;
}
