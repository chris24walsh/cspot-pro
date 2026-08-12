const SECTION_ALIASES = new Map<string, string>([
  ["v", "Verse"],
  ["verse", "Verse"],
  ["chorus", "Chorus"],
  ["c", "Chorus"],
  ["refrain", "Chorus"],
  ["bridge", "Bridge"],
  ["b", "Bridge"],
  ["pre chorus", "PreChorus"],
  ["pre-chorus", "PreChorus"],
  ["prechorus", "PreChorus"],
  ["p", "PreChorus"],
  ["tag", "Tag"],
  ["t", "Tag"],
  ["ending", "Ending"],
  ["outro", "Outro"],
  ["o", "Outro"],
  ["intro", "Intro"],
]);

const TITLE_NOISE_SUFFIXES = ["lyrics", "lyric", "song", "worship"];

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
  const match = trimmed.match(/^(verse|v|chorus|c|refrain|bridge|b|pre[-\s]?chorus|p|tag|t|ending|outro|o|intro)\s*(\d+)?$/i);
  if (!match) {
    return null;
  }

  const label = SECTION_ALIASES.get(match[1].toLowerCase().replace(/\s+/g, " "));
  if (!label) {
    return null;
  }

  return match[2] ? `${label}${match[2]}` : label;
}

function isInvalidSectionLabel(line: string) {
  const trimmed = line.trim();
  return /^\[[^\]]+\]:?$/.test(trimmed) && !normalizeSectionHeading(trimmed);
}

function compactSectionLabel(label: string) {
  const trimmed = label.trim().replace(/\s+/g, "");
  const match = trimmed.match(/^(Verse|Chorus|Bridge|PreChorus|Tag|Ending|Outro|Intro)(\d+)?$/i);
  if (!match) {
    return label.replace(/\s+/g, "");
  }
  const base = match[1].toLowerCase();
  const prefix =
    base === "verse"
      ? "V"
      : base === "chorus"
        ? "C"
        : base === "bridge"
          ? "B"
          : base === "prechorus"
            ? "P"
            : base === "tag"
              ? "T"
              : base === "ending"
                ? "E"
                : base === "outro"
                  ? "O"
                  : base === "intro"
                    ? "I"
                    : "";
  return `${prefix}${match[2] ?? ""}`;
}

function normalizeSectionToken(token: string): string | null {
  const trimmed = token.trim().replace(/^\[|\]$/g, "").replace(/:$/, "");
  const compact = trimmed.replace(/\s+/g, "");
  const match = compact.match(/^(v|verse|c|chorus|b|bridge|p|pc|prechorus|pre-chorus|t|tag|ending|o|outro|intro)(\d+)?$/i);
  if (!match) {
    return normalizeSectionHeading(trimmed);
  }

  const base = match[1].toLowerCase();
  const number = match[2] ?? "";
  const label =
    base === "v" || base === "verse"
      ? "Verse"
      : base === "c" || base === "chorus"
        ? "Chorus"
        : base === "b" || base === "bridge"
          ? "Bridge"
          : base === "p" || base === "pc" || base === "prechorus" || base === "pre-chorus"
            ? "PreChorus"
            : base === "t"
              ? "Tag"
              : base === "o"
                ? "Outro"
                : base[0].toUpperCase() + base.slice(1);

  return number ? `${label}${number}` : label;
}

function sequenceLabels(sequence: string | null | undefined) {
  const labels: string[] = [];
  const normalized = (sequence ?? "")
    .replace(/([A-Za-z]+)(\d+)?x(\d+)/gi, (_match, part: string, number: string = "", count: string) =>
      Array.from({ length: Number(count) || 1 }, () => `${part}${number}`).join(" "),
    )
    .replace(/\bpre[-\s]?chorus(?:\s*(\d+))?\b/gi, (_match, number: string = "") => `PreChorus${number}`)
    .replace(/\b(verse|chorus|bridge|tag|ending|outro|intro)\s+(\d+)\b/gi, "$1$2")
    .replace(/\bC(?=V\d)/gi, "C ");

  for (const token of normalized.split(/[\s,>/|-]+/)) {
    const label = normalizeSectionToken(token);
    if (label) {
      labels.push(label);
    }
  }

  return labels;
}

