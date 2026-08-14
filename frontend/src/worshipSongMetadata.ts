const WORSHIP_ROLE_LABELS: Record<string, string> = {
  opener: "Opening",
  middle: "Middle",
  response: "Response",
  closer: "Closing",
};

export function worshipRoleLabel(value: string | null | undefined) {
  const labels = (value ?? "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter((role) => role && role !== "any")
    .map((role) => WORSHIP_ROLE_LABELS[role] ?? role);
  return labels.length ? labels.join(" / ") : "Any slot";
}

export function lastUsedLabel(value: string | null | undefined, now = Date.now()) {
  if (!value) return "Never used";
  const usedAt = new Date(value).getTime();
  if (!Number.isFinite(usedAt)) return "Never used";
  const days = Math.floor((now - usedAt) / 86_400_000);
  if (days <= 0) return "Used today";
  return `${days}d ago`;
}
