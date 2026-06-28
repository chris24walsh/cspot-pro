export const CALENDAR_COLORS = ["teacher-a", "teacher-b", "teacher-c", "teacher-d", "teacher-e", "teacher-f"] as const;
export const CALENDAR_AVATARS = ["👤", "🎤", "🎸", "🎹", "🎶", "📖", "🌟", "🌿"] as const;

interface CalendarUser {
  calendar_avatar: string | null;
  calendar_color: string | null;
  id: string;
  name: string;
}

export function calendarColor(user: CalendarUser | null | undefined) {
  return user?.calendar_avatar ? "" : user?.calendar_color || "teacher-a";
}

export function calendarMarkers(users: CalendarUser[]) {
  const markers = new Map<string, string>();
  const groups = new Map<string, CalendarUser[]>();

  for (const user of users) {
    if (user.calendar_avatar) {
      markers.set(user.id, user.calendar_avatar);
      continue;
    }
    const initial = user.name.trim().charAt(0).toUpperCase() || "?";
    groups.set(initial, [...(groups.get(initial) || []), user]);
  }

  for (const [initial, group] of groups) {
    if (group.length === 1) {
      markers.set(group[0].id, initial);
      continue;
    }
    const used = new Set<string>();
    for (const user of [...group].sort((left, right) => left.name.localeCompare(right.name))) {
      const letters = user.name.toLocaleLowerCase().replace(/[^a-z0-9]/g, "").slice(1);
      const suffix = [...letters, ..."abcdefghijklmnopqrstuvwxyz"].find((letter) => !used.has(letter)) || "";
      used.add(suffix);
      markers.set(user.id, `${initial}${suffix}`);
    }
  }

  return markers;
}