function canonicalVerseLabelMap(value: string | null | undefined) {
  const labels = new Map<string, string>();
  let verseNumber = 1;

  for (const section of parseWorshipSectionBlocks(value)) {
    const label = normalizeSectionToken(section.label) ?? compactSectionLabel(section.label);
    const match = label.match(/^Verse(\d+)$/i);
    if (match && !labels.has(label)) {
      labels.set(label, `Verse${verseNumber}`);
      verseNumber += 1;
    }
  }

  return labels;
}

function insertMissingLyricLabels(sequence: string[], lyricLabels: string[]) {
  const result = [...sequence];
  lyricLabels.forEach((label, lyricIndex) => {
    if (result.includes(label)) {
      return;
    }

    const nextLabel = lyricLabels.slice(lyricIndex + 1).find((candidate) => result.includes(candidate));
    if (nextLabel) {
      result.splice(result.indexOf(nextLabel), 0, label);
      return;
    }

    const previousLabel = lyricLabels.slice(0, lyricIndex).reverse().find((candidate) => result.includes(candidate));
    if (previousLabel) {
      result.splice(result.lastIndexOf(previousLabel) + 1, 0, label);
    } else {
      result.push(label);
    }
  });
  return result;
}

export function normalizeWorshipSequence(sequence: string | null | undefined, lyrics?: string | null) {
  const verseLabels = canonicalVerseLabelMap(lyrics);
  const resolvedLabels = sequenceLabels(sequence).map((label) => verseLabels.get(label) ?? label);
  const verseNumbers = Array.from(
    new Set(
      resolvedLabels.flatMap((label) => {
        const match = label.match(/^Verse(\d+)$/i);
        return match ? [Number(match[1])] : [];
      }),
    ),
  ).sort((left, right) => left - right);
  const compactVerseNumber = new Map(verseNumbers.map((number, index) => [number, index + 1]));
  const labels = resolvedLabels.map((label) => {
    const match = label.match(/^Verse(\d+)$/i);
    return compactSectionLabel(match ? `Verse${compactVerseNumber.get(Number(match[1]))}` : label);
  });
  const lyricLabels = parseWorshipSectionBlocks(lyrics)
    .map((section) => normalizeSectionToken(section.label))
    .filter((label): label is string => Boolean(label))
    .map((label) => verseLabels.get(label) ?? label)
    .map(compactSectionLabel);

  if (!lyricLabels.length) {
    return labels.length ? labels.join(" ") : null;
  }
  if (labels.length <= lyricLabels.length) {
    return lyricLabels.join(" ");
  }

  const knownLabels = new Set(lyricLabels);
  const preservedLabels = labels.filter((label) => knownLabels.has(label));
  return insertMissingLyricLabels(preservedLabels, lyricLabels).join(" ");
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

  for (const rawSourceLine of normalized.split("\n")) {
    const expandedLines = /^\s*\[[^\]]+\]\s*$/.test(rawSourceLine)
      ? [rawSourceLine]
      : rawSourceLine.replace(/([a-z,;.!?)])([A-Z][a-z])/g, "$1\n$2").split("\n");

    for (const rawLine of expandedLines) {
      const line = rawLine.replace(/\s+$/g, "").replace(/^\s+/g, "");
      const heading = normalizeSectionHeading(line);

      if (!line || isInvalidSectionLabel(line) || isWebClutter(line) || (options.removeChordLines && isLikelyChordLine(line))) {
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
        output.push(`[${heading}]`);
        previousBlank = false;
        continue;
      }

      output.push(line.replace(/\s{2,}/g, " "));
      previousBlank = false;
    }
  }

  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) {
        return "";
      }
      if (isWorshipSectionHeading(trimmed)) {
        return trimmed;
      }
      return trimmed;
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
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

