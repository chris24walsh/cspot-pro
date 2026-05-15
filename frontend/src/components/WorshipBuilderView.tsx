import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ListPlus, MonitorUp, Music2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createSong,
  createPlanItem,
  createPlan,
  deletePlan,
  deletePlanItem,
  getPlan,
  getPlanTypes,
  getPlans,
  getSongs,
  getWorshipSetSuggestion,
  parseGoogleDriveDeck,
  searchGoogleDriveFiles,
  updatePlan,
  updatePlanItem,
  type GoogleDriveFile,
  type ParsedSlideDeck,
  type PlanDetail,
  type PlanItem,
  type PlanSummary,
  type PlanType,
  type Song,
} from "../api";
import { buildPresentationSections, suggestSlideGroupFontCap } from "../presentation";
import { analyzeImportedSongSlides, buildLyricsFromSections } from "../worshipText";
import { dateKey, isWorshipSetPlan, worshipSetType } from "../worshipSets";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { MusicianLiveView } from "./MusicianLiveView";

const SELECTED_WORSHIP_SET_SESSION_KEY = "cspot.selectedWorshipSetPlanId";
const WORSHIP_HISTORY_FOLDER = "LCF Cloud/Worship/Weekly Worship Slidedecks";

type WorshipHistoryPreview = {
  date: string;
  deck: ParsedSlideDeck;
  file: GoogleDriveFile;
  matchedSongs: Array<{ firstSlideIndex: number; song: Song }>;
  missingSongs: WorshipHistoryMissingSong[];
};

type WorshipHistoryMissingSong = {
  author: string | null;
  ccliNumber: string | null;
  firstSlideIndex: number;
  lastSlideIndex: number;
  license: string | null;
  lyrics: string;
  notes: string[];
  sequence: string | null;
  title: string;
};

interface WorshipBuilderViewProps {
  canDeletePlan: boolean;
  canEditPlan: boolean;
}

function formatServiceDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "No date"
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" });
}

function monthInputFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dateInputFromIso(value: string | null | undefined) {
  return dateKey(value);
}

function isoFromDateInput(value: string) {
  return `${value}T10:30:00.000Z`;
}

function calendarDaysForMonth(monthInput: string) {
  const [yearValue, monthValue] = monthInput.split("-").map(Number);
  const year = Number.isFinite(yearValue) ? yearValue : new Date().getFullYear();
  const month = Number.isFinite(monthValue) ? monthValue - 1 : new Date().getMonth();
  const firstDay = new Date(year, month, 1);
  const start = new Date(firstDay);
  start.setDate(1 - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date,
      key: dateInputFromIso(date.toISOString()),
      muted: date.getMonth() !== month,
    };
  });
}

function longDateForInput(value: string) {
  const date = new Date(isoFromDateInput(value));
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", weekday: "long" });
}

function suggestedWorshipSetTitle(value: string) {
  return `Worship Set ${longDateForInput(value)}`;
}

function songStatus(song: Pick<Song, "lyrics" | "chords"> | null | undefined) {
  if (!song?.lyrics?.trim()) {
    return "Needs lyrics";
  }
  if (!song.chords?.trim()) {
    return "Ready";
  }
  return "Chords";
}

function nextSongSequence(items: PlanItem[]) {
  const highest = items.reduce((max, item) => Math.max(max, Number.parseFloat(item.sequence) || 0), 0);
  return (highest + 1).toFixed(2);
}

function sortedWorshipItems(items: PlanItem[]) {
  return [...items]
    .filter((item) => item.item_type === "song" && item.song_id)
    .sort((left, right) => (Number.parseFloat(left.sequence) || 0) - (Number.parseFloat(right.sequence) || 0));
}

function sequenceAfterSelected(items: PlanItem[], selectedItemId: string | null) {
  const worshipItems = sortedWorshipItems(items);
  const selectedIndex = selectedItemId ? worshipItems.findIndex((item) => item.id === selectedItemId) : -1;
  if (selectedIndex < 0) {
    return nextSongSequence(items);
  }

  const selectedSequence = Number.parseFloat(worshipItems[selectedIndex]?.sequence ?? "0") || 0;
  const nextSequence = Number.parseFloat(worshipItems[selectedIndex + 1]?.sequence ?? "");
  if (Number.isFinite(nextSequence)) {
    return ((selectedSequence + nextSequence) / 2).toFixed(4);
  }
  return (selectedSequence + 1).toFixed(2);
}

function compactSongTitle(song: Song) {
  return song.author ? `${song.title} · ${song.author}` : song.title;
}

function normalizedTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function songTitleKeys(song: Pick<Song, "alternate_title" | "title">) {
  return [song.title, song.alternate_title].filter(Boolean).map((value) => normalizedTitle(value!));
}

