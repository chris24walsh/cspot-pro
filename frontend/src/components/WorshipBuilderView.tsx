import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, History, MonitorUp, Music2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  createSong,
  createPlanHistoryEntry,
  createPlanItem,
  createPlan,
  deletePlan,
  deletePlanItem,
  deleteSong,
  getPlan,
  getPlanHistory,
  getPlanTypes,
  getPlans,
  getSongs,
  getWorshipSetSuggestion,
  parseGoogleDriveDeck,
  searchGoogleDriveFiles,
  updatePlan,
  updatePlanItem,
  type GoogleDriveFile,
  type PlanHistoryEntry,
  type PlanHistorySnapshotItem,
  type ParsedSlideDeck,
  type PlanDetail,
  type PlanItem,
  type PlanSummary,
  type PlanType,
  type Song,
  type WorshipSuggestedSong,
} from "../api";
import { buildPresentationSections, suggestSlideGroupFontCap } from "../presentation";
import { showToast } from "../toast";
import { analyzeImportedSongSlides, buildLyricsFromSections, canonicalizeWorshipLyrics } from "../worshipText";
import { dateKey, isWorshipSetPlan, worshipSetType } from "../worshipSets";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { MusicianLiveView } from "./MusicianLiveView";
import { SongEditorDialog } from "./SongEditorDialog";

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
  canAccessAdminTools: boolean;
  canArchiveSong: boolean;
  canCreateSong: boolean;
  canDeletePlan: boolean;
  canEditSong: boolean;
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