function parseWorshipSectionBlocks(value: string | null | undefined) {
  const formatted = formatWorshipText(value ?? "", { removeChordLines: true });
  if (!formatted) {
    return [] as WorshipStructureSection[];
  }

  return mergeStandaloneSectionHeadings(formatted)
    .map((block) => {
      const lines = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const heading = normalizeSectionHeading(lines[0] ?? "");
      const label = heading ? compactSectionLabel(heading) : "";
      const content = (heading ? lines.slice(1) : lines).join("\n").trim();
      return {
        content,
        key: blockKey(content || label),
        label,
      };
    })
    .filter((section) => section.content || section.label);
}

function mergeStandaloneSectionHeadings(formatted: string) {
  const blocks = formatted
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const merged: string[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const lines = block.split(/\r?\n/).filter((line) => line.trim());
    const heading = normalizeSectionHeading(lines[0] ?? "");
    const nextBlock = blocks[index + 1];
    const nextHeading = nextBlock ? normalizeSectionHeading(nextBlock.split(/\r?\n/, 1)[0] ?? "") : null;

    if (heading && lines.length === 1 && nextBlock && !nextHeading) {
      merged.push(`${block}\n${nextBlock}`);
      index += 1;
    } else {
      merged.push(block);
    }
  }

  return merged;
}

export function expandWorshipSlides(value: string | null | undefined, sequence?: string | null) {
  return worshipSequenceBlocks(value, sequence).map((block) => block.content);
}

export function worshipSequenceBlocks(value: string | null | undefined, sequence?: string | null) {
  const sections = parseWorshipSectionBlocks(value);
  if (!sections.length) {
    return [];
  }

  const contentByLabel = new Map<string, string[]>();
  const fallbackSlides: string[] = [];

  for (const section of sections) {
    const label = normalizeSectionToken(section.label) ?? compactSectionLabel(section.label);
    if (section.content) {
      const group = contentByLabel.get(label) ?? [];
      if (!group.some((content) => blockKey(content) === blockKey(section.content))) {
        group.push(section.content);
        contentByLabel.set(label, group);
      }
    }
    if (section.content) {
      fallbackSlides.push(section.content);
    } else {
      const referenced = contentByLabel.get(label) ?? [];
      if (referenced.length) {
        fallbackSlides.push(...referenced);
      }
    }
  }

  const ordered = sequenceLabels(sequence).flatMap((label) =>
    (contentByLabel.get(label) ?? []).map((content) => ({ content, label: compactSectionLabel(label) })),
  );

  return ordered.length
    ? ordered
    : fallbackSlides.map((content, index) => ({ content, label: sections[index]?.label || String(index + 1) }));
}

export function canonicalizeWorshipLyrics(value: string | null | undefined, sequence?: string | null) {
  const sections = parseWorshipSectionBlocks(value);
  const seenContentByLabel = new Map<string, string>();
  const verseLabels = canonicalVerseLabelMap(value);
  let verseNumber = 1;

  const blocks = sections
    .map((section) => {
      let label = normalizeSectionToken(section.label) ?? compactSectionLabel(section.label);
      if (!label) {
        return section.content;
      }
      if (verseLabels.has(label)) {
        label = verseLabels.get(label)!;
      } else if (/^Verse\d*$/i.test(label)) {
        label = `Verse${verseNumber}`;
      }
      if (/^Verse\d+$/i.test(label)) {
        verseNumber = Math.max(verseNumber, Number(label.match(/\d+$/)?.[0] ?? 0) + 1);
      }
      const previous = seenContentByLabel.get(label);
      if (section.content && !previous) {
        seenContentByLabel.set(label, blockKey(section.content));
        return [`[${compactSectionLabel(label)}]`, section.content].join("\n");
      }
      if (section.content && previous === blockKey(section.content)) {
        return `[${compactSectionLabel(label)}]`;
      }
      if (section.content) {
        return [`[${compactSectionLabel(label)}]`, section.content].join("\n");
      }
      return `[${compactSectionLabel(label)}]`;
    })
    .filter(Boolean);

  const sequenceOnlyRepeats = sequenceLabels(sequence).filter((label) => seenContentByLabel.has(label));
  if (sequenceOnlyRepeats.length > blocks.length) {
    const knownLabels = new Set(blocks.map((block) => normalizeSectionToken(block.split(/\r?\n/, 1)[0] ?? "")).filter(Boolean));
    for (const label of sequenceOnlyRepeats) {
      if (!knownLabels.has(label)) {
        blocks.push(`[${compactSectionLabel(label)}]`);
        knownLabels.add(label);
      }
    }
  }

  return blocks.join("\n\n").trim();
}

