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

export const SECTION_LABEL_OPTIONS = [
  "Intro",
  "Verse 1",
  "Verse 2",
  "Verse 3",
  "Verse 4",
  "Pre-Chorus",
  "Chorus",
  "Bridge",
  "Tag",
  "Ending",
  "Outro",
];

const WEB_CLUTTER_PATTERNS = [
  /^lyrics?\s*$/i,
  /^submit corrections?$/i,
  /^azlyrics\.com/i,
  /^copyright\b/i,
  /^ccli\b/i,
  /^writer\(s\):/i,
  /^publisher\(s\):/i,
  /^words?\s+(?:and\s+music\s+)?by\b/i,
  /^music\s+by\b/i,
  /^used by permission\b/i,
  /^all rights reserved\b/i,
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

export interface WorshipImportSuggestions {
  author: string | null;
  ccliNumber: string | null;
  license: string | null;
  title: string | null;
}

export interface WorshipStructureAnalysis {
  lyrics: string;
  notes: string[];
  sections: WorshipStructureSection[];
  sequence: string | null;
  suggestions: WorshipImportSuggestions;
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

export function buildLyricsFromSections(sections: WorshipStructureSection[]) {
  return sections
    .map((section) => [section.label, section.content].filter(Boolean).join("\n").trim())
    .filter(Boolean)
    .join("\n\n");
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

function titleCaseFromFilename(value: string) {
  const base = value
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!base) {
    return null;
  }

  return base.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizedTextKey(value: string) {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");
}

function extractImportSuggestions(slides: string[], fallbackTitle?: string): WorshipImportSuggestions {
  let author: string | null = null;
  let ccliNumber: string | null = null;
  let license: string | null = null;

  for (const slide of slides) {
    for (const line of slide.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (!ccliNumber) {
        const ccliMatch = trimmed.match(/ccli(?:\s+song)?(?:\s+(?:no|number))?\s*#?\s*:?\s*(\d{4,})/i);
        if (ccliMatch) {
          ccliNumber = ccliMatch[1];
        }
      }

      if (!author) {
        const authorMatch = trimmed.match(/^(?:words?\s+(?:and\s+music\s+)?by|music\s+by|by)\s+(.+)$/i);
        if (authorMatch?.[1]) {
          author = authorMatch[1].trim();
        }
      }

      if (!license) {
        if (/public domain/i.test(trimmed)) {
          license = "Public Domain";
        } else if (/ccli/i.test(trimmed)) {
          license = "CCLI";
        }
      }
    }
  }

  return {
    author,
    ccliNumber,
    license,
    title: fallbackTitle ? titleCaseFromFilename(fallbackTitle) : null,
  };
}

function stripLeadingTitleSlide(slides: string[], title: string | null) {
  if (slides.length < 2 || !title) {
    return { notes: [] as string[], slides };
  }

  const [firstSlide, ...remainingSlides] = slides;
  const firstLines = firstSlide
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (firstLines.length === 0 || firstLines.length > 2) {
    return { notes: [] as string[], slides };
  }

  const firstSlideText = normalizedTextKey(firstLines.join(" "));
  const titleText = normalizedTextKey(title);
  const nextSlideLineCount = remainingSlides[0]?.split(/\r?\n/).filter((line) => line.trim()).length ?? 0;

  if (firstSlideText && firstSlideText === titleText && nextSlideLineCount >= 2) {
    return {
      notes: ["Ignored the opening title slide and used it as the song title only."],
      slides: remainingSlides,
    };
  }

  return { notes: [] as string[], slides };
}

export function analyzeWorshipText(value: string, options: { title?: string } = {}): WorshipStructureAnalysis {
  const formatted = formatWorshipText(value, { removeChordLines: true });
  if (!formatted) {
    return {
      lyrics: "",
      notes: [],
      sections: [],
      sequence: null,
      suggestions: {
        author: null,
        ccliNumber: null,
        license: null,
        title: options.title ? titleCaseFromFilename(options.title) : null,
      },
    };
  }

  const explicitSections = parseExplicitSections(formatted);
  if (explicitSections.length) {
    return {
      lyrics: formatted,
      notes: ["Detected explicit section headings and preserved them for slide formatting."],
      sections: explicitSections,
      sequence: explicitSections.map((section) => section.label).join(" "),
      suggestions: {
        author: null,
        ccliNumber: null,
        license: null,
        title: options.title ? titleCaseFromFilename(options.title) : null,
      },
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
    suggestions: {
      author: null,
      ccliNumber: null,
      license: null,
      title: options.title ? titleCaseFromFilename(options.title) : null,
    },
  };
}

export function analyzeImportedSongSlides(slides: string[], title?: string): WorshipStructureAnalysis {
  const cleanedSlides = slides
    .map((slide) => formatWorshipText(slide, { removeChordLines: true }))
    .filter(Boolean);
  const suggestions = extractImportSuggestions(cleanedSlides, title);
  const titleSlideResult = stripLeadingTitleSlide(cleanedSlides, suggestions.title);
  const normalizedSlides = titleSlideResult.slides.filter(Boolean);

  const inferred = inferSectionsFromBlocks(normalizedSlides);

  return {
    lyrics: normalizedSlides.join("\n\n"),
    notes: [...titleSlideResult.notes, ...inferred.notes],
    sections: inferred.sections,
    sequence: inferred.sections.length ? inferred.sections.map((section) => section.label).join(" ") : null,
    suggestions,
  };
}

export function normalizeImportedSongSlides(slides: string[], title?: string) {
  return analyzeImportedSongSlides(slides, title).lyrics;
}