function nextSundayDateInput() {
  const date = new Date();
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7 || 7));
  date.setHours(10, 30, 0, 0);
  return dateInputFromIso(date.toISOString());
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
    return ((selectedSequence + nextSequence) / 2).toFixed(2);
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
    .replace(/\bsav\s+iou?r\b/gi, "saviour")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\s+(?:lyrics|song|worship)\s*$/i, "")
    .replace(/\s*[-–—]\s*(?:lyrics|song|worship)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function correctedDetectedSongTitle(value: string) {
  const normalized = normalizedTitle(value);
  if (normalized === "you are saviour" || normalized === "you are savior") {
    return "Lord Take Up Your Holy Throne";
  }
  return value;
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
    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
    return cleaned.length >= 4 && cleaned.length <= 70 && wordCount <= 7 && !/[.;:,]$/.test(cleaned);
  });

  return candidate ? correctedDetectedSongTitle(cleanSlideTitle(candidate)) : "";
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
  const titleLineCount = lines.filter((line) => {
    const cleaned = cleanSlideTitle(line);
    return cleaned.length >= 4 && cleaned.split(/\s+/).filter(Boolean).length <= 7 && !/[.;:,]$/.test(cleaned);
  }).length;
  return titleLineCount > 0 && lyricLookingLines.length === 0;
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
    const lyrics = canonicalizeWorshipLyrics(buildLyricsFromSections(analysis.sections) || analysis.lyrics, analysis.sequence);
    const lyricWordCount = lyrics.split(/\s+/).filter(Boolean).length;
    if (!lyrics.trim() || (rangeSlides.length <= 2 && lyricWordCount < 12)) {
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

export function WorshipBuilderView({ canAccessAdminTools, canArchiveSong, canCreateSong, canDeletePlan, canEditSong, canEditPlan }: WorshipBuilderViewProps) {
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
  const [suggestionReviewOpen, setSuggestionReviewOpen] = useState(false);
  const [suggestedSongs, setSuggestedSongs] = useState<WorshipSuggestedSong[]>([]);
  const [includedSuggestionIds, setIncludedSuggestionIds] = useState<Set<string>>(new Set());
  const [suggestionRefreshing, setSuggestionRefreshing] = useState(false);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [songEditorMode, setSongEditorMode] = useState<"create" | "edit">("edit");
  const [editHistory, setEditHistory] = useState<PlanHistoryEntry[]>([]);
  const [editHistoryIndex, setEditHistoryIndex] = useState(0);
  const [editHistoryOpen, setEditHistoryOpen] = useState(false);
  const [editHistoryApplying, setEditHistoryApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"builder" | "live">("builder");
  const [mobileBuilderPane, setMobileBuilderPane] = useState<"library" | "set">("library");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
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

  function nextWorshipSetPlanId(planList: PlanSummary[]) {
    const todayKey = dateInputFromIso(new Date().toISOString());
    const sundayKey = nextSundayDateInput();
    const newestFirst = [...planList].sort((left, right) => {
      const leftTime = new Date(left.service_date).getTime();
      const rightTime = new Date(right.service_date).getTime();
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    });
    const nextSundayPlan = planList.find((candidate) => dateInputFromIso(candidate.service_date) === sundayKey);
    const upcoming = [...planList]
      .filter((candidate) => dateInputFromIso(candidate.service_date) >= todayKey)
      .sort((left, right) => new Date(left.service_date).getTime() - new Date(right.service_date).getTime());
    return nextSundayPlan?.id ?? upcoming[0]?.id ?? newestFirst[0]?.id ?? "";
  }

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
        return `${song.title} ${song.author ?? ""} ${song.alternate_title ?? ""} ${song.lyrics ?? ""}`.toLowerCase().includes(normalized);
      })
      .slice(0, 80);
  }, [query, songs]);

  function snapshotWorshipItems(items: PlanItem[]): PlanHistorySnapshotItem[] {
    return sortedWorshipItems(items).map((item) => ({
      id: item.id,
      item_type: item.item_type,
      sequence: item.sequence,
      title: item.title,
      comment: item.comment,
      key_signature: item.key_signature,
      song_id: item.song_id,
    }));
  }

  function formatHistoryTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleString(undefined, { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short" });
  }

  async function recordSetHistory(planId: string, label: string, before: PlanHistorySnapshotItem[], after: PlanHistorySnapshotItem[], affected: string) {
    try {
      const entry = await createPlanHistoryEntry(planId, { label, before, after, affected, change_type: "plan_items", restorable: true });
      setEditHistory((current) => [...current, entry]);
      setEditHistoryIndex((current) => current + 1);
    } catch (error) {
      setMessage(error instanceof Error ? `Saved change, but history was not recorded: ${error.message}` : "Saved change, but history was not recorded.");
    }
  }

  async function applyWorshipSetSnapshot(targetPlanId: string, targetItems: PlanHistorySnapshotItem[]) {
    const latestPlan = await getPlan(targetPlanId);
    const currentItems = sortedWorshipItems(latestPlan.items);
    const targetById = new Map(targetItems.map((item) => [item.id, item]));
    const targetBySongId = new Map(targetItems.flatMap((item) => (item.song_id ? [[item.song_id, item] as const] : [])));

    const matchedTargetIds = new Set<string>();
    const matchedCurrentIds = new Set<string>();

    for (const current of currentItems) {
      const target = targetById.get(current.id) ?? (current.song_id ? targetBySongId.get(current.song_id) : undefined);
      if (!target) {
        await deletePlanItem(current.id);
        continue;
      }
      matchedTargetIds.add(target.id);
      matchedCurrentIds.add(current.id);
      await updatePlanItem(current.id, {
        item_type: target.item_type,
        sequence: target.sequence,
        title: target.title,
        comment: target.comment,
        key_signature: target.key_signature,
        song_id: target.song_id,
      });
    }

    for (const target of targetItems) {
      if (matchedTargetIds.has(target.id)) {
        continue;
      }
      const currentBySong = target.song_id ? currentItems.find((item) => item.song_id === target.song_id && !matchedCurrentIds.has(item.id)) : undefined;
      if (currentBySong) {
        matchedCurrentIds.add(currentBySong.id);
        matchedTargetIds.add(target.id);
        await updatePlanItem(currentBySong.id, {
          item_type: target.item_type,
          sequence: target.sequence,
          title: target.title,
          comment: target.comment,
          key_signature: target.key_signature,
          song_id: target.song_id,
        });
        continue;
      }
      await createPlanItem(targetPlanId, {
        item_type: target.item_type,
        sequence: target.sequence,
        title: target.title,
        comment: target.comment,
        key_signature: target.key_signature,
        song_id: target.song_id,
      });
    }

    await load(targetPlanId);
  }

  async function jumpSetHistory(targetIndex: number) {
    if (!plan || editHistoryApplying || targetIndex === editHistoryIndex) {
      return;
    }
    const restorableHistory = editHistory.filter((entry) => entry.restorable);
    const boundedIndex = Math.max(0, Math.min(restorableHistory.length, targetIndex));
    setEditHistoryApplying(true);
    try {
      const entry = restorableHistory[boundedIndex < editHistoryIndex ? boundedIndex : boundedIndex - 1];
      const targetSnapshot = boundedIndex < editHistoryIndex ? entry?.before : entry?.after;
      if (!targetSnapshot) {
        return;
      }
      const before = snapshotWorshipItems((await getPlan(plan.id)).items);
      await applyWorshipSetSnapshot(plan.id, targetSnapshot);
      await recordSetHistory(
        plan.id,
        boundedIndex < editHistoryIndex ? `reverting "${entry.label}"` : `restoring "${entry.label}"`,
        before,
        targetSnapshot,
        entry.affected ?? entry.label,
      );
      setMessage(boundedIndex < editHistoryIndex ? `Reverted ${entry.label}.` : `Restored ${entry.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update worship set history.");
    } finally {
      setEditHistoryApplying(false);
    }
  }

  async function openEditHistory() {
    if (!plan || editHistoryApplying) {
      return;
    }
    if (editHistoryOpen) {
      setEditHistoryOpen(false);
      return;
    }
    try {
      const nextHistory = await getPlanHistory(plan.id);
      setEditHistory(nextHistory);
      setEditHistoryIndex(nextHistory.filter((entry) => entry.restorable).length);
      setEditHistoryOpen(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load worship set history.");
    }
  }

  async function load(targetPlanId?: string) {
    setLoading(true);
    try {
      const [nextPlans, nextSongs, nextPlanTypes] = await Promise.all([getPlans(), getSongs(), getPlanTypes()]);
      const nextWorshipPlans = nextPlans.filter(isWorshipSetPlan);
      const requestedPlanId =
        targetPlanId !== undefined
          ? targetPlanId
          : sessionStorage.getItem(SELECTED_WORSHIP_SET_SESSION_KEY) || selectedPlanId;
      const requestedPlan = nextWorshipPlans.find((candidate) => candidate.id === requestedPlanId);
      const requestedPlanIsUsable =
        targetPlanId !== undefined || (requestedPlan && dateInputFromIso(requestedPlan.service_date) >= dateInputFromIso(new Date().toISOString()));
      const resolvedPlanId = requestedPlan && requestedPlanIsUsable
        ? requestedPlanId
        : nextWorshipSetPlanId(nextWorshipPlans);
      const nextPlan = resolvedPlanId ? await getPlan(resolvedPlanId) : null;
      const nextHistory = resolvedPlanId ? await getPlanHistory(resolvedPlanId) : [];
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
      setEditHistory(nextHistory);
      setEditHistoryIndex(nextHistory.filter((entry) => entry.restorable).length);
      setEditHistoryOpen(false);
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
    setTopbarSlot(document.getElementById("workspace-topbar-slot"));
  }, []);

  useEffect(() => {
    if (!message) {
      return;
    }
    showToast(message);
    const timer = window.setTimeout(() => setMessage(null), 2600);
    return () => window.clearTimeout(timer);
  }, [message]);

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

  async function openSetDate(dateInput: string) {
    const existing = worshipSetsByDate.get(dateInput);
    if (existing) {
      await selectPlan(existing.id);
      setSetPickerOpen(false);
      return;
    }
    chooseSetDate(dateInput);
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
      const targetPlanId = plan.id;
      const before = snapshotWorshipItems(plan.items);
      const createdItem = await createPlanItem(targetPlanId, {
        item_type: "song",
        sequence: sequenceAfterSelected(plan.items, selectedItemId),
        title: song.title,
        comment: null,
        key_signature: null,
        song_id: song.id,
      });
      await recordSetHistory(targetPlanId, `adding "${song.title}"`, before, snapshotWorshipItems([...plan.items, createdItem]), song.title);
      await load(targetPlanId);
      setMobileBuilderPane("set");
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
      const existingSongIds = new Set(worshipItems.flatMap((item) => (item.song_id ? [item.song_id] : [])));
      const songsToAdd = suggestion.songs.filter((entry) => !existingSongIds.has(entry.song.id));
      setSuggestedSongs(songsToAdd);
      setIncludedSuggestionIds(new Set(songsToAdd.map((entry) => entry.song.id)));
      setSuggestionReviewOpen(true);
      setMessage(songsToAdd.length ? "Review the suggested worship set before adding it." : "No new suggestion found outside the songs already in this set.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not suggest a worship set.");
    } finally {
      setSuggesting(false);
    }
  }

  async function suggestionReplacements(limit: number, blockedSongIds: Set<string>) {
    const replacements: WorshipSuggestedSong[] = [];
    let attempts = 0;
    while (replacements.length < limit && attempts < 4) {
      attempts += 1;
      const suggestion = await getWorshipSetSuggestion(Math.max(8, limit + blockedSongIds.size));
      for (const entry of suggestion.songs) {
        if (blockedSongIds.has(entry.song.id) || replacements.some((candidate) => candidate.song.id === entry.song.id)) {
          continue;
        }
        replacements.push(entry);
        blockedSongIds.add(entry.song.id);
        if (replacements.length >= limit) {
          break;
        }
      }
    }
    return replacements;
  }

  async function regenerateSuggestions(mode: "unchecked" | "all" = "unchecked") {
    if (!plan || !canEditPlan || suggestionRefreshing) {
      return;
    }

    const indexesToReplace =
      mode === "all"
        ? suggestedSongs.map((_entry, index) => index)
        : suggestedSongs.flatMap((entry, index) => (includedSuggestionIds.has(entry.song.id) ? [] : [index]));

    if (!indexesToReplace.length) {
      setMessage("Untick songs you want regenerated, or swap a single row.");
      return;
    }

    setSuggestionRefreshing(true);
    try {
      const existingSongIds = new Set(worshipItems.flatMap((item) => (item.song_id ? [item.song_id] : [])));
      const keptSongIds = new Set(
        suggestedSongs
          .filter((_entry, index) => !indexesToReplace.includes(index))
          .map((entry) => entry.song.id),
      );
      const replacements = await suggestionReplacements(indexesToReplace.length, new Set([...existingSongIds, ...keptSongIds]));
      if (!replacements.length) {
        setMessage("No fresh suggestions found outside the current list.");
        return;
      }

      setSuggestedSongs((current) => {
        const next = [...current];
        indexesToReplace.forEach((targetIndex, replacementIndex) => {
          if (replacements[replacementIndex]) {
            next[targetIndex] = replacements[replacementIndex];
          }
        });
        return next;
      });
      setIncludedSuggestionIds((current) => {
        const next = new Set(current);
        indexesToReplace.forEach((targetIndex) => {
          const oldEntry = suggestedSongs[targetIndex];
          if (oldEntry) {
            next.delete(oldEntry.song.id);
          }
        });
        replacements.forEach((entry) => next.add(entry.song.id));
        return next;
      });
      setMessage(`Regenerated ${replacements.length} suggestion${replacements.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not regenerate suggestions.");
    } finally {
      setSuggestionRefreshing(false);
    }
  }

  async function swapSuggestedSong(index: number) {
    if (!plan || !canEditPlan || suggestionRefreshing) {
      return;
    }

    setSuggestionRefreshing(true);
    try {
      const existingSongIds = new Set(worshipItems.flatMap((item) => (item.song_id ? [item.song_id] : [])));
      const otherSuggestedIds = new Set(suggestedSongs.filter((_entry, entryIndex) => entryIndex !== index).map((entry) => entry.song.id));
      const replacements = await suggestionReplacements(1, new Set([...existingSongIds, ...otherSuggestedIds]));
      const replacement = replacements[0];
      if (!replacement) {
        setMessage("No fresh swap found for that row.");
        return;
      }

      const oldEntry = suggestedSongs[index];
      setSuggestedSongs((current) => current.map((entry, entryIndex) => (entryIndex === index ? replacement : entry)));
      setIncludedSuggestionIds((current) => {
        const next = new Set(current);
        if (oldEntry) {
          next.delete(oldEntry.song.id);
        }
        next.add(replacement.song.id);
        return next;
      });
      setMessage(`Swapped in "${replacement.song.title}".`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not swap that suggestion.");
    } finally {
      setSuggestionRefreshing(false);
    }
  }

  async function addReviewedSuggestions() {
    if (!plan || !canEditPlan || !suggestedSongs.length) {
      return;
    }

    try {
      const targetPlanId = plan.id;
      const before = snapshotWorshipItems(plan.items);
      const createdItems: PlanItem[] = [];
      const songsToAdd = suggestedSongs.filter((entry) => includedSuggestionIds.has(entry.song.id));
      if (!songsToAdd.length) {
        setSuggestionReviewOpen(false);
        setSuggestedSongs([]);
        setIncludedSuggestionIds(new Set());
        setMessage("No suggestions added.");
        return;
      }
      let sequence = Number.parseFloat(sequenceAfterSelected(plan.items, selectedItemId));
      for (const entry of songsToAdd) {
        const createdItem = await createPlanItem(targetPlanId, {
          item_type: "song",
          sequence: sequence.toFixed(2),
          title: entry.song.title,
          comment: `${entry.slot}: ${entry.reason}`,
          key_signature: null,
          song_id: entry.song.id,
        });
        createdItems.push(createdItem);
        sequence += 1;
      }
      setSuggestionReviewOpen(false);
      setSuggestedSongs([]);
      setIncludedSuggestionIds(new Set());
      setMobileBuilderPane("set");
      await recordSetHistory(
        targetPlanId,
        "adding suggested songs",
        before,
        snapshotWorshipItems([...plan.items, ...createdItems]),
        `${songsToAdd.length} song${songsToAdd.length === 1 ? "" : "s"} added`,
      );
      await load(targetPlanId);
      setMessage(`Added ${songsToAdd.length} suggested song${songsToAdd.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add suggested songs.");
    }
  }

  function moveSuggestedSong(index: number, delta: -1 | 1) {
    setSuggestedSongs((current) => {
      const targetIndex = index + delta;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  function toggleSuggestedSong(songId: string) {
    setIncludedSuggestionIds((current) => {
      const next = new Set(current);
      if (next.has(songId)) {
        next.delete(songId);
      } else {
        next.add(songId);
      }
      return next;
    });
  }

  function openSongEditor(song: Song) {
    setSongEditorMode("edit");
    setEditingSong(song);
  }

  function openNewSongEditor() {
    setSongEditorMode("create");
    setEditingSong({
      alternate_title: null,
      author: null,
      book_reference: null,
      ccli_number: null,
      chords: null,
      energy: null,
      external_link: null,
      id: "__new-song__",
      license: null,
      lyrics: null,
      lyrics_status: "missing",
      sequence: null,
      tempo: null,
      theme_tags: null,
      title: "",
      worship_role: "any",
      youtube_id: null,
    });
  }

  async function archiveLibrarySong(song: Song) {
    if (!canArchiveSong || songEditorMode !== "edit") {
      return;
    }

    try {
      await deleteSong(song.id);
      setEditingSong(null);
      await load(plan?.id);
      setMessage(`Archived "${song.title}".`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not archive song.");
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
      const targetPlanId = plan?.id;
      const before = snapshotWorshipItems(plan?.items ?? worshipItems);
      await deletePlanItem(item.id);
      if (targetPlanId) {
        await recordSetHistory(targetPlanId, `removing "${item.title}"`, before, before.filter((snapshotItem) => snapshotItem.id !== item.id), item.title);
        await load(targetPlanId);
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
      const targetPlanId = plan.id;
      const before = snapshotWorshipItems(plan.items);
      await Promise.all([
        updatePlanItem(item.id, { sequence: target.sequence }),
        updatePlanItem(target.id, { sequence: item.sequence }),
      ]);
      await recordSetHistory(
        targetPlanId,
        `moving "${item.title}"`,
        before,
        before.map((snapshotItem) => {
          if (snapshotItem.id === item.id) {
            return { ...snapshotItem, sequence: target.sequence };
          }
          if (snapshotItem.id === target.id) {
            return { ...snapshotItem, sequence: item.sequence };
          }
          return snapshotItem;
        }),
        item.title,
      );
      await load(targetPlanId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reorder worship set.");
    }
  }

  if (viewMode === "live") {
    return (
      <section className="worship-live-shell" aria-label="Musician live worship">
        <div className="worship-live-topbar">
          <span>{plan ? `${formatServiceDate(plan.service_date)} · ${plan.title}` : "No worship set selected"}</span>
          <button className="text-button" onClick={() => setViewMode("builder")} type="button">
            Back to builder
          </button>
        </div>
        <MusicianLiveView plan={plan} songs={songs} />
      </section>
    );
  }

  return (
    <section className={`worship-builder worship-builder-pane-${mobileBuilderPane}`} aria-label="Worship builder">
      {topbarSlot
          ? createPortal(
            <div className="presentation-topbar-tools worship-topbar-tools">
              <div className="worship-set-picker-tools">
                <button
                  className="text-button topbar-service-button"
                  disabled={loading}
                  onClick={openSetPicker}
                  title="Choose or create a worship set"
                  type="button"
                >
                  <CalendarDays size={16} aria-hidden="true" />
                  <span>{plan ? formatServiceDate(plan.service_date) : "Choose worship set"}</span>
                </button>
                <button
                  aria-expanded={editHistoryOpen}
                  aria-label="Open worship set edit history"
                  className="section-icon-button worship-history-button"
                  disabled={!plan || editHistoryApplying}
                  onClick={() => void openEditHistory()}
                  title="Worship set edit history"
                  type="button"
                >
                  <History size={15} aria-hidden="true" />
                </button>
                {editHistoryOpen ? (
                  <section className="worship-history-popover" aria-label="Worship set edit history">
                    <div className="worship-history-popover-heading">
                      <strong>Edit History</strong>
                      <button className="section-icon-button" onClick={() => setEditHistoryOpen(false)} type="button" aria-label="Close edit history">
                        x
                      </button>
                    </div>
                    <div className="worship-history-list">
                      <button
                        className={`worship-history-row ${editHistoryIndex === 0 ? "active" : ""}`}
                        disabled={editHistoryApplying}
                        onClick={() => void jumpSetHistory(0)}
                        type="button"
                      >
                        <span>Original set</span>
                        <small>{editHistoryIndex === 0 ? "Current" : "Past"}</small>
                      </button>
                      {(() => {
                        let restorableEntryIndex = 0;
                        return editHistory.map((entry) => {
                          const entryIndex = entry.restorable ? ++restorableEntryIndex : null;
                          const relation =
                            entryIndex === null
                              ? "Audit"
                              : entryIndex < editHistoryIndex
                                ? "Past"
                                : entryIndex > editHistoryIndex
                                  ? "Future"
                                  : "Current";
                          const meta = [relation, entry.actor_name, formatHistoryTime(entry.created_at)].filter(Boolean).join(" · ");
                          return (
                            <button
                              className={`worship-history-row ${entryIndex === editHistoryIndex ? "active" : ""} ${entry.restorable ? "" : "is-audit"}`}
                              disabled={editHistoryApplying || !entry.restorable || entryIndex === null}
                              key={entry.id}
                              onClick={() => {
                                if (entryIndex !== null) {
                                  void jumpSetHistory(entryIndex);
                                }
                              }}
                              type="button"
                            >
                              <span>{entry.label}</span>
                              {entry.affected ? <em>{entry.affected}</em> : null}
                              <small>{meta}</small>
                            </button>
                          );
                        });
                      })()}
                    </div>
                  </section>
                ) : null}
              </div>
              <div className="worship-set-topbar-actions">
                <button className="text-button topbar-action-button" disabled={!plan || !canEditPlan || suggesting} onClick={() => void suggestWorshipSet()} type="button">
                  {suggesting ? "Suggesting..." : "Suggest Set"}
                </button>
                <button className="primary-button topbar-primary-button" disabled={!plan} onClick={() => setViewMode("live")} type="button">
                  <MonitorUp size={16} aria-hidden="true" />
                  Live
                </button>
              </div>
            </div>,
            topbarSlot,
          )
        : null}
      <div className="worship-mobile-pane-tabs" aria-label="Worship builder panels">
        <button
          className={mobileBuilderPane === "library" ? "active" : ""}
          onClick={() => setMobileBuilderPane("library")}
          type="button"
        >
          Library <span>{songs.length}</span>
        </button>
        <button
          className={mobileBuilderPane === "set" ? "active" : ""}
          onClick={() => setMobileBuilderPane("set")}
          type="button"
        >
          Set <span>{worshipItems.length}</span>
        </button>
      </div>

      <aside className={`worship-song-browser ${mobileBuilderPane === "library" ? "is-mobile-active" : ""}`}>
        <div className="worship-library-search-row">
          <input
            aria-label="Search songs"
            className="search-input"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search songs"
            value={query}
          />
          <button className="text-button" disabled={!canCreateSong} onClick={openNewSongEditor} type="button">
            New Song
          </button>
        </div>
        <div className="worship-song-list">
          {filteredSongs.map((song) => (
            <div
              className="song-library-row"
              key={song.id}
            >
              <button
                className="song-library-main"
                disabled={!canEditPlan || !plan}
                onClick={() => void addSong(song)}
                title={canEditPlan ? `Add ${song.title}` : "Ask a worship leader to edit the worship set"}
                type="button"
              >
                <span>
                  <strong>{song.title}</strong>
                </span>
              </button>
              <button
                aria-label={`Edit ${song.title}`}
                className="section-icon-button song-library-edit"
                disabled={!canEditSong}
                onClick={() => openSongEditor(song)}
                type="button"
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className={`worship-set-builder ${mobileBuilderPane === "set" ? "is-mobile-active" : ""}`}>
        <div className="worship-set-toolbar worship-set-toolbar-compact">
          <div>
            <p className="eyebrow">Set</p>
            <h2>{plan?.title ?? "No worship set selected"}</h2>
          </div>
          <div className="worship-set-toolbar-actions" aria-label="Worship set actions">
            <button className="text-button" disabled={!plan || !canEditPlan || suggesting} onClick={() => void suggestWorshipSet()} type="button">
              {suggesting ? "Suggesting..." : "Suggest Set"}
            </button>
            <button className="primary-button" disabled={!plan} onClick={() => setViewMode("live")} type="button">
              <MonitorUp size={16} aria-hidden="true" />
              Live
            </button>
          </div>
          <div className="worship-set-summary">
            <strong>{worshipItems.length}</strong>
            <span>worship songs</span>
          </div>
        </div>

        <div className="worship-set-layout">
          <section className="worship-set-list" aria-label="Worship set">
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
                    <div className="worship-set-item-body">
                      <strong>{song ? compactSongTitle(song) : item.title}</strong>
                      {selectedItemId === item.id ? <small>insert next song after this</small> : null}
                    </div>
                    <div className="worship-set-item-tools" onClick={(event) => event.stopPropagation()}>
                      <div className="worship-set-actions">
                        <button
                          aria-label={`Edit ${song ? song.title : item.title}`}
                          className="section-icon-button"
                          disabled={!song || !canEditSong}
                          onClick={() => {
                            if (song) {
                              openSongEditor(song);
                            }
                          }}
                          type="button"
                        >
                          <Pencil size={14} aria-hidden="true" />
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
                      <div className="worship-set-actions">
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
                      </div>
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
            {worshipSections.map((section) => {
              const sectionItem = worshipItems.find((item) => item.id === section.id);
              const sectionSong = songs.find((song) => song.id === sectionItem?.song_id);
              return (
                <div
                  className={`section-slide-group ${selectedItemId === section.id ? "is-selected" : ""}`}
                  key={section.id}
                  ref={(element) => {
                    slideGroupRefs.current[section.id] = element;
                  }}
                >
                  <div className="worship-sorter-heading">
                    <button className={`section-jump type-song readonly`} onClick={() => setSelectedItemId(section.id)} type="button">
                      <span>{section.itemType}</span>
                      <strong>{section.title}</strong>
                    </button>
                    {sectionSong ? (
                      <button
                        aria-label={`Edit ${sectionSong.title}`}
                        className="section-icon-button"
                        disabled={!canEditSong}
                        onClick={() => openSongEditor(sectionSong)}
                        type="button"
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
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
              );
            })}
          </section>
        </div>
      </main>

      {suggestionReviewOpen ? (
        <div className="app-dialog-backdrop" role="presentation" onMouseDown={() => setSuggestionReviewOpen(false)}>
          <section
            aria-labelledby="suggest-worship-set-title"
            aria-modal="true"
            className="app-dialog app-dialog-wide"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">Suggestions</p>
                <h2 id="suggest-worship-set-title">Review Worship Set</h2>
              </div>
              <button className="text-button" onClick={() => setSuggestionReviewOpen(false)} type="button">
                Close
              </button>
            </div>
            <p className="field-help">Tick songs to add. Unticked rows stay visible for comparison and are replaced when you regenerate.</p>
            <div className="suggestion-toolbar">
              <button className="text-button icon-text-button" disabled={suggestionRefreshing || !suggestedSongs.length} onClick={() => void regenerateSuggestions("unchecked")} type="button">
                <RefreshCw size={15} aria-hidden="true" />
                Regenerate Unticked
              </button>
              <button className="text-button" disabled={suggestionRefreshing || !suggestedSongs.length} onClick={() => void regenerateSuggestions("all")} type="button">
                Regenerate All
              </button>
            </div>
            <div className="stack-list compact">
              {suggestedSongs.map((entry, index) => (
                <div className={`stack-row suggestion-row ${includedSuggestionIds.has(entry.song.id) ? "" : "is-excluded"}`} key={entry.song.id}>
                  <label className="suggestion-include">
                    <input
                      checked={includedSuggestionIds.has(entry.song.id)}
                      onChange={() => toggleSuggestedSong(entry.song.id)}
                      type="checkbox"
                    />
                    <span>{includedSuggestionIds.has(entry.song.id) ? "Add" : "Skip"}</span>
                  </label>
                  <div className="suggestion-copy">
                    <strong>{entry.song.title}</strong>
                    <span>
                      {entry.slot} · {entry.reason}
                    </span>
                  </div>
                  <div className="suggestion-actions">
                    <button className="section-icon-button" disabled={suggestionRefreshing} onClick={() => void swapSuggestedSong(index)} type="button" aria-label={`Swap ${entry.song.title}`}>
                      <RefreshCw size={14} aria-hidden="true" />
                    </button>
                    <button className="section-icon-button" disabled={index === 0} onClick={() => moveSuggestedSong(index, -1)} type="button" aria-label={`Move ${entry.song.title} up`}>
                      <ChevronUp size={14} aria-hidden="true" />
                    </button>
                    <button className="section-icon-button" disabled={index === suggestedSongs.length - 1} onClick={() => moveSuggestedSong(index, 1)} type="button" aria-label={`Move ${entry.song.title} down`}>
                      <ChevronDown size={14} aria-hidden="true" />
                    </button>
                    <button
                      className="section-icon-button section-remove-button"
                      onClick={() => {
                        setSuggestedSongs((current) => current.filter((candidate) => candidate.song.id !== entry.song.id));
                        setIncludedSuggestionIds((current) => {
                          const next = new Set(current);
                          next.delete(entry.song.id);
                          return next;
                        });
                      }}
                      type="button"
                      aria-label={`Remove ${entry.song.title}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
              {!suggestedSongs.length ? <p className="search-empty">No suggestions to add.</p> : null}
            </div>
            <div className="app-dialog-actions">
              <button className="text-button" onClick={() => setSuggestionReviewOpen(false)} type="button">
                Cancel
              </button>
              <button className="primary-button" disabled={!canEditPlan || !suggestedSongs.some((entry) => includedSuggestionIds.has(entry.song.id))} onClick={() => void addReviewedSuggestions()} type="button">
                Add {suggestedSongs.filter((entry) => includedSuggestionIds.has(entry.song.id)).length || ""} Suggestions
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {editingSong ? (
        <SongEditorDialog
          canEdit={songEditorMode === "create" ? canCreateSong : canEditSong}
          mode={songEditorMode}
          onArchive={canArchiveSong ? (song) => void archiveLibrarySong(song) : undefined}
          onClose={() => setEditingSong(null)}
          onSaved={async (updated) => {
            setSongs((current) => {
              const exists = current.some((song) => song.id === updated.id);
              return exists ? current.map((song) => (song.id === updated.id ? updated : song)) : [updated, ...current];
            });
            if (plan) {
              await load(plan.id);
            }
            setMessage(`Saved "${updated.title}".`);
          }}
          song={editingSong}
        />
      ) : null}

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
                        onDoubleClick={() => void openSetDate(day.key)}
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
                      onDoubleClick={() => {
                        void selectPlan(worshipSet.id).then(() => setSetPickerOpen(false));
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
                              <span>{missing.lyrics.split(/\r?\n/).filter(Boolean).slice(0, 2).join(" / ")}</span>
                              {missing.notes.length ? <span>Check: {missing.notes.join("; ")}</span> : null}
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