export function sequenceFromWorshipLyrics(value: string | null | undefined) {
  const labels = parseWorshipSectionBlocks(value)
    .map((section) => normalizeSectionToken(section.label) ?? compactSectionLabel(section.label))
    .map(compactSectionLabel)
    .filter(Boolean);

  return labels.filter((label, index) => index === 0 || label !== labels[index - 1]).join(" ");
}

export function buildLyricsFromSections(sections: WorshipStructureSection[]) {
  return sections
    .map((section) => [section.label ? `[${compactSectionLabel(section.label)}]` : "", section.content].filter(Boolean).join("\n").trim())
    .filter(Boolean)
    .join("\n\n");
}

function cleanTitleNoise(value: string) {
  return value
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\s+(lyrics?|song|worship)\s*$/i, "")
    .replace(/\s*[-–—]\s*(lyrics?|song|worship)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleVariants(value: string | null | undefined) {
  if (!value) {
    return new Set<string>();
  }
  const cleaned = cleanTitleNoise(value);
  const candidates = new Set([value, cleaned]);
  for (const separator of [" - ", " – ", " — "]) {
    if (cleaned.includes(separator)) {
      const [left, right] = cleaned.split(separator, 2).map((part) => part.trim());
      if (left) {
        candidates.add(left);
      }
      if (right) {
        candidates.add(right);
      }
    }
  }

  const variants = new Set<string>();
  for (const candidate of candidates) {
    const key = normalizedTextKey(cleanTitleNoise(candidate));
    if (!key) {
      continue;
    }
    variants.add(key);
    for (const suffix of TITLE_NOISE_SUFFIXES) {
      const suffixKey = normalizedTextKey(suffix);
      if (key.endsWith(` ${suffixKey}`)) {
        variants.add(key.slice(0, -(suffixKey.length + 1)).trim());
      }
      if (key.endsWith(suffixKey) && key.length > suffixKey.length + 3) {
        variants.add(key.slice(0, -suffixKey.length).trim());
      }
    }
  }
  return variants;
}

function titleSimilarity(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }
  const maxLength = Math.max(left.length, right.length);
  let matches = 0;
  for (const token of new Set(left.split(/\s+/))) {
    if (right.split(/\s+/).includes(token)) {
      matches += token.length;
    }
  }
  return matches / maxLength;
}

function lineMatchesTitleNoise(line: string, title: string | null | undefined) {
  const lineKey = normalizedTextKey(cleanTitleNoise(line));
  if (!lineKey) {
    return false;
  }
  for (const variant of titleVariants(title)) {
    if (lineKey === variant || titleSimilarity(lineKey, variant) >= 0.92) {
      return true;
    }
    for (const suffix of TITLE_NOISE_SUFFIXES) {
      if (lineKey === normalizedTextKey(`${variant} ${suffix}`)) {
        return true;
      }
    }
  }
  return false;
}

function lineMatchesTitleSuffixNoise(line: string, title: string | null | undefined) {
  const lineKey = normalizedTextKey(line);
  const cleanedKey = normalizedTextKey(cleanTitleNoise(line));
  return lineKey !== cleanedKey && lineMatchesTitleNoise(line, title);
}

function blockKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

interface BlockStats {
  internalRepeats: number;
  lineCount: number;
  repeatedOpeningWords: number;
  wordCount: number;
}

function meaningfulLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function openingWordsKey(line: string, wordCount = 3) {
  return line
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, wordCount)
    .join(" ");
}