function cleanSlideTitle(value: string) {
  return value
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\s+(?:lyrics|song|worship)\s*$/i, "")
    .replace(/\s*[-–—]\s*(?:lyrics|song|worship)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulSlideLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function titleFromSlide(slide: ParsedSlideDeck["slides"][number]) {
  const lines = meaningfulSlideLines(`${slide.title}\n${slide.text}`);
  const candidate = lines.find((line) => {
    const cleaned = cleanSlideTitle(line);
    return cleaned.length >= 4 && cleaned.length <= 70 && !/[.;:,]$/.test(cleaned);
  });

  return candidate ? cleanSlideTitle(candidate) : "";
}

function isProbablySongTitleSlide(slide: ParsedSlideDeck["slides"][number]) {
  const lines = meaningfulSlideLines(`${slide.title}\n${slide.text}`);
  const candidate = titleFromSlide(slide);
  if (!candidate || lines.length > 4) {
    return false;
  }

  const normalized = normalizedTitle(candidate);
  if (
    /^(welcome|sermon|reading|offering|communion|notices|announcements|prayer|closing|opening)$/i.test(candidate) ||
    /^(?:slide|page)\s+\d+$/i.test(candidate) ||
    /\b(?:john|genesis|exodus|psalm|psalms|matthew|mark|luke|romans|revelation)\s+\d+/i.test(candidate) ||
    normalized.includes("ccli") ||
    normalized.includes("copyright")
  ) {
    return false;
  }

  const lyricLookingLines = lines.filter((line) => line.split(/\s+/).length >= 6);
  return lyricLookingLines.length <= 1;
}

function inferDeckDate(file: Pick<GoogleDriveFile, "name" | "modified_time">) {
  const numeric = file.name.match(/\b(20\d{2})[-_. ]?([01]?\d)[-_. ]?([0-3]?\d)\b/);
  if (numeric) {
    return `${numeric[1]}-${numeric[2].padStart(2, "0")}-${numeric[3].padStart(2, "0")}`;
  }

  const shortDate = file.name.match(/\b([0-3]?\d)[-_. /]([01]?\d)[-_. /](20\d{2}|\d{2})\b/);
  if (shortDate) {
    const year = shortDate[3].length === 2 ? `20${shortDate[3]}` : shortDate[3];
    return `${year}-${shortDate[2].padStart(2, "0")}-${shortDate[1].padStart(2, "0")}`;
  }

  return dateInputFromIso(file.modified_time);
}

function matchSongsInDeck(deck: ParsedSlideDeck, songs: Song[]) {
  const matched = new Map<string, { firstSlideIndex: number; song: Song }>();
  const searchableSlides = deck.slides.map((slide) => ({
    index: slide.index,
    text: normalizedTitle(`${slide.title}\n${slide.text}`),
  }));

  for (const song of songs) {
    const keys = songTitleKeys(song);
    const firstSlide = searchableSlides.find((slide) => keys.some((key) => key.length >= 5 && slide.text.includes(key)));
    if (firstSlide) {
      matched.set(song.id, { firstSlideIndex: firstSlide.index, song });
    }
  }

  return [...matched.values()].sort((left, right) => left.firstSlideIndex - right.firstSlideIndex);
}

function detectMissingSongsInDeck(deck: ParsedSlideDeck, songs: Song[]) {
  const existingTitleKeys = songs.flatMap(songTitleKeys).filter((key) => key.length >= 5);
  const titleSlides = deck.slides
    .filter(isProbablySongTitleSlide)
    .map((slide) => ({
      index: slide.index,
      slide,
      title: titleFromSlide(slide),
    }))
    .filter((entry) => entry.title);

  const seenTitles = new Set<string>();
  const missing: WorshipHistoryMissingSong[] = [];

  for (const [anchorIndex, anchor] of titleSlides.entries()) {
    const titleKey = normalizedTitle(anchor.title);
    if (seenTitles.has(titleKey)) {
      continue;
    }
    seenTitles.add(titleKey);

    const exists = existingTitleKeys.some((key) => titleKey === key || titleKey.includes(key) || key.includes(titleKey));
    if (exists) {
      continue;
    }

    const nextTitleSlide = titleSlides[anchorIndex + 1];
    const rangeSlides = deck.slides.filter((slide) => slide.index >= anchor.index && (!nextTitleSlide || slide.index < nextTitleSlide.index));
    const analysis = analyzeImportedSongSlides(rangeSlides.map((slide) => slide.text || slide.title), anchor.title);
    const lyrics = buildLyricsFromSections(analysis.sections) || analysis.lyrics;
    if (!lyrics.trim()) {
      continue;
    }

    missing.push({
      author: analysis.suggestions.author,
      ccliNumber: analysis.suggestions.ccliNumber,
      firstSlideIndex: anchor.index,
      lastSlideIndex: rangeSlides[rangeSlides.length - 1]?.index ?? anchor.index,
      license: analysis.suggestions.license,
      lyrics,
      notes: analysis.notes,
      sequence: analysis.sequence,
      title: analysis.suggestions.title ?? anchor.title,
    });
  }

  return missing;
}

export function WorshipBuilderView({ canDeletePlan, canEditPlan }: WorshipBuilderViewProps) {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [planTypes, setPlanTypes] = useState<PlanType[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [setPickerOpen, setSetPickerOpen] = useState(false);
  const [setCalendarMonth, setSetCalendarMonth] = useState(monthInputFromDate(new Date()));
  const [setDraftPlanId, setSetDraftPlanId] = useState<string | null>(null);
  const [setDraftDate, setSetDraftDate] = useState(dateInputFromIso(new Date().toISOString()));
  const [setDraftTitle, setSetDraftTitle] = useState(suggestedWorshipSetTitle(dateInputFromIso(new Date().toISOString())));
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [historyImportOpen, setHistoryImportOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFiles, setHistoryFiles] = useState<GoogleDriveFile[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<WorshipHistoryPreview | null>(null);
  const [historyImporting, setHistoryImporting] = useState(false);
  const [historyBatchImporting, setHistoryBatchImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"builder" | "live">("builder");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const setListRef = useRef<HTMLDivElement | null>(null);
  const slideReviewRef = useRef<HTMLElement | null>(null);
  const setItemRefs = useRef<Record<string, HTMLElement | null>>({});
  const slideGroupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const worshipSetPlans = useMemo(() => plans.filter(isWorshipSetPlan), [plans]);

  const sortedPlans = useMemo(
    () =>
      [...worshipSetPlans].sort((left, right) => {
        const leftTime = new Date(left.service_date).getTime();
        const rightTime = new Date(right.service_date).getTime();
        return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
      }),
    [worshipSetPlans],
  );

  const worshipSetsByDate = useMemo(
    () => new Map(worshipSetPlans.map((worshipSet) => [dateInputFromIso(worshipSet.service_date), worshipSet])),
    [worshipSetPlans],
  );
  const servicePlansByDate = useMemo(
    () => new Map(plans.filter((candidate) => !isWorshipSetPlan(candidate)).map((servicePlan) => [dateInputFromIso(servicePlan.service_date), servicePlan])),
    [plans],
  );

  const calendarDays = useMemo(() => calendarDaysForMonth(setCalendarMonth), [setCalendarMonth]);

  const worshipItems = useMemo(
    () => sortedWorshipItems(plan?.items ?? []),
    [plan],
  );

  const worshipSections = useMemo(
    () => buildPresentationSections(worshipItems, songs),
    [songs, worshipItems],
  );

  const compactFontCap = useMemo(
    () =>
      suggestSlideGroupFontCap(
        worshipSections.flatMap((section) => section.slides.map((slide) => slide.text)),
        true,
      ),
    [worshipSections],
  );

  const filteredSongs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return songs
      .filter((song) => {
        if (!normalized) {
          return true;
        }
        return `${song.title} ${song.author ?? ""}`.toLowerCase().includes(normalized);
      })
      .slice(0, 80);
  }, [query, songs]);

  async function load(targetPlanId?: string) {
    setLoading(true);
    try {
      const [nextPlans, nextSongs, nextPlanTypes] = await Promise.all([getPlans(), getSongs(), getPlanTypes()]);
      const nextWorshipPlans = nextPlans.filter(isWorshipSetPlan);
      const requestedPlanId =
        targetPlanId !== undefined
          ? targetPlanId
          : sessionStorage.getItem(SELECTED_WORSHIP_SET_SESSION_KEY) || selectedPlanId;
      const resolvedPlanId = nextWorshipPlans.some((candidate) => candidate.id === requestedPlanId)
        ? requestedPlanId
        : nextWorshipPlans[0]?.id || "";
      const nextPlan = resolvedPlanId ? await getPlan(resolvedPlanId) : null;
      const nextWorshipItems = sortedWorshipItems(nextPlan?.items ?? []);
      setPlans(nextPlans);
      setSongs(nextSongs);
      setPlanTypes(nextPlanTypes);
      setSelectedPlanId(resolvedPlanId);
      if (resolvedPlanId) {
        sessionStorage.setItem(SELECTED_WORSHIP_SET_SESSION_KEY, resolvedPlanId);
      } else {
        sessionStorage.removeItem(SELECTED_WORSHIP_SET_SESSION_KEY);
      }
      setPlan(nextPlan);
      setSelectedItemId((current) =>
        current && nextWorshipItems.some((item) => item.id === current) ? current : nextWorshipItems[0]?.id ?? null,
      );
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load worship builder.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedItemId) {
      return;
    }
    setItemRefs.current[selectedItemId]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    slideGroupRefs.current[selectedItemId]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedItemId, worshipSections]);

  async function selectPlan(planId: string) {
    setSelectedPlanId(planId);
    await load(planId);
  }

  function openSetPicker() {
    const draftDate = dateInputFromIso(plan?.service_date) || dateInputFromIso(new Date().toISOString());
    setSetDraftDate(draftDate);
    setSetDraftPlanId(plan?.id ?? null);
    setSetDraftTitle(plan?.title ?? suggestedWorshipSetTitle(draftDate));
    setSetCalendarMonth(draftDate.slice(0, 7) || monthInputFromDate(new Date()));
    setSetPickerOpen(true);
  }

  function chooseSetDate(dateInput: string) {
    const existing = worshipSetsByDate.get(dateInput);
    setSetDraftDate(dateInput);
    setSetCalendarMonth(dateInput.slice(0, 7) || setCalendarMonth);
    if (existing) {
      setSetDraftPlanId(existing.id);
      setSetDraftTitle(existing.title);
      return;
    }
    setSetDraftPlanId(null);
    setSetDraftTitle(suggestedWorshipSetTitle(dateInput));
  }

  async function saveWorshipSetDraft(openAfterSave = false) {
    if (!canEditPlan) {
      setMessage("Only worship team members and leaders can save worship sets.");
      return;
    }
    const planType = worshipSetType(planTypes);
    if (!planType) {
      setMessage("The Worship Set plan type has not been installed yet. Run migrations and rebuild the API.");
      return;
    }

    try {
      const payload = {
        plan_type_id: planType.id,
        service_date: isoFromDateInput(setDraftDate),
        title: setDraftTitle.trim() || suggestedWorshipSetTitle(setDraftDate),
        subtitle: null,
        leader_id: null,
        teacher_id: null,
        status: "draft",
        info: null,
      };
      const saved = setDraftPlanId ? await updatePlan(setDraftPlanId, payload) : await createPlan(payload);
      await absorbServiceSongsIntoWorshipSet(saved, setDraftDate);
      await load(openAfterSave ? saved.id : selectedPlanId || saved.id);
      setSetDraftPlanId(saved.id);
      setSetPickerOpen(!openAfterSave);
      setMessage(setDraftPlanId ? "Worship set saved." : "Worship set created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save worship set.");
    }
  }

  async function absorbServiceSongsIntoWorshipSet(worshipSet: PlanDetail, dateInput: string) {
    const matchingService = servicePlansByDate.get(dateInput);
    if (!matchingService) {
      return;
    }

    const servicePlan = await getPlan(matchingService.id);
    const serviceSongs = sortedWorshipItems(servicePlan.items);
    if (!serviceSongs.length) {
      return;
    }

    const targetSet = await getPlan(worshipSet.id);
    const existingSongIds = new Set(targetSet.items.map((item) => item.song_id).filter(Boolean));
    for (const item of serviceSongs) {
      if (!existingSongIds.has(item.song_id)) {
        await createPlanItem(targetSet.id, {
          item_type: "song",
          sequence: item.sequence,
          title: item.title,
          comment: item.comment,
          key_signature: item.key_signature,
          song_id: item.song_id,
        });
        existingSongIds.add(item.song_id);
      }
      await deletePlanItem(item.id);
    }
  }

  async function openDraftWorshipSet() {
    if (setDraftPlanId) {
      await selectPlan(setDraftPlanId);
      setSetPickerOpen(false);
      return;
    }
    await saveWorshipSetDraft(true);
  }

  async function archiveSelectedWorshipSet() {
    if (!setDraftPlanId || !canDeletePlan) {
      return;
    }

    try {
      await deletePlan(setDraftPlanId);
      const nextPlanId = selectedPlanId === setDraftPlanId ? "" : selectedPlanId;
      setSetDraftPlanId(null);
      setSetDraftTitle(suggestedWorshipSetTitle(setDraftDate));
      await load(nextPlanId);
      setMessage("Worship set archived.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not archive worship set.");
    }
  }

  async function addSong(song: Song) {
    if (!plan || !canEditPlan) {
      return;
    }
    if (worshipItems.some((item) => item.song_id === song.id)) {
      setMessage(`"${song.title}" is already in this worship set.`);
      return;
    }

    try {
      await createPlanItem(plan.id, {
        item_type: "song",
        sequence: sequenceAfterSelected(plan.items, selectedItemId),
        title: song.title,
        comment: null,
        key_signature: null,
        song_id: song.id,
      });
      await load(plan.id);
      setMessage(`Added "${song.title}" after the selected song.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add song.");
    }
  }

  async function suggestWorshipSet() {
    if (!plan || !canEditPlan) {
      return;
    }

    setSuggesting(true);
    try {
      const suggestion = await getWorshipSetSuggestion(5);
      const existingSongIds = new Set(worshipItems.map((item) => item.song_id).filter(Boolean));
      const songsToAdd = suggestion.songs.filter((entry) => !existingSongIds.has(entry.song.id));
      let sequence = Number.parseFloat(nextSongSequence(worshipItems));
      for (const entry of songsToAdd) {
        await createPlanItem(plan.id, {
          item_type: "song",
          sequence: sequence.toFixed(2),
          title: entry.song.title,
          comment: `${entry.slot}: ${entry.reason}`,
          key_signature: null,
          song_id: entry.song.id,
        });
        sequence += 10;
      }
      await load(plan.id);
      setMessage(
        songsToAdd.length
          ? `Suggested ${songsToAdd.length} song${songsToAdd.length === 1 ? "" : "s"} from worship history.`
          : "No new suggestion found outside the songs already in this set.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not suggest a worship set.");
    } finally {
      setSuggesting(false);
    }
  }

  async function searchHistoryDecks() {
    setHistoryLoading(true);
    setHistoryPreview(null);
    try {
      const files = await searchGoogleDriveFiles(historySearch.trim(), WORSHIP_HISTORY_FOLDER);
      setHistoryFiles(files);
      setMessage(files.length ? null : `No decks found in ${WORSHIP_HISTORY_FOLDER}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not search worship history decks.");
      setHistoryFiles([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function buildHistoryPreview(file: GoogleDriveFile, songCatalog = songs): Promise<WorshipHistoryPreview> {
    const deck = await parseGoogleDriveDeck(file.id);
    const date = inferDeckDate(file);
    return {
      date,
      deck,
      file,
      matchedSongs: matchSongsInDeck(deck, songCatalog),
      missingSongs: detectMissingSongsInDeck(deck, songCatalog),
    };
  }

  async function previewHistoryDeck(file: GoogleDriveFile) {
    setHistoryLoading(true);
    try {
      setHistoryPreview(await buildHistoryPreview(file));
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not parse this worship deck.");
      setHistoryPreview(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function createMissingHistorySongs(preview: WorshipHistoryPreview, songCatalog: Song[]) {
    const entries: Array<{ firstSlideIndex: number; song: Song }> = [];
    const localCatalog = [...songCatalog];
    let createdSongCount = 0;

    for (const missing of preview.missingSongs) {
      const titleKey = normalizedTitle(missing.title);
      const existing = localCatalog.find((song) => songTitleKeys(song).some((key) => key === titleKey || key.includes(titleKey) || titleKey.includes(key)));
      if (existing) {
        entries.push({ firstSlideIndex: missing.firstSlideIndex, song: existing });
        continue;
      }

      const song = await createSong({
        alternate_title: null,
        author: missing.author,
        book_reference: null,
        ccli_number: missing.ccliNumber,
        chords: null,
        energy: null,
        external_link: null,
        license: missing.license,
        lyrics: missing.lyrics,
        sequence: missing.sequence,
        tempo: null,
        theme_tags: null,
        title: missing.title,
        worship_role: null,
        youtube_id: null,
      });
      localCatalog.push(song);
      entries.push({ firstSlideIndex: missing.firstSlideIndex, song });
      createdSongCount += 1;
    }

    if (entries.length) {
      setSongs(localCatalog);
    }
    return { createdSongCount, entries, songCatalog: localCatalog };
  }

  async function importHistory(preview: WorshipHistoryPreview, songCatalog = songs) {
    const type = worshipSetType(planTypes);
    if (!type) {
      setMessage("The Worship Set plan type has not been installed yet. Run migrations and rebuild the API.");
      return { createdSongCount: 0, planSongCount: 0, songCatalog };
    }

    const missingResult = await createMissingHistorySongs(preview, songCatalog);
    const entries = [...preview.matchedSongs, ...missingResult.entries].sort((left, right) => left.firstSlideIndex - right.firstSlideIndex);
    if (!entries.length) {
      setMessage("No songs were matched or detected in that deck.");
      return { createdSongCount: missingResult.createdSongCount, planSongCount: 0, songCatalog: missingResult.songCatalog };
    }

    const existingSummary = worshipSetsByDate.get(preview.date);
    const targetPlan = existingSummary
        ? await getPlan(existingSummary.id)
        : await createPlan({
            plan_type_id: type.id,
            service_date: isoFromDateInput(preview.date),
            title: suggestedWorshipSetTitle(preview.date),
            subtitle: null,
            leader_id: null,
            teacher_id: null,
            status: "draft",
            info: `Imported from ${preview.file.name}`,
          });

    const existingSongIds = new Set(targetPlan.items.map((item) => item.song_id).filter(Boolean));
    let sequence = Number.parseFloat(nextSongSequence(targetPlan.items));
    let planSongCount = 0;
    for (const entry of entries) {
      if (existingSongIds.has(entry.song.id)) {
        continue;
      }
      await createPlanItem(targetPlan.id, {
        item_type: "song",
        sequence: sequence.toFixed(2),
        title: entry.song.title,
        comment: `Imported from ${preview.file.name} slide ${entry.firstSlideIndex}`,
        key_signature: null,
        song_id: entry.song.id,
      });
      existingSongIds.add(entry.song.id);
      sequence += 10;
      planSongCount += 1;
    }

    await load(targetPlan.id);
    return { createdSongCount: missingResult.createdSongCount, planSongCount, songCatalog: missingResult.songCatalog };
  }

  async function importHistoryPreview() {
    if (!historyPreview || !canEditPlan) {
      return;
    }

    setHistoryImporting(true);
    try {
      const result = await importHistory(historyPreview);
      setHistoryImportOpen(false);
      setMessage(`Imported "${historyPreview.file.name}": ${result.planSongCount} set song${result.planSongCount === 1 ? "" : "s"}, ${result.createdSongCount} new song${result.createdSongCount === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import worship history.");
    } finally {
      setHistoryImporting(false);
    }
  }

  async function importHistoryBatch(limit?: number) {
    if (!canEditPlan || !historyFiles.length) {
      return;
    }

    setHistoryBatchImporting(true);
    setMessage("Importing worship history. This can take a little while for PowerPoint decks.");
    try {
      const files = typeof limit === "number" ? historyFiles.slice(0, limit) : historyFiles;
      let songCatalog = songs;
      let createdSongCount = 0;
      let planSongCount = 0;
      for (const file of files) {
        const preview = await buildHistoryPreview(file, songCatalog);
        const result = await importHistory(preview, songCatalog);
        songCatalog = result.songCatalog;
        createdSongCount += result.createdSongCount;
        planSongCount += result.planSongCount;
      }
      setHistoryImportOpen(false);
      setMessage(`Imported ${files.length} deck${files.length === 1 ? "" : "s"}: ${planSongCount} set song${planSongCount === 1 ? "" : "s"}, ${createdSongCount} new song${createdSongCount === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import worship history batch.");
    } finally {
      setHistoryBatchImporting(false);
    }
  }

  async function removeSong(item: PlanItem) {
    if (!canEditPlan) {
      return;
    }
    try {
      await deletePlanItem(item.id);
      if (plan) {
        await load(plan.id);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove song.");
    }
  }

  async function moveSong(item: PlanItem, delta: -1 | 1) {
    if (!plan || !canEditPlan) {
      return;
    }
    const index = worshipItems.findIndex((candidate) => candidate.id === item.id);
    const target = worshipItems[index + delta];
    if (!target) {
      return;
    }

    try {
      await Promise.all([
        updatePlanItem(item.id, { sequence: target.sequence }),
        updatePlanItem(target.id, { sequence: item.sequence }),
      ]);
      await load(plan.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reorder worship set.");
    }
  }

  if (viewMode === "live") {
    return (
      <section className="worship-builder worship-live-shell" aria-label="Musician live worship">
        <div className="worship-live-topbar">
          <label>
            Worship Set
            <select
              disabled={loading}
              onChange={(event) => void selectPlan(event.target.value)}
              value={selectedPlanId}
            >
              {sortedPlans.map((worshipSet) => (
                <option key={worshipSet.id} value={worshipSet.id}>
                  {formatServiceDate(worshipSet.service_date)} · {worshipSet.title}
                </option>
              ))}
            </select>
          </label>
          <button className="text-button" onClick={() => setViewMode("builder")} type="button">
            Back to builder
          </button>
        </div>
        <MusicianLiveView plan={plan} songs={songs} />
      </section>
    );
  }

  return (
    <section className="worship-builder" aria-label="Worship builder">
      <aside className="worship-song-browser">
        <div className="worship-panel-heading">
          <div>
            <p className="eyebrow">Library</p>
            <h2>Songs</h2>
          </div>
        </div>
        <input
          aria-label="Search songs"
          className="search-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search songs"
          value={query}
        />
        <div className="worship-song-list">
          {filteredSongs.map((song) => (
            <button
              className="song-library-row"
              disabled={!canEditPlan || !plan}
              key={song.id}
              onClick={() => void addSong(song)}
              title={canEditPlan ? `Add ${song.title}` : "Ask a worship leader to edit the worship set"}
              type="button"
            >
              <span>
                <strong>{song.title}</strong>
                <small>{song.author ?? "Unknown author"}</small>
              </span>
              <em>{songStatus(song)}</em>
              <ListPlus size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      </aside>

      <main className="worship-set-builder">
        <div className="worship-set-toolbar">
          <label>
            Worship Set
            <select
              disabled={loading}
              onChange={(event) => void selectPlan(event.target.value)}
              value={selectedPlanId}
            >
              {sortedPlans.map((worshipSet) => (
                <option key={worshipSet.id} value={worshipSet.id}>
                  {formatServiceDate(worshipSet.service_date)} · {worshipSet.title}
                </option>
              ))}
            </select>
          </label>
          <button className="text-button icon-text-button" onClick={openSetPicker} type="button">
            <CalendarDays size={16} aria-hidden="true" />
            Sets
          </button>
          <div className="worship-set-summary">
            <strong>{worshipItems.length}</strong>
            <span>worship songs</span>
          </div>
          <button className="text-button" disabled={!plan || !canEditPlan || suggesting} onClick={() => void suggestWorshipSet()} type="button">
            {suggesting ? "Suggesting..." : "Suggest Set"}
          </button>
          <button className="text-button" disabled={!canEditPlan} onClick={() => setHistoryImportOpen(true)} type="button">
            History Import
          </button>
          <button className="primary-button icon-text-button" disabled={!plan} onClick={() => setViewMode("live")} type="button">
            <MonitorUp size={16} aria-hidden="true" />
            Live View
          </button>
        </div>

        {message ? <p className="form-message">{message}</p> : null}

        <div className="worship-set-layout">
          <section className="worship-set-list" aria-label="Worship set">
            <div className="worship-panel-heading">
              <div>
                <p className="eyebrow">Set</p>
                <h2>{plan?.title ?? "No worship set selected"}</h2>
              </div>
            </div>
            <div className="worship-section-list" ref={setListRef}>
              {worshipItems.map((item, index) => {
                const song = songs.find((candidate) => candidate.id === item.song_id);
                return (
                  <article
                    className={`worship-set-item ${selectedItemId === item.id ? "is-selected" : ""}`}
                    key={item.id}
                    onClick={() => setSelectedItemId(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedItemId(item.id);
                      }
                    }}
                    ref={(element) => {
                      setItemRefs.current[item.id] = element;
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{song ? compactSongTitle(song) : item.title}</strong>
                      <small>{selectedItemId === item.id ? "insert next song after this" : songStatus(song)}</small>
                    </div>
                    <div className="worship-set-actions" onClick={(event) => event.stopPropagation()}>
                      <button
                        aria-label={`Move ${item.title} up`}
                        className="section-icon-button"
                        disabled={!canEditPlan || index === 0}
                        onClick={() => void moveSong(item, -1)}
                        type="button"
                      >
                        <ChevronUp size={14} aria-hidden="true" />
                      </button>
                      <button
                        aria-label={`Move ${item.title} down`}
                        className="section-icon-button"
                        disabled={!canEditPlan || index === worshipItems.length - 1}
                        onClick={() => void moveSong(item, 1)}
                        type="button"
                      >
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                      <button
                        aria-label={`Remove ${item.title}`}
                        className="section-icon-button section-remove-button"
                        disabled={!canEditPlan}
                        onClick={() => void removeSong(item)}
                        type="button"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                );
              })}
              {!worshipItems.length ? (
                <p className="empty-state compact-empty">
                  <Music2 size={18} aria-hidden="true" />
                  Add songs from the library to build this worship set.
                </p>
              ) : null}
            </div>
          </section>

          <section className="worship-slide-review" aria-label="Worship song slides" ref={slideReviewRef}>
            {worshipSections.map((section) => (
              <div
                className={`section-slide-group ${selectedItemId === section.id ? "is-selected" : ""}`}
                key={section.id}
                ref={(element) => {
                  slideGroupRefs.current[section.id] = element;
                }}
              >
                <button className={`section-jump type-song readonly`} onClick={() => setSelectedItemId(section.id)} type="button">
                  <span>{section.itemType}</span>
                  <strong>{section.title}</strong>
                </button>
                <div className="section-slide-list worship-slide-list">
                  {section.slides.map((slide, index) => (
                    <button
                      className="slide-tile preview-tile type-song readonly"
                      key={slide.id}
                      onClick={() => setSelectedItemId(section.id)}
                      type="button"
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div className="mini-slide-surface stage-theme-light">
                        <AutoFitSlideText
                          className="fit-slide-text-compact"
                          maxFontSize={compactFontCap}
                          text={slide.text || "No lyrics"}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </div>
      </main>

      {setPickerOpen ? (
        <div className="app-dialog-backdrop" role="presentation" onMouseDown={() => setSetPickerOpen(false)}>
          <section
            className="app-dialog app-dialog-wide service-picker-dialog worship-set-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="worship-set-picker-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">Calendar</p>
                <h2 id="worship-set-picker-title">Worship Sets</h2>
              </div>
              <button className="text-button" onClick={() => setSetPickerOpen(false)} type="button">
                Close
              </button>
            </div>

            <div className="service-picker-grid">
              <section className="service-picker-panel service-calendar-panel" aria-label="Worship set calendar">
                <div className="service-calendar-heading">
                  <button
                    className="text-button"
                    onClick={() => {
                      const [year, month] = setCalendarMonth.split("-").map(Number);
                      setSetCalendarMonth(monthInputFromDate(new Date(year, month - 2, 1)));
                    }}
                    type="button"
                    aria-label="Previous month"
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <strong>
                    {new Date(`${setCalendarMonth}-01T00:00:00`).toLocaleDateString(undefined, {
                      month: "long",
                      year: "numeric",
                    })}
                  </strong>
                  <button
                    className="text-button"
                    onClick={() => {
                      const [year, month] = setCalendarMonth.split("-").map(Number);
                      setSetCalendarMonth(monthInputFromDate(new Date(year, month, 1)));
                    }}
                    type="button"
                    aria-label="Next month"
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
                <div className="service-calendar-grid">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                    <span className="service-calendar-weekday" key={day}>{day}</span>
                  ))}
                  {calendarDays.map((day) => {
                    const existing = worshipSetsByDate.get(day.key);
                    return (
                      <button
                        className={`service-calendar-day ${existing ? "has-service" : ""} ${setDraftDate === day.key ? "is-selected" : ""} ${
                          day.muted ? "is-muted" : ""
                        }`}
                        key={day.key}
                        onClick={() => chooseSetDate(day.key)}
                        title={existing ? `Open ${existing.title}` : `Create ${suggestedWorshipSetTitle(day.key)}`}
                        type="button"
                      >
                        <span>{day.date.getDate()}</span>
                        {existing ? <small>{existing.title}</small> : null}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="service-picker-panel service-list-panel" aria-label="Existing worship sets">
                <div className="service-panel-heading">
                  <h3>Existing Sets</h3>
                  <button className="text-button compact-button" onClick={() => chooseSetDate(dateInputFromIso(new Date().toISOString()))} type="button">
                    New
                  </button>
                </div>
                <div className="stack-list compact service-date-list">
                  {sortedPlans.map((worshipSet) => (
                    <button
                      className={`stack-row ${setDraftPlanId === worshipSet.id ? "selected" : ""}`}
                      key={worshipSet.id}
                      onClick={() => {
                        setSetDraftPlanId(worshipSet.id);
                        setSetDraftDate(dateInputFromIso(worshipSet.service_date));
                        setSetDraftTitle(worshipSet.title);
                        setSetCalendarMonth(dateInputFromIso(worshipSet.service_date).slice(0, 7));
                      }}
                      type="button"
                    >
                      <strong>{formatServiceDate(worshipSet.service_date)}</strong>
                      <span>
                        {worshipSet.title} · {worshipSet.item_count} song{worshipSet.item_count === 1 ? "" : "s"}
                      </span>
                    </button>
                  ))}
                  {!sortedPlans.length ? <p className="search-empty">No worship sets yet.</p> : null}
                </div>
              </section>

              <section className="service-picker-panel service-edit-panel" aria-label="Selected worship set">
                <div className="service-panel-heading">
                  <h3>{setDraftPlanId ? "Edit Set" : "New Set"}</h3>
                  {setDraftPlanId ? (
                    <button
                      className="text-button compact-button"
                      onClick={() => {
                        setSetDraftPlanId(null);
                        setSetDraftTitle(suggestedWorshipSetTitle(setDraftDate));
                      }}
                      type="button"
                    >
                      Deselect
                    </button>
                  ) : null}
                </div>
                <div className="form-grid single-column">
                  <label>
                    Date
                    <input
                      onChange={(event) => {
                        const nextDate = event.target.value;
                        setSetDraftDate(nextDate);
                        setSetCalendarMonth(nextDate.slice(0, 7) || setCalendarMonth);
                      }}
                      type="date"
                      value={setDraftDate}
                    />
                  </label>
                  <label>
                    Title
                    <input
                      onChange={(event) => setSetDraftTitle(event.target.value)}
                      placeholder={suggestedWorshipSetTitle(setDraftDate)}
                      type="text"
                      value={setDraftTitle}
                    />
                  </label>
                </div>
                <div className="action-row">
                  <button className="primary-button" disabled={!canEditPlan} onClick={() => void openDraftWorshipSet()} type="button">
                    {setDraftPlanId ? "Open Set" : "Create & Open"}
                  </button>
                  <button className="text-button" disabled={!canEditPlan} onClick={() => void saveWorshipSetDraft(false)} type="button">
                    {setDraftPlanId ? "Save Changes" : "Create Set"}
                  </button>
                </div>
                {setDraftPlanId && canDeletePlan ? (
                  <div className="service-picker-danger">
                    <p className="muted-copy">Archive this worship set if it was created by mistake.</p>
                    <button className="danger-button" onClick={() => void archiveSelectedWorshipSet()} type="button">
                      Archive Set
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          </section>
        </div>
      ) : null}
      {historyImportOpen ? (
        <div className="app-dialog-backdrop" role="presentation" onMouseDown={() => setHistoryImportOpen(false)}>
          <section
            aria-labelledby="worship-history-import-title"
            className="app-dialog app-dialog-wide"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">History</p>
                <h2 id="worship-history-import-title">Import Worship Sets</h2>
              </div>
              <button className="text-button" onClick={() => setHistoryImportOpen(false)} type="button">
                Close
              </button>
            </div>
            <p className="field-help">Searches {WORSHIP_HISTORY_FOLDER} and matches slide text against songs already in the library.</p>
            <div className="dialog-form-grid">
              <label>
                Search
                <input
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="May 2024, Easter, or leave blank"
                  value={historySearch}
                />
              </label>
              <button className="primary-button" disabled={historyLoading} onClick={() => void searchHistoryDecks()} type="button">
                {historyLoading ? "Searching..." : "Search Folder"}
              </button>
            </div>
            {historyFiles.length ? (
              <div className="action-row">
                <button
                  className="text-button"
                  disabled={historyBatchImporting || historyLoading}
                  onClick={() => void importHistoryBatch(2)}
                  type="button"
                >
                  {historyBatchImporting ? "Importing..." : "Test Import First 2"}
                </button>
                <button
                  className="primary-button"
                  disabled={historyBatchImporting || historyLoading}
                  onClick={() => void importHistoryBatch()}
                  type="button"
                >
                  {historyBatchImporting ? "Importing..." : `Import All ${historyFiles.length}`}
                </button>
              </div>
            ) : null}
            <div className="two-column-review">
              <div className="stack-list compact">
                {historyFiles.map((file) => (
                  <button
                    className={`stack-row ${historyPreview?.file.id === file.id ? "selected" : ""}`}
                    key={file.id}
                    onClick={() => void previewHistoryDeck(file)}
                    type="button"
                  >
                    <strong>{file.name}</strong>
                    <span>{file.modified_time ? formatServiceDate(file.modified_time) : file.source_kind}</span>
                  </button>
                ))}
                {!historyFiles.length ? <p className="search-empty">No history decks loaded yet.</p> : null}
              </div>
              <div className="subsection-panel">
                {historyPreview ? (
                  <>
                    <div className="empty-state import-summary">
                      <strong>{historyPreview.file.name}</strong>
                      <span>Date: {historyPreview.date}</span>
                      <span>{historyPreview.deck.slide_count} parsed slides</span>
                      <span>{historyPreview.matchedSongs.length} matched song{historyPreview.matchedSongs.length === 1 ? "" : "s"}</span>
                      <span>{historyPreview.missingSongs.length} new song candidate{historyPreview.missingSongs.length === 1 ? "" : "s"}</span>
                    </div>
                    {historyPreview.missingSongs.length ? (
                      <>
                        <p className="eyebrow">Will Create Songs</p>
                        <div className="stack-list compact">
                          {historyPreview.missingSongs.map((missing) => (
                            <div className="stack-row readonly" key={`${missing.firstSlideIndex}-${missing.title}`}>
                              <strong>{missing.title}</strong>
                              <span>
                                Slides {missing.firstSlideIndex}-{missing.lastSlideIndex}
                                {missing.sequence ? ` · ${missing.sequence}` : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                    <p className="eyebrow">Matched Library Songs</p>
                    <div className="stack-list compact">
                      {historyPreview.matchedSongs.map((match) => (
                        <div className="stack-row readonly" key={match.song.id}>
                          <strong>{match.song.title}</strong>
                          <span>First seen on slide {match.firstSlideIndex}</span>
                        </div>
                      ))}
                    </div>
                    <div className="action-row">
                      <button
                        className="primary-button"
                        disabled={historyImporting || (!historyPreview.matchedSongs.length && !historyPreview.missingSongs.length)}
                        onClick={() => void importHistoryPreview()}
                        type="button"
                      >
                        {historyImporting ? "Importing..." : "Create Worship Set"}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="search-empty">Select a deck to preview matched songs.</p>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
