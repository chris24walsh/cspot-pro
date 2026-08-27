export const CALENDAR_COLORS = ["teacher-a", "teacher-b", "teacher-c", "teacher-d", "teacher-e", "teacher-f"] as const;

interface CalendarUser {
  calendar_avatar: string | null;
  calendar_color: string | null;
  id: string;
  name: string;
}

export function calendarColor(user: CalendarUser | null | undefined) {
  if (!user) return "teacher-a";
  return CALENDAR_COLORS[stableHash(user.id) % CALENDAR_COLORS.length];
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function calendarColors(users: CalendarUser[]) {
  const colors = new Map<string, string>();
  const ordered = [...users].sort((left, right) => stableHash(left.id) - stableHash(right.id));
  const offset = ordered.length ? stableHash(ordered.map((user) => user.id).join("|")) % CALENDAR_COLORS.length : 0;
  ordered.forEach((user, index) => colors.set(user.id, CALENDAR_COLORS[(offset + index) % CALENDAR_COLORS.length]));
  return colors;
}

export function userInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const initials = parts.length === 1 ? parts[0].slice(0, 1) : `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`;
  return initials.toLocaleUpperCase();
}

export function calendarMarkers(users: CalendarUser[]) {
  return new Map(users.map((user) => [user.id, userInitials(user.name)]));
}