function blockStats(block: string): BlockStats {
  const lines = meaningfulLines(block);
  const lineCounts = new Map<string, number>();
  const openingCounts = new Map<string, number>();

  for (const line of lines) {
    const normalizedLine = normalizedTextKey(line);
    lineCounts.set(normalizedLine, (lineCounts.get(normalizedLine) ?? 0) + 1);

    const openingKey = openingWordsKey(line);
    if (openingKey.split(/\s+/).length >= 2) {
      openingCounts.set(openingKey, (openingCounts.get(openingKey) ?? 0) + 1);
    }
  }

  return {
    internalRepeats: [...lineCounts.values()].filter((count) => count > 1).length,
    lineCount: lines.length,
    repeatedOpeningWords: [...openingCounts.values()].filter((count) => count > 1).length,
    wordCount: lines.join(" ").split(/\s+/).filter(Boolean).length,
  };
}

function isStructurallySimilarHymn(
  blocks: string[],
  stats: BlockStats[],
  repeatedKeys: Array<[string, number]>,
  languageChorusIndexes: Set<number>,
) {
  if (blocks.length < 4 || repeatedKeys.length || languageChorusIndexes.size) {
    return false;
  }

  const lineCounts = stats.map((stat) => stat.lineCount).filter(Boolean);
  const wordCounts = stats.map((stat) => stat.wordCount).filter(Boolean);
  if (!lineCounts.length || !wordCounts.length) {
    return false;
  }

  const minLines = Math.min(...lineCounts);
  const maxLines = Math.max(...lineCounts);
  const minWords = Math.min(...wordCounts);
  const maxWords = Math.max(...wordCounts);
  const averageWords = wordCounts.reduce((total, count) => total + count, 0) / wordCounts.length;
  const standoutHook = stats.some((stat) => {
    const muchShorter = stat.wordCount < averageWords * 0.55;
    const hookRepeats = stat.internalRepeats > 0 || stat.repeatedOpeningWords > 0;
    return muchShorter && hookRepeats;
  });

  return maxLines - minLines <= 2 && minWords >= averageWords * 0.62 && maxWords <= averageWords * 1.45 && !standoutHook;
}

function looksLikeChorusCandidate(index: number, blocks: string[], stats: BlockStats[], averageWordCount: number) {
  if (index <= 0 || index >= blocks.length - 1 || blocks.length < 3) {
    return false;
  }

  const stat = stats[index];
  const previous = stats[index - 1];
  const next = stats[index + 1];
  const shorterThanBothNeighbors =
    stat.wordCount <= previous.wordCount * 0.82 && stat.wordCount <= next.wordCount * 0.88;
  const shorterThanSong = stat.wordCount <= averageWordCount * 0.78;
  const hookLike = stat.internalRepeats > 0 || stat.repeatedOpeningWords > 0 || /!/.test(blocks[index]);
  const compactComparedWithNeighbors = stat.lineCount + 1 < Math.max(previous.lineCount, next.lineCount);

  return hookLike && (shorterThanBothNeighbors || shorterThanSong || compactComparedWithNeighbors);
}

function looksLikeRefrainLanguage(index: number, blocks: string[], title?: string | null) {
  if (blocks.length < 2) {
    return false;
  }
  const block = blocks[index];
  const lines = meaningfulLines(block);
  if (!lines.length) {
    return false;
  }
  const firstLineKey = normalizedTextKey(lines[0]);
  const startsWithTitle = Boolean(
    title &&
      [...titleVariants(title)].some(
        (variant) => firstLineKey === variant || firstLineKey.startsWith(`${variant} `) || firstLineKey.includes(` ${variant}`),
      ),
  );
  const responseWords = [
    "sing",
    "song",
    "praise",
    "praises",
    "glory",
    "honour",
    "honor",
    "worthy",
    "hallelujah",
    "amen",
    "forevermore",
    "throne",
    "reign",
    "worship",
    "thank",
    "crown",
  ];
  const text = normalizedTextKey(block);
  const responseScore = responseWords.filter((word) => new RegExp(`\\b${word}\\b`).test(text)).length;
  return lines.length <= 8 && (startsWithTitle || (index > 0 && index < blocks.length - 1 && responseScore >= 3));
}

function parseExplicitSections(formatted: string) {
  const blocks = mergeStandaloneSectionHeadings(formatted);
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

  return sections.every((section) => section.label) ? renumberVerseSections(sections) : [];
}

