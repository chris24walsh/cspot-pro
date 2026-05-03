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

export interface WorshipStructureSection {
  content: string;
  key: string;
  label: string;
}

export interface WorshipStructureAnalysis {
  lyrics: string;
  notes: string[];
  sections: WorshipStructureSection[];
  sequence: string | null;
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

function blockKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseExplicitSections(formatted: string) {
  const blocks = formatted
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const sections: WorshipStructureSection[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const heading = normalizeSectionHeading(lines[0] ?? "");
    const content = (heading ? lines.slice(1) : lines).join("\n").trim();
    if (!content) {
      continue;
    }

    sections.push({
      content,
      key: blockKey(content),
      label: heading ?? "",
    });
  }

  return sections.every((section) => section.label) ? sections : [];
}

function inferSectionsFromBlocks(blocks: string[]) {
  const counts = new Map<string, number>();
  const firstIndex = new Map<string, number>();

  for (const [index, block] of blocks.entries()) {
    const key = blockKey(block);
    if (!firstIndex.has(key)) {
      firstIndex.set(key, index);
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const repeatedKeys = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((first, second) => {
      if (second[1] !== first[1]) {
        return second[1] - first[1];
      }
      return (firstIndex.get(first[0]) ?? 0) - (firstIndex.get(second[0]) ?? 0);
    });

  const chorusKey =
    repeatedKeys.find(([key]) => (firstIndex.get(key) ?? 0) > 0)?.[0] ?? repeatedKeys[0]?.[0] ?? null;
  const labels = new Map<string, string>();
  const notes: string[] = [];
  let verseNumber = 1;
  let usedBridge = false;

  for (const [index, block] of blocks.entries()) {
    const key = blockKey(block);
    if (labels.has(key)) {
      continue;
    }

    if (key === chorusKey) {
      labels.set(key, "Chorus");
      continue;
    }

    const count = counts.get(key) ?? 1;
    const isNearEnd = index >= Math.max(2, Math.floor(blocks.length * 0.66));
    const isFinal = index === blocks.length - 1;

    if (!usedBridge && isNearEnd && count === 1 && blocks.length >= 4 && !isFinal) {
      labels.set(key, "Bridge");
      usedBridge = true;
      continue;
    }

    if (isFinal && count === 1 && blocks.length >= 4) {
      labels.set(key, "Tag");
      continue;
    }

    labels.set(key, `Verse ${verseNumber}`);
    verseNumber += 1;
  }

  if (chorusKey) {
    notes.push("Repeated slide content was used to infer a chorus sequence.");
  }

  return {
    notes,
    sections: blocks.map((block) => {
      const key = blockKey(block);
      return {
        content: block,
        key,
        label: labels.get(key) ?? `Section ${firstIndex.get(key)! + 1}`,
      };
    }),
  };
}

export function analyzeWorshipText(value: string, options: { title?: string } = {}): WorshipStructureAnalysis {
  const formatted = formatWorshipText(value, { removeChordLines: true });
  if (!formatted) {
    return { lyrics: "", notes: [], sections: [], sequence: null };
  }

  const explicitSections = parseExplicitSections(formatted);
  if (explicitSections.length) {
    return {
      lyrics: formatted,
      notes: ["Detected explicit section headings and preserved them for slide formatting."],
      sections: explicitSections,
      sequence: explicitSections.map((section) => section.label).join(" "),
    };
  }

  const blocks = formatted
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const inferred = inferSectionsFromBlocks(blocks);

  return {
    lyrics: blocks.join("\n\n"),
    notes: inferred.notes,
    sections: inferred.sections,
    sequence: inferred.sections.length ? inferred.sections.map((section) => section.label).join(" ") : null,
  };
}

export function analyzeImportedSongSlides(slides: string[], title?: string): WorshipStructureAnalysis {
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

  const normalizedSlides = cleanedSlides
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
    .filter(Boolean);

  const inferred = inferSectionsFromBlocks(normalizedSlides);

  return {
    lyrics: normalizedSlides.join("\n\n"),
    notes: repeatedLines.size
      ? ["Repeated slide lines were collapsed before inferring song structure.", ...inferred.notes]
      : inferred.notes,
    sections: inferred.sections,
    sequence: inferred.sections.length ? inferred.sections.map((section) => section.label).join(" ") : null,
  };
}

export function normalizeImportedSongSlides(slides: string[], title?: string) {
  return analyzeImportedSongSlides(slides, title).lyrics;
}
