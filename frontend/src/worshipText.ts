const SECTION_ALIASES = new Map<string, string>([
  ["v", "Verse"],
  ["verse", "Verse"],
  ["chorus", "Chorus"],
  ["c", "Chorus"],
  ["refrain", "Chorus"],
  ["bridge", "Bridge"],
  ["b", "Bridge"],
  ["pre chorus", "Pre-Chorus"],
  ["pre-chorus", "Pre-Chorus"],
  ["prechorus", "Pre-Chorus"],
  ["tag", "Tag"],
  ["ending", "Ending"],
  ["outro", "Outro"],
  ["intro", "Intro"],
]);

const WEB_CLUTTER_PATTERNS = [
  /^lyrics?\s*$/i,
  /^submit corrections?$/i,
  /^azlyrics\.com/i,
  /^copyright\b/i,
  /^writer\(s\):/i,
  /^publisher\(s\):/i,
  /^you might also like$/i,
  /^\d+\s*embed$/i,
  /^\d+\s*\/\s*\d+$/,
  /^slide\s+\d+$/i,
  /^page\s+\d+$/i,
];

function normalizeSectionHeading(line: string): string | null {
  const trimmed = line.trim().replace(/^\[|\]$/g, "").replace(/:$/, "");
  const match = trimmed.match(/^(verse|v|chorus|c|refrain|bridge|b|pre[-\s]?chorus|tag|ending|outro|intro)\s*(\d+)?$/i);
  if (!match) {
    return null;
  }

  const label = SECTION_ALIASES.get(match[1].toLowerCase().replace(/\s+/g, " "));
  if (!label) {
    return null;
  }

  return match[2] ? `${label} ${match[2]}` : label;
}

export function isWorshipSectionHeading(line: string): boolean {
  return normalizeSectionHeading(line) !== null;
}

function isLikelyChordLine(line: string): boolean {
  const compact = line.trim();
  if (!compact) {
    return false;
  }

  return /^[A-G](?:#|b)?(?:m|maj|min|sus|dim|aug|add)?\d*(?:\/[A-G](?:#|b)?)?(?:\s+[A-G](?:#|b)?(?:m|maj|min|sus|dim|aug|add)?\d*(?:\/[A-G](?:#|b)?)?)*$/.test(
    compact,
  );
}

function isWebClutter(line: string): boolean {
  return WEB_CLUTTER_PATTERNS.some((pattern) => pattern.test(line.trim()));
}

export function formatWorshipText(value: string, options: { removeChordLines?: boolean } = {}) {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, " ");

  const output: string[] = [];
  let previousBlank = true;

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.replace(/\s+$/g, "").replace(/^\s+/g, "");
    const heading = normalizeSectionHeading(line);

    if (!line || isWebClutter(line) || (options.removeChordLines && isLikelyChordLine(line))) {
      if (!previousBlank && output.length) {
        output.push("");
        previousBlank = true;
      }
      continue;
    }

    if (heading) {
      if (!previousBlank && output.length) {
        output.push("");
      }
      output.push(heading);
      previousBlank = false;
      continue;
    }

    output.push(line.replace(/\s{2,}/g, " "));
    previousBlank = false;
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function splitWorshipSlides(value: string) {
  const formatted = formatWorshipText(value, { removeChordLines: true });
  if (!formatted) {
    return [];
  }

  return formatted
    .split(/\n{2,}/)
    .map((slide) =>
      slide
        .split(/\r?\n/)
        .filter((line, index) => index > 0 || !isWorshipSectionHeading(line))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

export function normalizeImportedSongSlides(slides: string[], title?: string) {
  const cleanedSlides = slides
    .map((slide) => formatWorshipText(slide, { removeChordLines: true }))
    .filter(Boolean);
  const lineCounts = new Map<string, number>();

  for (const slide of cleanedSlides) {
    for (const line of slide.split(/\r?\n/)) {
      const normalized = line.trim().toLowerCase();
      if (normalized) {
        lineCounts.set(normalized, (lineCounts.get(normalized) ?? 0) + 1);
      }
    }
  }

  const repeatedLines = new Set(
    [...lineCounts.entries()]
      .filter(([line, count]) => count > 1 && line !== title?.trim().toLowerCase())
      .map(([line]) => line),
  );

  return cleanedSlides
    .map((slide) =>
      slide
        .split(/\r?\n/)
        .filter((line) => {
          const normalized = line.trim().toLowerCase();
          return normalized && !repeatedLines.has(normalized);
        })
        .join("\n")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}