function renumberVerseSections(sections: WorshipStructureSection[]) {
  let verseNumber = 1;
  return sections.map((section) => {
    if (/^Verse\d*$/i.test(section.label)) {
      const label = `Verse${verseNumber}`;
      verseNumber += 1;
      return { ...section, label };
    }
    return section;
  });
}

function inferSectionsFromBlocks(blocks: string[], title?: string | null) {
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
  const stats = blocks.map(blockStats);
  const labels = new Map<string, string>();
  const notes: string[] = [];
  let usedBridge = false;
  let usedInferredChorus = Boolean(chorusKey);
  const wordCounts = stats.map((stat) => stat.wordCount);
  const averageWordCount = wordCounts.reduce((total, count) => total + count, 0) / Math.max(1, wordCounts.length);
  const languageChorusIndexes = new Set(blocks.map((_block, index) => index).filter((index) => looksLikeRefrainLanguage(index, blocks, title)));
  const hymnLike = isStructurallySimilarHymn(blocks, stats, repeatedKeys, languageChorusIndexes);

  for (const [index, block] of blocks.entries()) {
    const key = blockKey(block);
    if (labels.has(key)) {
      continue;
    }

    if (key === chorusKey) {
      labels.set(key, "Chorus");
      continue;
    }

    if (hymnLike) {
      labels.set(key, "Verse");
      continue;
    }

    const count = counts.get(key) ?? 1;
    const isNearEnd = index >= Math.max(2, Math.floor(blocks.length * 0.66));
    const isFinal = index === blocks.length - 1;
    const wordCount = wordCounts[index] ?? 0;

    const repeatMarker = /\b(?:x\s*\d+|repeat(?:\s+all)?)\b|\(\s*x\s*\d+\s*\)/i.test(block);
    const bridgeMarker = /\bbridge\b/i.test(block);
    const nextKey = blocks[index + 1] ? blockKey(blocks[index + 1]) : null;
    const nextIsChorus =
      Boolean(nextKey && nextKey === chorusKey) || languageChorusIndexes.has(index + 1) || Boolean(nextKey && labels.get(nextKey) === "Chorus");
    const isShortStandalone = stats[index].lineCount <= 2 && wordCount > 0 && wordCount <= averageWordCount * 0.62;

    if (index > 0 && count === 1 && nextIsChorus && isShortStandalone && !repeatMarker && !bridgeMarker) {
      labels.set(key, "PreChorus");
      continue;
    }

    if (
      !usedInferredChorus &&
      (looksLikeChorusCandidate(index, blocks, stats, averageWordCount) ||
        languageChorusIndexes.has(index) ||
        (index > 0 && repeatMarker && !bridgeMarker))
    ) {
      labels.set(key, "Chorus");
      usedInferredChorus = true;
      notes.push("A refrain-like middle lyric chunk was labelled as Chorus; check this before presenting.");
      continue;
    }

    const isMuchShorterThanAverage = wordCount > 0 && wordCount <= averageWordCount * 0.55;
    const hasHookRepeats = stats[index].internalRepeats > 0 || stats[index].repeatedOpeningWords > 0;

    if (!usedBridge && isNearEnd && count === 1 && blocks.length >= 4 && !isFinal && isMuchShorterThanAverage && hasHookRepeats) {
      labels.set(key, "Bridge");
      usedBridge = true;
      continue;
    }

    if (isFinal && count === 1 && blocks.length >= 4 && isMuchShorterThanAverage && hasHookRepeats) {
      labels.set(key, "Tag");
      continue;
    }

    labels.set(key, "Verse");
  }

  let verseNumber = 1;
  for (const block of blocks) {
    const key = blockKey(block);
    if (labels.get(key) === "Verse") {
      labels.set(key, `Verse${verseNumber}`);
      verseNumber += 1;
    }
  }

  if (chorusKey) {
    notes.push("Repeated slide content was used to infer a chorus sequence.");
  }

  if (hymnLike) {
    notes.push("Similar-length stanzas were treated as hymn-style verses.");
  }

  return {
    notes,
    sections: renumberVerseSections(blocks.map((block) => {
      const key = blockKey(block);
      return {
        content: block,
        key,
        label: labels.get(key) ?? "",
      };
    })),
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

function stripLeadingTitleBlock(blocks: string[], title: string | null) {
  if (!blocks.length || !title) {
    return { notes: [] as string[], blocks };
  }

  let removedInlineTitle = false;
  const cleanedBlocks = blocks
    .map((block, index) => {
      const lines = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const firstLineIsRepeatedLyric =
        index === 0 &&
        lines.length > 1 &&
        lineMatchesTitleNoise(lines[0], title) &&
        [
          ...lines.slice(1),
          ...blocks.slice(1).flatMap((candidate) => candidate.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)),
        ].some((line) => lineMatchesTitleNoise(line, title));
      while (
        lines.length &&
        ((index === 0 && (lineMatchesTitleSuffixNoise(lines[0], title) || firstLineIsRepeatedLyric)) ||
          (index > 0 && lineMatchesTitleSuffixNoise(lines[0], title)))
      ) {
        lines.shift();
        removedInlineTitle = true;
        if (index === 0) {
          break;
        }
      }
      return lines.join("\n").trim();
    })
    .filter(Boolean);

  if (cleanedBlocks.length < 2) {
    return {
      notes: removedInlineTitle ? ["Removed title noise from imported lyrics."] : [],
      blocks: cleanedBlocks,
    };
  }

  const laterTitleIndex = cleanedBlocks.findIndex((block, index) => {
    if (index === 0 || index > 3) {
      return false;
    }
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.length > 0 && lines.length <= 2 && lineMatchesTitleNoise(lines.join(" "), title);
  });

  if (laterTitleIndex > 0 && cleanedBlocks.length - laterTitleIndex >= 2) {
    return {
      notes: ["Ignored stray lyric slides before the detected song title."],
      blocks: cleanedBlocks.slice(laterTitleIndex + 1),
    };
  }

  const [firstBlock, ...remainingBlocks] = cleanedBlocks;
  const firstLines = firstBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (firstLines.length === 0 || firstLines.length > 2) {
    return {
      notes: removedInlineTitle ? ["Removed title noise from imported lyrics."] : [],
      blocks: cleanedBlocks,
    };
  }

  const firstSlideText = normalizedTextKey(firstLines.join(" "));
  const titleText = normalizedTextKey(title);
  const nextSlideLineCount = remainingBlocks[0]?.split(/\r?\n/).filter((line) => line.trim()).length ?? 0;

  if (firstSlideText && lineMatchesTitleNoise(firstSlideText, titleText) && nextSlideLineCount >= 2) {
    return {
      notes: ["Ignored the opening title slide and used it as the song title only."],
      blocks: remainingBlocks,
    };
  }

  return {
    notes: removedInlineTitle ? ["Removed title noise from imported lyrics."] : [],
    blocks: cleanedBlocks,
  };
}

export function analyzeWorshipText(value: string, options: { title?: string; redetectSections?: boolean } = {}): WorshipStructureAnalysis {
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

  const titleBlockResult = stripLeadingTitleBlock(
    formatted
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean),
    options.title ? titleCaseFromFilename(options.title) : null,
  );
  const normalizedFormatted = titleBlockResult.blocks.join("\n\n");

  const explicitSections = options.redetectSections ? [] : parseExplicitSections(normalizedFormatted);
  if (explicitSections.length) {
    return {
      lyrics: normalizedFormatted,
      notes: [...titleBlockResult.notes, "Detected explicit section headings and preserved them for slide formatting."],
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

  const blocks = titleBlockResult.blocks
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const heading = normalizeSectionHeading(lines[0] ?? "");
      return (heading ? lines.slice(1) : lines).join("\n").trim();
    })
    .filter(Boolean);
  const inferred = inferSectionsFromBlocks(blocks, options.title ? titleCaseFromFilename(options.title) : null);

  return {
    lyrics: blocks.join("\n\n"),
    notes: [...titleBlockResult.notes, ...inferred.notes],
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
  const titleSlideResult = stripLeadingTitleBlock(cleanedSlides, suggestions.title);
  const normalizedSlides = titleSlideResult.blocks.filter(Boolean);

  const inferred = inferSectionsFromBlocks(normalizedSlides, suggestions.title);

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
