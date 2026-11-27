export function parseSongTags(value: string | null | undefined): string[] {
  return (value ?? "").split(",").flatMap((entry) => {
    const tag = entry.trim();
    return /^source:/i.test(tag) ? tag.split(/\s+(?=theme:)/i) : [tag];
  }).map((tag) => tag.trim()).filter(Boolean);
}

export function isSongSourceTag(tag: string): boolean {
  return /^source:/i.test(tag);
}

export function songTagKey(tag: string): string {
  const value = tag.trim().toLowerCase();
  if (isSongSourceTag(value)) return value.split(/\s+/)[0];
  const theme = value.replace(/^theme:/, "");
  return theme === "advent" ? "carol" : theme;
}

export function songTagLabel(tag: string): string {
  const key = songTagKey(tag);
  if (key === "source:songs-of-fellowship-1") return "SoF 1";
  const label = isSongSourceTag(key) ? key.slice("source:".length).replace(/[-_]+/g, " ") : key;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
