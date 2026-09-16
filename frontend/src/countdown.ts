export function countdownDeadline(serviceDate: string, until: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(until)) return null;
  const day = new Date(serviceDate);
  if (Number.isNaN(day.getTime())) return null;
  const [hour, minute] = until.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime();
}

export function countdownRemaining(durationSeconds: number, startAt: number | undefined, until: string | undefined, serviceDate: string, now: number) {
  const deadline = until ? countdownDeadline(serviceDate, until) : null;
  if (deadline !== null) return Math.max(0, Math.ceil((deadline - now) / 1000));
  return Math.max(0, durationSeconds - Math.floor(Math.max(0, now - (startAt ?? now)) / 1000));
}
