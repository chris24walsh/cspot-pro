import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, History, MonitorUp, Pause, Pencil, Play, Plus, Search, Trash2, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  ApiError,
  createPlanHistoryEntry,
  createSong,
  createPlan,
  createPlanItem,
  attachItemFile,
  deletePlan,
  getGoogleDriveStatus,
  deletePlanItem,
  getFileSlides,
  getBibleBooks,
  getBiblePassage,
  searchBible,
  getBibleVersions,
  getPlan,
  getPlans,
  getPlanTypes,
  getPresentationLiveState,
  getPlanHistory,
  getSongs,
  importGoogleDriveDeck,
  runCustomProviderSearch,
  searchGoogleDriveFiles,
  selectCustomProviderMatch,
  uploadStoredFile,
  updatePlan,
  updatePresentationLiveState,
  updatePlanItem,
  type BibleBook,
  type BibleSearchHit,
  type BibleVersion,
  type CustomProviderMatch,
  type CustomProviderSearchResult,
  type CustomProviderSelectResult,
  type PresentationLiveSyncState,
  type RenderedSlide,
  type GoogleDriveFile,
  type GoogleDriveStatus,
  type PlanDetail,
  type PlanHistoryEntry,
  type PlanItem,
  type PlanSummary,
  type PlanType,
  type Song,
} from "../api";
import {
  PRESENTATION_CHANNEL,
  PRESENTATION_OUTPUT_STATUS_KEY,
  PRESENTATION_STORAGE_KEY,
  buildPresentationSections,
  buildPresentationSlides,
  extractYouTubeId,
  presentationTypeClass,
  resolveLiveIndex,
  suggestSlideGroupFontCap,
  type PresentationSlide,
  type PresentationLiveState,
  type PresentationTheme,
} from "../presentation";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { ScaledSlideImage } from "./ScaledSlideImage";
import { SongEditorDialog } from "./SongEditorDialog";
import { showToast } from "../toast";
import { isEditableKeyboardTarget, slideKeyboardDirection, type SlideKeyboardDirection } from "../keyboardNavigation";
import { analyzeWorshipText, buildLyricsFromSections, canonicalizeWorshipLyrics } from "../worshipText";
import {
  WORSHIP_SET_ANCHOR_ITEM_TYPE,
  isWorshipSetPlan,
  matchingWorshipSetForService,
  mergeWorshipSetIntoService,
  worshipSetType,
} from "../worshipSets";

const SELECTED_SERVICE_SESSION_KEY = "cspot.selectedServicePlanId";

interface PresentationScreen {
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
  current: boolean;
}

interface WindowWithScreenDetails extends Window {
  getScreenDetails?: () => Promise<{
    currentScreen: {
      availLeft: number;
      availTop: number;
      availWidth: number;
      availHeight: number;
    };
    screens: Array<{
      availLeft: number;
      availTop: number;
      availWidth: number;
      availHeight: number;
      label?: string;
    }>;
  }>;
}

type SearchOverlayMode = "songs" | "bible" | "deck" | "video";
type LoadOptions = {
  preserveLocation?: {
    planItemId: string;
    slideOffset: number;
  };
  publishPreservedLocation?: boolean;
  refreshCatalogs?: boolean;
  silent?: boolean;
};
type SlideNotesPayload = {
  kind: "cspot.slideNotes";
  version: 1;
  slides: Record<string, string>;
};

const SLIDE_NOTES_KIND = "cspot.slideNotes";

const SERVICE_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  weekday: "short",
});
const SERVICE_LONG_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const SERVICE_MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

function dateInputFromDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function dateInputFromIso(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function serviceIsoFromDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 10, 30, 0, 0).toISOString();
}

function formatServiceDate(value: string | null | undefined) {
  if (!value) {
    return "No date";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No date" : SERVICE_DATE_FORMATTER.format(date);
}

function serviceTitleForDate(value: string) {
  if (!value) {
    return "Service";
  }
  const date = new Date(serviceIsoFromDateInput(value));
  return Number.isNaN(date.getTime())
    ? "Service"
    : date.toLocaleDateString(undefined, { day: "numeric", month: "long", weekday: "long" });
}

function serviceLongDateForInput(value: string) {
  const date = new Date(serviceIsoFromDateInput(value));
  return Number.isNaN(date.getTime()) ? serviceTitleForDate(value) : SERVICE_LONG_DATE_FORMATTER.format(date);
}

function replaceServiceTitleDate(title: string, nextDateInput: string, previousDateInput?: string) {
  const nextDateText = serviceLongDateForInput(nextDateInput);
  const previousDateText = previousDateInput ? serviceLongDateForInput(previousDateInput) : "";
  if (previousDateText && title.includes(previousDateText)) {
    return title.replace(previousDateText, nextDateText);
  }

  const numericDatePattern = /\b\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4}\b/;
  if (numericDatePattern.test(title)) {
    const [year, month, day] = nextDateInput.split("-");
    const compactYear = year?.slice(-2) ?? "";
    return title.replace(numericDatePattern, `${Number(month)} / ${Number(day)} / ${compactYear}`);
  }

  const writtenDatePattern =
    /\b(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i;
  if (writtenDatePattern.test(title)) {
    return title.replace(writtenDatePattern, nextDateText);
  }

  return title;
}

function monthInputFromDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function monthDateFromInput(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(year || new Date().getFullYear(), (month || 1) - 1, 1);
}

function calendarDaysForMonth(monthInput: string) {
  const monthStart = monthDateFromInput(monthInput);
  const firstVisible = new Date(monthStart);
  firstVisible.setDate(firstVisible.getDate() - firstVisible.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstVisible);
    date.setDate(firstVisible.getDate() + index);
    return date;
  });
}

function isTransientApiError(error: unknown) {
  return error instanceof ApiError && [408, 502, 503, 504].includes(error.status);
}

function scrollItemIntoOperatorView(container: HTMLElement | null, item: HTMLElement | null) {
  if (!container || !item) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const itemTop = itemRect.top - containerRect.top + container.scrollTop;
  const rowHeight = Math.max(itemRect.height + 6, 1);
  const visibleRows = Math.floor(container.clientHeight / rowHeight);
  const preferredOffset = visibleRows > 2 ? rowHeight : 0;
  const maxScroll = Math.max(container.scrollHeight - container.clientHeight, 0);
  const targetTop = Math.min(Math.max(itemTop - preferredOffset, 0), maxScroll);

  if (Math.abs(container.scrollTop - targetTop) < 2) {
    return;
  }

  container.scrollTo({ top: targetTop, behavior: "smooth" });
}

function slideVisibilityDirection(container: HTMLElement | null, item: HTMLElement | null) {
  if (!container || !item) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  if (itemRect.top < containerRect.top) {
    return "up" as const;
  }
  if (itemRect.bottom > containerRect.bottom) {
    return "down" as const;
  }
  return null;
}

function captureScrollPosition(element: HTMLElement | null) {
  return element?.scrollTop ?? 0;
}

function compactBibleAlias(value: string) {
  return value
    .toLowerCase()
    .replace(/\bfirst\b/g, "1")
    .replace(/\bsecond\b/g, "2")
    .replace(/\bthird\b/g, "3")
    .replace(/\bi\b/g, "1")
    .replace(/\bii\b/g, "2")
    .replace(/\biii\b/g, "3")
    .replace(/[^a-z0-9]/g, "");
}

function bibleBookAliasCandidates(book: BibleBook) {
  const commonAliases: Record<string, string[]> = {
    Matthew: ["mat"],
    Mark: ["mrk"],
    Luke: ["luk"],
    John: ["jhn"],
    Philippians: ["phil"],
    Philemon: ["phile"],
    Psalms: ["psalm", "psa"],
    Revelation: ["revelations", "the revelation"],
    "Song of Solomon": ["song of songs", "sos", "canticles"],
  };
  return [book.name, book.abbreviation, ...(commonAliases[book.name] ?? [])].map(compactBibleAlias);
}

function findBibleBookForQuery(rawBook: string, books: BibleBook[]) {
  const compactBook = compactBibleAlias(rawBook);
  if (!compactBook) {
    return null;
  }

  const candidates = books
    .map((book) => {
      const aliases = bibleBookAliasCandidates(book);
      const exact = aliases.some((alias) => alias === compactBook);
      const prefix = compactBook.length >= 3 && aliases.some((alias) => alias.startsWith(compactBook));
      const namePrefix = compactBook.length >= 3 && compactBibleAlias(book.name).startsWith(compactBook);
      if (!exact && !prefix && !namePrefix) {
        return null;
      }
      return {
        book,
        score: exact ? 0 : prefix ? 1 : 2,
      };
    })
    .filter((candidate): candidate is { book: BibleBook; score: number } => Boolean(candidate))
    .sort((left, right) => left.score - right.score || left.book.sort_order - right.book.sort_order);

  return candidates[0]?.book ?? null;
}

function normalizeBibleReferenceSearchQuery(raw: string, books: BibleBook[]) {
  const compact = raw
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/[:.,;]/g, " ")
    .replace(/-/g, " - ")
    .replace(/\s+/g, " ");
  if (!compact) {
    return raw;
  }

  const parts = compact.split(" ");
  const firstNumberIndex = parts.findIndex((part) => /^\d+$/.test(part));
  if (firstNumberIndex <= 0) {
    return raw;
  }

  const book = findBibleBookForQuery(parts.slice(0, firstNumberIndex).join(" "), books);
  if (!book) {
    return raw;
  }

  const chapter = parts[firstNumberIndex];
  const verseFrom = parts[firstNumberIndex + 1];
  if (!verseFrom || !/^\d+$/.test(verseFrom)) {
    return `${book.name} ${chapter}`;
  }

  let verseTo = "";
  if (parts[firstNumberIndex + 2] === "-" && /^\d+$/.test(parts[firstNumberIndex + 3] ?? "")) {
    verseTo = parts[firstNumberIndex + 3];
  } else if (/^\d+$/.test(parts[firstNumberIndex + 2] ?? "")) {
    verseTo = parts[firstNumberIndex + 2];
  }

  return `${book.name} ${chapter}:${verseFrom}${verseTo ? `-${verseTo}` : ""}`;
}

function parseBibleReference(reference: string) {
  const match = reference.trim().match(/^(.*)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) {
    return null;
  }

  return {
    book: match[1].trim(),
    chapter: Number(match[2]),
    verseFrom: Number(match[3]),
    verseTo: match[4] ? Number(match[4]) : Number(match[3]),
  };
}

async function tryFetchBiblePassage(
  versionCode: string,
  book: string,
  chapter: number,
  verseFrom: number,
  verseTo?: number,
) {
  try {
    return await getBiblePassage(versionCode, book, chapter, verseFrom, verseTo);
  } catch {
    return null;
  }
}

function SlideTextBlock({
  text,
  compact = false,
  maxFontSize,
}: {
  text: string;
  compact?: boolean;
  maxFontSize?: number;
}) {
  return <AutoFitSlideText compact={compact} maxFontSize={maxFontSize} text={text} />;
}

function renderMiniSlide(
  slide: PresentationSlide | null,
  fallback: string,
  theme: PresentationTheme,
  maxFontSize?: number,
) {
  if (!slide) {
    return (
      <div className="mini-slide-empty">
        <span>{fallback}</span>
      </div>
    );
  }

  return (
    <div className={`mini-slide-surface stage-theme-${theme} ${presentationTypeClass(slide.itemType)}`}>
      {slide.imageUrl ? (
        <img alt="" src={slide.imageUrl} />
      ) : slide.videoUrl ? (
        <div className="mini-video-slide">
          <span>Video</span>
          <strong>{slide.title}</strong>
        </div>
      ) : (
        <SlideTextBlock compact maxFontSize={maxFontSize} text={slide.text} />
      )}
    </div>
  );
}

function describeDeckStatus(
  fileIds: string[],
  renderedSlidesByFileId: Record<string, RenderedSlide[]>,
  renderingFileIds: string[],
  renderErrorsByFileId: Record<string, string>,
) {
  const renderedCounts = fileIds
    .map((fileId) => renderedSlidesByFileId[fileId]?.length ?? 0)
    .filter((count) => count > 0);
  const isRendering = fileIds.some((fileId) => renderingFileIds.includes(fileId));
  const hasError = fileIds.some((fileId) => Boolean(renderErrorsByFileId[fileId]));
  const totalSlides = renderedCounts.reduce((sum, count) => sum + count, 0);

  if (hasError) {
    return {
      tone: "error" as const,
      label: "Render failed",
      detail: "This deck hit a conversion problem. Try re-uploading or using PDF.",
    };
  }

  if (totalSlides > 0 && isRendering) {
    return {
      tone: "rendering" as const,
      label: "Rendering",
      detail: `${totalSlides} slides ready so far`,
    };
  }

  if (totalSlides > 0) {
    return {
      tone: "ready" as const,
      label: "Cached",
      detail: `${totalSlides} slides ready`,
    };
  }

  if (isRendering) {
    return {
      tone: "rendering" as const,
      label: "Rendering",
      detail: "Converting deck to slide previews...",
    };
  }

  return {
    tone: "pending" as const,
    label: "Pending",
    detail: "Waiting to load deck previews...",
  };
}

function sorterSlidesForSection(slides: PresentationSlide[]) {
  return slides.filter((slide) => slide.slideKind !== "title" && (!slide.imageUrl || (slide.buildIndex ?? 0) === 0));
}

function deckBuildGroupKey(slide: PresentationSlide | null | undefined) {
  if (!slide?.imageUrl) {
    return slide?.id ?? "";
  }
  return `${slide.planItemId}:${slide.originalSlideIndex ?? slide.renderedSlideIndex ?? slide.id}`;
}

function parseSlideNotesPayload(value: string | null | undefined): SlideNotesPayload | null {
  if (!value?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<SlideNotesPayload>;
    if (parsed.kind !== SLIDE_NOTES_KIND || parsed.version !== 1 || !parsed.slides || typeof parsed.slides !== "object") {
      return null;
    }
    return {
      kind: SLIDE_NOTES_KIND,
      version: 1,
      slides: Object.fromEntries(
        Object.entries(parsed.slides).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ),
    };
  } catch {
    return null;
  }
}

function slideNoteFor(rawNotes: string | null | undefined, slide: PresentationSlide | null, siblingSlides: PresentationSlide[]) {
  if (!slide) {
    return "";
  }
  const payload = parseSlideNotesPayload(rawNotes);
  if (payload) {
    return payload.slides[slide.id] ?? "";
  }
  const legacyNote = rawNotes?.trim() ?? "";
  if (!legacyNote) {
    return "";
  }
  return siblingSlides.length <= 1 || siblingSlides[0]?.id === slide.id ? legacyNote : "";
}

function serializeSlideNote(rawNotes: string | null | undefined, slide: PresentationSlide, siblingSlides: PresentationSlide[], note: string) {
  const existing = parseSlideNotesPayload(rawNotes);
  const slides = existing?.slides ? { ...existing.slides } : {};
  const legacyNote = existing ? "" : rawNotes?.trim() ?? "";
  const firstSlideId = siblingSlides[0]?.id;
  if (legacyNote && firstSlideId && firstSlideId !== slide.id) {
    slides[firstSlideId] = legacyNote;
  }
  const trimmed = note.trim();
  if (trimmed) {
    slides[slide.id] = trimmed;
  } else {
    delete slides[slide.id];
  }
  return Object.keys(slides).length
    ? JSON.stringify({ kind: SLIDE_NOTES_KIND, version: 1, slides } satisfies SlideNotesPayload)
    : null;
}

export function PresentationView({
  canAttachDeck,
  canCreatePlan,
  canDeletePlan,
  canEditPlan,
  canEditSlideNotes,
  canCreateSong,
  canEditSong,
}: {
  canAttachDeck: boolean;
  canCreatePlan: boolean;
  canDeletePlan: boolean;
  canEditPlan: boolean;
  canEditSlideNotes: boolean;
  canCreateSong: boolean;
  canEditSong: boolean;
}) {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [planTypes, setPlanTypes] = useState<PlanType[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [worshipSetPlan, setWorshipSetPlan] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveIndex, setLiveIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [screens, setScreens] = useState<PresentationScreen[]>([]);
  const [selectedScreenIndex, setSelectedScreenIndex] = useState(0);
  const [deckTitle, setDeckTitle] = useState("");
  const [deckTitleTouched, setDeckTitleTouched] = useState(false);
  const [deckFile, setDeckFile] = useState<File | null>(null);
  const [deckFlattenBuilds, setDeckFlattenBuilds] = useState(false);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [renderedSlidesByFileId, setRenderedSlidesByFileId] = useState<Record<string, RenderedSlide[]>>({});
  const [renderingFileIds, setRenderingFileIds] = useState<string[]>([]);
  const [renderErrorsByFileId, setRenderErrorsByFileId] = useState<Record<string, string>>({});
  const [expandedSorterSectionIds, setExpandedSorterSectionIds] = useState<Set<string>>(() => new Set());
  const [bibleVersions, setBibleVersions] = useState<BibleVersion[]>([]);
  const [bibleBooks, setBibleBooks] = useState<BibleBook[]>([]);
  const [bibleVersion, setBibleVersion] = useState("KJV");
  const [bibleBook, setBibleBook] = useState("John");
  const [bibleChapter, setBibleChapter] = useState("3");
  const [bibleVerseFrom, setBibleVerseFrom] = useState("16");
  const [bibleVerseTo, setBibleVerseTo] = useState("");
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchOverlayMode>("songs");
  const [searchInsertIndex, setSearchInsertIndex] = useState<number | null>(null);
  const [searchSelectInserted, setSearchSelectInserted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [bibleSearchResults, setBibleSearchResults] = useState<BibleSearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [customProviderLoading, setCustomProviderLoading] = useState(false);
  const [customProviderResult, setCustomProviderResult] = useState<CustomProviderSearchResult | null>(null);
  const [selectedCustomProviderMatchId, setSelectedCustomProviderMatchId] = useState<string | null>(null);
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [serviceDraftDate, setServiceDraftDate] = useState("");
  const [serviceDraftTitle, setServiceDraftTitle] = useState("");
  const [serviceCalendarMonth, setServiceCalendarMonth] = useState(monthInputFromDate(new Date()));
  const [serviceDraftPlanId, setServiceDraftPlanId] = useState<string | null>(null);
  const [serviceHistoryOpen, setServiceHistoryOpen] = useState(false);
  const [serviceHistory, setServiceHistory] = useState<PlanHistoryEntry[]>([]);
  const [serviceHistoryLoading, setServiceHistoryLoading] = useState(false);
  const [customProviderSelection, setCustomProviderSelection] = useState<CustomProviderSelectResult | null>(null);
  const [customProviderSelectionLoading, setCustomProviderSelectionLoading] = useState(false);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [googleDriveStatus, setGoogleDriveStatus] = useState<GoogleDriveStatus | null>(null);
  const [googleDriveFiles, setGoogleDriveFiles] = useState<GoogleDriveFile[]>([]);
  const [googleDriveLoading, setGoogleDriveLoading] = useState(false);
  const [googleDriveError, setGoogleDriveError] = useState("");
  const [slideTheme, setSlideTheme] = useState<PresentationTheme>("light");
  const [liveBlanked, setLiveBlanked] = useState(false);
  const [playingAudioSectionId, setPlayingAudioSectionId] = useState<string | null>(null);
  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const [deckRenderRetryToken, setDeckRenderRetryToken] = useState(0);
  const [undoAction, setUndoAction] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const [sorterCatchUpDirection, setSorterCatchUpDirection] = useState<"up" | "down" | null>(null);
  const [railCatchUpDirection, setRailCatchUpDirection] = useState<"up" | "down" | null>(null);
  const [slideNotesDraft, setSlideNotesDraft] = useState("");
  const [slideNotesSaving, setSlideNotesSaving] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const keyCaptureRef = useRef<HTMLInputElement | null>(null);
  const outputWindowRef = useRef<Window | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const slideGridRef = useRef<HTMLDivElement | null>(null);
  const sectionRailListRef = useRef<HTMLDivElement | null>(null);
  const thumbnailRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const sectionRailRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const currentLiveStateRef = useRef<PresentationLiveState | null>(null);
  const lastLiveStateRef = useRef<number>(0);
  const livePollInFlightRef = useRef(false);
  const suppressPublishRef = useRef(false);
  const suppressNextOperatorScrollRef = useRef(false);
  const scrollOperatorToSelectedSlideRef = useRef(false);
  const catchUpCheckTokenRef = useRef(0);
  const sorterCatchUpDirectionRef = useRef<"up" | "down" | null>(null);
  const railCatchUpDirectionRef = useRef<"up" | "down" | null>(null);
  const activeDeckLoadsRef = useRef<Set<string>>(new Set());
  const handledKeyboardEventsRef = useRef<WeakSet<KeyboardEvent>>(new WeakSet());
  const lastKeyboardNavigationRef = useRef<{ direction: SlideKeyboardDirection; key: string; time: number } | null>(null);

  const servicePlans = useMemo(() => plans.filter((candidate) => !isWorshipSetPlan(candidate)), [plans]);
  const worshipSetPlans = useMemo(() => plans.filter(isWorshipSetPlan), [plans]);
  const effectivePlanItems = useMemo(
    () => mergeWorshipSetIntoService(plan?.items ?? [], worshipSetPlan?.items ?? []),
    [plan?.items, worshipSetPlan?.items],
  );
  const serviceItemsById = useMemo(
    () => new Map((plan?.items ?? []).map((item) => [item.id, item] as const)),
    [plan?.items],
  );
  const worshipSetItemsById = useMemo(
    () => new Map((worshipSetPlan?.items ?? []).map((item) => [item.id, item] as const)),
    [worshipSetPlan?.items],
  );
  const sections = useMemo(
    () => buildPresentationSections(effectivePlanItems, songs, renderedSlidesByFileId),
    [effectivePlanItems, songs, renderedSlidesByFileId],
  );
  const sortedPlans = useMemo(
    () =>
      [...servicePlans].sort((a, b) => {
        const aTime = new Date(a.service_date).getTime();
        const bTime = new Date(b.service_date).getTime();
        return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
      }),
    [servicePlans],
  );

  function nextServicePlanId(planList: PlanSummary[]) {
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
  const plansByDate = useMemo(
    () =>
      new Map(
        servicePlans
          .map((planSummary) => [dateInputFromIso(planSummary.service_date), planSummary] as const)
          .filter(([date]) => Boolean(date)),
      ),
    [servicePlans],
  );
  const calendarDays = useMemo(() => calendarDaysForMonth(serviceCalendarMonth), [serviceCalendarMonth]);
  const slides = useMemo(
    () => buildPresentationSlides(effectivePlanItems, songs, renderedSlidesByFileId),
    [effectivePlanItems, songs, renderedSlidesByFileId],
  );
  const liveSlide = slides[liveIndex] ?? null;
  const currentPlanItem = effectivePlanItems.find((item) => item.id === liveSlide?.planItemId) ?? null;
  const currentPlanItemSlides = useMemo(
    () => (currentPlanItem ? slides.filter((slide) => slide.planItemId === currentPlanItem.id) : []),
    [currentPlanItem?.id, slides],
  );
  const liveSectionSlideIndex = liveSlide ? currentPlanItemSlides.findIndex((slide) => slide.id === liveSlide.id) : -1;
  const liveSectionCounter =
    liveSectionSlideIndex >= 0 && currentPlanItemSlides.length > 1
      ? `${liveSectionSlideIndex + 1}/${currentPlanItemSlides.length}`
      : null;
  const stageContextTitle =
    liveSlide?.itemType === "song" || liveSlide?.itemType === "reading"
      ? liveSlide.sectionTitle || liveSlide.title
      : "";
  const stageContextCounter = liveSlide?.itemType === "song" ? liveSectionCounter : null;
  const stageSlideCounter = liveSectionCounter ?? `${liveIndex + 1} / ${slides.length}`;
  const currentPlanItemAllowsNotes =
    currentPlanItem?.item_type === "message" ||
    currentPlanItem?.item_type === "sermon" ||
    currentPlanItem?.item_type === "slide_deck" ||
    Boolean(currentPlanItem?.files.length);
  const planTextSlides = useMemo(
    () => slides.filter((slide) => !slide.imageUrl && slide.text.trim()),
    [slides],
  );
  const planTextFontCap = useMemo(
    () => suggestSlideGroupFontCap(planTextSlides.map((slide) => slide.text)),
    [planTextSlides],
  );
  const liveTextFontCap = liveSlide?.itemType === "reading" ? Math.min(planTextFontCap, 42) : planTextFontCap;
  const compactPlanTextFontCap = useMemo(
    () => suggestSlideGroupFontCap(planTextSlides.map((slide) => slide.text), true),
    [planTextSlides],
  );
  const songSearchResults = useMemo(
    () =>
      songs
        .filter((song) =>
          !searchQuery.trim()
            ? true
            : `${song.title} ${song.author ?? ""}`.toLowerCase().includes(searchQuery.trim().toLowerCase()),
        )
        .slice(0, 20),
    [searchQuery, songs],
  );
  const selectedCustomProviderMatch =
    customProviderResult?.matches.find((match) => match.id === selectedCustomProviderMatchId) ?? null;
  const editingSong = useMemo(
    () => songs.find((candidate) => candidate.id === editingSongId) ?? null,
    [editingSongId, songs],
  );

  function normalizedSongKey(value: string) {
    return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  }

  function findDuplicateSong(title: string) {
    const key = normalizedSongKey(title);
    return songs.find((song) =>
      [song.title, song.alternate_title]
        .filter(Boolean)
        .some((value) => normalizedSongKey(value!) === key),
    );
  }

  function openSongEditor(songId: string) {
    const song = songs.find((candidate) => candidate.id === songId);
    if (!song) {
      setMessage("Could not find that song in the library.");
      return;
    }
    setEditingSongId(song.id);
  }

  function closeSongEditor() {
    setEditingSongId(null);
  }

  function clearHotkeyButtonFocus() {
    const active = document.activeElement;
    if (!(active instanceof HTMLButtonElement)) {
      return;
    }
    if (active.closest(".presenter-controls") || active.closest(".presentation-topbar-tools")) {
      active.blur();
    }
  }

  function patchPlanItemInState(current: PlanDetail | null, updatedItem: PlanItem): PlanDetail | null {
    if (!current?.items.some((item) => item.id === updatedItem.id)) {
      return current;
    }

    return {
      ...current,
      items: current.items.map((item) => (item.id === updatedItem.id ? { ...item, ...updatedItem } : item)),
    };
  }

  async function saveSlideNotes() {
    if (!canEditSlideNotes || !currentPlanItem || !liveSlide || slideNotesSaving) {
      return;
    }

    const nextNotes = slideNotesDraft.trim();
    const currentNotes = slideNoteFor(currentPlanItem.teacher_notes, liveSlide, currentPlanItemSlides);
    if (nextNotes === currentNotes) {
      return;
    }

    setSlideNotesSaving(true);
    try {
      const updatedItem = await updatePlanItem(currentPlanItem.id, {
        teacher_notes: serializeSlideNote(currentPlanItem.teacher_notes, liveSlide, currentPlanItemSlides, nextNotes),
      });
      setPlan((current) => patchPlanItemInState(current, updatedItem));
      setWorshipSetPlan((current) => patchPlanItemInState(current, updatedItem));
      void recordServiceHistory(
        nextNotes ? `editing notes for "${liveSlide.title}"` : `clearing notes for "${liveSlide.title}"`,
        currentPlanItem.title,
        "slide_notes",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save slide notes.");
    } finally {
      setSlideNotesSaving(false);
    }
  }

  useEffect(() => {
    setSlideNotesDraft(slideNoteFor(currentPlanItem?.teacher_notes, liveSlide, currentPlanItemSlides));
  }, [currentPlanItem?.id, currentPlanItem?.teacher_notes, currentPlanItemSlides, liveSlide?.id]);

  function toggleSorterSection(sectionId: string) {
    setExpandedSorterSectionIds((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }

  function syncSlideshowStatusFromStorage() {
    try {
      const value = localStorage.getItem(PRESENTATION_OUTPUT_STATUS_KEY);
      if (!value) {
        setSlideshowOpen(false);
        return;
      }
      const status = JSON.parse(value) as { planId?: string; heartbeatAt?: number };
      const isFresh =
        status.planId === selectedPlanId &&
        typeof status.heartbeatAt === "number" &&
        Date.now() - status.heartbeatAt < 5000;
      setSlideshowOpen(isFresh);
    } catch {
      setSlideshowOpen(false);
    }
  }

  function buildLiveStateForSlides(
    slideList: PresentationSlide[],
    nextIndex: number,
    overrides: Partial<PresentationLiveState> = {},
    planId = plan?.id,
  ): PresentationLiveState | null {
    if (!planId) {
      return null;
    }

    const slide = slideList[Math.min(Math.max(nextIndex, 0), Math.max(slideList.length - 1, 0))] ?? null;
    const slideOffset = slide
      ? slideList.filter((candidate) => candidate.planItemId === slide.planItemId).findIndex((candidate) => candidate.id === slide.id)
      : 0;

    return {
      planId,
      index: nextIndex,
      updatedAt: overrides.updatedAt ?? Date.now(),
      planItemId: overrides.planItemId ?? slide?.planItemId ?? null,
      slideOffset: overrides.slideOffset ?? Math.max(slideOffset, 0),
      theme: overrides.theme ?? slideTheme,
      blanked: overrides.blanked ?? liveBlanked,
      fullscreen: currentLiveStateRef.current?.fullscreen ?? false,
      videoAction: overrides.videoAction ?? null,
      videoActionAt: overrides.videoActionAt,
    };
  }

  function buildLiveState(nextIndex: number, overrides: Partial<PresentationLiveState> = {}): PresentationLiveState | null {
    return buildLiveStateForSlides(slides, nextIndex, overrides);
  }

  function applyRemoteLiveState(state: PresentationLiveState) {
    currentLiveStateRef.current = state;
    suppressPublishRef.current = true;
    lastLiveStateRef.current = state.updatedAt;
    setSlideTheme(state.theme ?? "light");
    setLiveBlanked(Boolean(state.blanked));
    setLiveIndex(resolveLiveIndex(slides, state));
    localStorage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify(state));
    channelRef.current?.postMessage(state);
  }

  async function load(planId?: string, options?: LoadOptions) {
    setMessage(null);
    if (!options?.silent) {
      setLoading(true);
    }

    try {
      let nextPlans = plans;
      let nextPlanTypes = planTypes;
      let nextSongs = songs;
      if (options?.refreshCatalogs || !plans.length || !songs.length || !planTypes.length) {
        [nextPlans, nextSongs, nextPlanTypes] = await Promise.all([getPlans(), getSongs(), getPlanTypes()]);
        setPlans(nextPlans);
        setSongs(nextSongs);
        setPlanTypes(nextPlanTypes);
      }
      const requestedPlanId =
        planId !== undefined
          ? planId
          : sessionStorage.getItem(SELECTED_SERVICE_SESSION_KEY) || selectedPlanId;
      const nextServicePlans = nextPlans.filter((candidate) => !isWorshipSetPlan(candidate));
      const nextWorshipSetPlans = nextPlans.filter(isWorshipSetPlan);
      const requestedPlan = nextServicePlans.find((candidate) => candidate.id === requestedPlanId);
      const requestedPlanIsUsable =
        planId !== undefined || (requestedPlan && dateInputFromIso(requestedPlan.service_date) >= dateInputFromIso(new Date().toISOString()));
      const targetPlanId = requestedPlan && requestedPlanIsUsable
        ? requestedPlanId
        : nextServicePlanId(nextServicePlans);
      const [targetPlan, liveState] = await Promise.all([
        targetPlanId ? getPlan(targetPlanId) : Promise.resolve(null),
        targetPlanId ? getPresentationLiveState(targetPlanId) : Promise.resolve(null),
      ]);
      const matchingWorshipSet = matchingWorshipSetForService(targetPlan, nextWorshipSetPlans);
      const nextWorshipSetPlan = matchingWorshipSet ? await getPlan(matchingWorshipSet.id) : null;
      setSelectedPlanId(targetPlanId);
      if (targetPlanId) {
        sessionStorage.setItem(SELECTED_SERVICE_SESSION_KEY, targetPlanId);
      } else {
        sessionStorage.removeItem(SELECTED_SERVICE_SESSION_KEY);
      }
      setPlan(targetPlan);
      setWorshipSetPlan(nextWorshipSetPlan);
      const nextEffectiveItems = mergeWorshipSetIntoService(targetPlan?.items ?? [], nextWorshipSetPlan?.items ?? []);
      const nextSlides = buildPresentationSlides(nextEffectiveItems, nextSongs, renderedSlidesByFileId);
      const preservedState = liveState
        ? {
            planId: liveState.plan_id,
            index: liveState.index,
            updatedAt: liveState.updated_at,
            planItemId: liveState.plan_item_id,
            slideOffset: liveState.slide_offset,
            theme: liveState.theme,
            blanked: liveState.blanked,
            fullscreen: liveState.fullscreen,
            videoAction: liveState.video_action,
            videoActionAt: liveState.video_action_at ?? undefined,
          }
        : null;
      const preservedIndex = options?.preserveLocation
        ? (() => {
            const matchingSlides = nextSlides.filter(
              (slide) => slide.planItemId === options.preserveLocation?.planItemId,
            );
            if (!matchingSlides.length) {
              return -1;
            }
            const slideInSection = Math.min(
              Math.max(options.preserveLocation.slideOffset, 0),
              matchingSlides.length - 1,
            );
            return nextSlides.findIndex((slide) => slide.id === matchingSlides[slideInSection]?.id);
          })()
        : preservedState
          ? resolveLiveIndex(nextSlides, preservedState)
          : -1;
      if (preservedState) {
        currentLiveStateRef.current = preservedState;
        suppressPublishRef.current = true;
        lastLiveStateRef.current = preservedState.updatedAt;
        setSlideTheme(preservedState.theme ?? "light");
        setLiveBlanked(Boolean(preservedState.blanked));
        localStorage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify(preservedState));
      }
      const nextLiveIndex = preservedIndex >= 0 ? preservedIndex : 0;
      if (options?.preserveLocation && preservedIndex >= 0 && options.publishPreservedLocation !== false) {
        setLiveBlanked(false);
        void publishLiveStateForSlides(nextSlides, nextLiveIndex, { blanked: false }, targetPlan?.id);
      }
      setLiveIndex(nextLiveIndex);
    } catch (error) {
      if (!isTransientApiError(error) || !plan) {
        setPlan(null);
        setWorshipSetPlan(null);
      }
      setMessage(error instanceof Error ? error.message : "Could not load presentation.");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  function setLiveSlide(nextIndex: number) {
    const slideCount = slides.length;
    if (!slideCount) {
      setLiveBlanked(false);
      setLiveIndex(0);
      void publishLiveState(0, { blanked: false });
      return;
    }

    const boundedIndex = Math.min(Math.max(nextIndex, 0), slideCount - 1);
    setLiveBlanked(false);
    setLiveIndex(boundedIndex);
    void publishLiveState(boundedIndex, { blanked: false });
  }

  function selectSlideFromOperator(nextIndex: number) {
    const targetSlide = slides[Math.min(Math.max(nextIndex, 0), Math.max(slides.length - 1, 0))];
    catchUpCheckTokenRef.current += 1;
    scrollOperatorToSelectedSlideRef.current = true;
    sorterCatchUpDirectionRef.current = null;
    railCatchUpDirectionRef.current = null;
    setSorterCatchUpDirection(null);
    setRailCatchUpDirection(null);
    if (targetSlide) {
      window.requestAnimationFrame(() => {
        scrollItemIntoOperatorView(slideGridRef.current, thumbnailRefs.current[targetSlide.id] ?? null);
        scrollItemIntoOperatorView(sectionRailListRef.current, sectionRailRefs.current[targetSlide.sectionId] ?? null);
      });
    }
    setLiveSlide(nextIndex);
  }

  function updateCatchUpDirectionsForSlide(index: number) {
    const activeSlide = slides[index];
    const nextSorterDirection = slideVisibilityDirection(slideGridRef.current, activeSlide ? thumbnailRefs.current[activeSlide.id] ?? null : null);
    const nextRailDirection = slideVisibilityDirection(sectionRailListRef.current, activeSlide ? sectionRailRefs.current[activeSlide.sectionId] ?? null : null);
    sorterCatchUpDirectionRef.current = nextSorterDirection;
    railCatchUpDirectionRef.current = nextRailDirection;
    setSorterCatchUpDirection(nextSorterDirection);
    setRailCatchUpDirection(nextRailDirection);
  }

  function catchOperatorUpToLiveSlide() {
    const activeSlide = slides[liveIndex];
    if (!activeSlide) {
      return;
    }
    catchUpCheckTokenRef.current += 1;
    scrollItemIntoOperatorView(slideGridRef.current, thumbnailRefs.current[activeSlide.id] ?? null);
    scrollItemIntoOperatorView(sectionRailListRef.current, sectionRailRefs.current[activeSlide.sectionId] ?? null);
    sorterCatchUpDirectionRef.current = null;
    railCatchUpDirectionRef.current = null;
    setSorterCatchUpDirection(null);
    setRailCatchUpDirection(null);
  }

  function setLiveBlankedAndPublish(nextBlanked: boolean) {
    suppressPublishRef.current = true;
    setLiveBlanked(nextBlanked);
    void publishLiveState(liveIndex, { blanked: nextBlanked });
  }

  function moveLive(delta: number) {
    setLiveIndex((current) => {
      const slideCount = slides.length;
      if (!slideCount) {
        setLiveBlanked(false);
        void publishLiveState(0, { blanked: false });
        return 0;
      }

      const nextIndex = Math.min(Math.max(current + delta, 0), slideCount - 1);
      setLiveBlanked(false);
      void publishLiveState(nextIndex, { blanked: false });
      return nextIndex;
    });
  }

  function sendVideoCommand(action: "play" | "pause" | "stop") {
    if (!liveSlide?.videoUrl) {
      setMessage("Select a video slide before using media controls.");
      return;
    }
    void publishLiveState(liveIndex, {
      videoAction: action,
      videoActionAt: Date.now(),
    });
  }

  function toggleSectionAudio(section: { id: string; slides: PresentationSlide[] }) {
    const audioSlide = section.slides.find((slide) => slide.youtubeAudioUrl);
    if (!audioSlide) {
      return;
    }
    const audioIndex = slides.findIndex((slide) => slide.id === audioSlide.id);
    if (audioIndex < 0) {
      return;
    }
    const isPlaying = playingAudioSectionId === section.id;
    const targetIndex = liveSlide?.sectionId === section.id ? liveIndex : audioIndex;
    setPlayingAudioSectionId(isPlaying ? null : section.id);
    if (!isPlaying) {
      setLiveBlanked(false);
      setLiveIndex(targetIndex);
    }
    void publishLiveState(targetIndex, {
      blanked: false,
      videoAction: isPlaying ? "pause" : "play",
      videoActionAt: Date.now(),
    });
  }

  async function publishLiveStateForSlides(
    slideList: PresentationSlide[],
    nextIndex: number,
    overrides: Partial<PresentationLiveState> = {},
    planId = plan?.id,
  ) {
    const state = buildLiveStateForSlides(slideList, nextIndex, overrides, planId);
    if (!state) {
      return;
    }

    currentLiveStateRef.current = state;
    lastLiveStateRef.current = state.updatedAt;
    localStorage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify(state));
    channelRef.current?.postMessage(state);

    try {
      const synced = await updatePresentationLiveState(state.planId, {
        plan_id: state.planId,
        index: state.index,
        plan_item_id: state.planItemId ?? null,
        slide_offset: state.slideOffset ?? 0,
        updated_at: state.updatedAt,
        theme: state.theme ?? "light",
        blanked: Boolean(state.blanked),
        fullscreen: Boolean(state.fullscreen),
        video_action: state.videoAction ?? null,
        video_action_at: state.videoActionAt ?? null,
      });
      lastLiveStateRef.current = synced.updated_at;
    } catch (error) {
      if (!isTransientApiError(error)) {
        setMessage(error instanceof Error ? error.message : "Could not sync presentation state.");
      }
    }
  }

  async function publishLiveState(nextIndex: number, overrides: Partial<PresentationLiveState> = {}) {
    await publishLiveStateForSlides(slides, nextIndex, overrides);
  }

  async function detectDisplays() {
    const screenWindow = window as WindowWithScreenDetails;
    if (!screenWindow.getScreenDetails) {
      setMessage("This browser does not expose display selection. Open the slideshow window, move it to the projector, then fullscreen it.");
      return [];
    }

    try {
      const details = await screenWindow.getScreenDetails();
      const detected = details.screens.map((screen, screenIndex) => ({
        label: screen.label || `Display ${screenIndex + 1}`,
        left: screen.availLeft,
        top: screen.availTop,
        width: screen.availWidth,
        height: screen.availHeight,
        current:
          screen.availLeft === details.currentScreen.availLeft &&
          screen.availTop === details.currentScreen.availTop,
      }));
      const preferredIndex = detected.findIndex((screen) => !screen.current);
      setScreens(detected);
      setSelectedScreenIndex(preferredIndex >= 0 ? preferredIndex : 0);
      setMessage(null);
      return detected;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read connected displays.");
      return [];
    }
  }

  function closeSlideshowWindow() {
    if (outputWindowRef.current && !outputWindowRef.current.closed) {
      outputWindowRef.current.close();
    }
    outputWindowRef.current = null;
    localStorage.removeItem(PRESENTATION_OUTPUT_STATUS_KEY);
    setSlideshowOpen(false);
  }

  async function startSlideshow() {
    if (!plan) {
      setMessage("Select a plan before starting the slideshow.");
      return;
    }

    if (outputWindowRef.current && !outputWindowRef.current.closed) {
      closeSlideshowWindow();
      return;
    }

    void publishLiveState(liveIndex);
    const detectedScreens = screens.length ? screens : await detectDisplays();
    const detectedPreferredIndex = detectedScreens.findIndex((screen) => !screen.current);
    const targetIndex = screens.length
      ? selectedScreenIndex
      : detectedPreferredIndex >= 0
        ? detectedPreferredIndex
        : 0;
    const targetScreen = detectedScreens[targetIndex] ?? detectedScreens[0];

    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("presentation", "output");
    url.searchParams.set("planId", plan.id);
    url.searchParams.set("index", String(liveIndex));

    const features = [
      "popup=yes",
      "fullscreen=yes",
      "menubar=no",
      "toolbar=no",
      "location=no",
      "status=no",
      "scrollbars=no",
      "resizable=yes",
      `left=${targetScreen?.left ?? 0}`,
      `top=${targetScreen?.top ?? 0}`,
      `width=${targetScreen?.width ?? 1280}`,
      `height=${targetScreen?.height ?? 720}`,
    ].join(",");

    const outputWindow = window.open(url.toString(), "cspot-pro-live-output", features);
    if (!outputWindow) {
      setMessage("The browser blocked the live output window. Allow pop-ups for this app and try again.");
      return;
    }

    outputWindowRef.current = outputWindow;
    localStorage.setItem(
      PRESENTATION_OUTPUT_STATUS_KEY,
      JSON.stringify({ planId: plan.id, heartbeatAt: Date.now() }),
    );
    setSlideshowOpen(true);
    outputWindow.focus();
  }

  async function selectPlan(planId: string) {
    setServiceHistoryOpen(false);
    setServicePickerOpen(false);
    await load(planId);
  }

  function openServicePicker() {
    const draftDate = dateInputFromIso(plan?.service_date) || nextSundayDateInput();
    setServiceDraftDate(draftDate);
    setServiceDraftTitle(plan?.title ?? suggestedServiceTitle(draftDate));
    setServiceDraftPlanId(plan?.id ?? null);
    setServiceCalendarMonth(draftDate.slice(0, 7) || monthInputFromDate(new Date()));
    setServicePickerOpen(true);
    setServiceHistoryOpen(false);
  }

  function formatHistoryTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleString(undefined, { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short" });
  }

  async function openServiceHistory() {
    if (!plan) {
      return;
    }
    const nextOpen = !serviceHistoryOpen;
    setServicePickerOpen(false);
    setServiceHistoryOpen(nextOpen);
    if (!nextOpen) {
      return;
    }
    setServiceHistoryLoading(true);
    try {
      setServiceHistory(await getPlanHistory(plan.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load service history.");
    } finally {
      setServiceHistoryLoading(false);
    }
  }

  async function recordServiceHistory(label: string, affected: string, changeType: string) {
    if (!plan?.id) {
      return;
    }
    try {
      const entry = await createPlanHistoryEntry(plan.id, {
        label,
        before: [],
        after: [],
        affected,
        change_type: changeType,
        restorable: false,
      });
      setServiceHistory((current) => [entry, ...current.filter((candidate) => candidate.id !== entry.id)]);
    } catch {
      // History is helpful but should not block service edits.
    }
  }

  function nextSundayDateInput() {
    const date = new Date();
    date.setDate(date.getDate() + ((7 - date.getDay()) % 7 || 7));
    date.setHours(10, 30, 0, 0);
    return dateInputFromIso(date.toISOString());
  }

  function serviceTypeForDate(dateInput: string) {
    const date = new Date(serviceIsoFromDateInput(dateInput));
    const day = Number.isNaN(date.getTime()) ? 0 : date.getDay();
    const normalizedType = (value: string) => value.toLowerCase();
    if (day === 0) {
      return planTypes.find((type) => normalizedType(type.name).includes("sunday")) ?? planTypes[0] ?? null;
    }
    if (day === 4) {
      return (
        planTypes.find((type) => normalizedType(type.name).includes("prayer")) ??
        planTypes.find((type) => normalizedType(type.name).includes("midweek")) ??
        planTypes[0] ??
        null
      );
    }
    return (
      planTypes.find((type) => normalizedType(type.name).includes("midweek")) ??
      planTypes.find((type) => normalizedType(type.name).includes("event")) ??
      planTypes[0] ??
      null
    );
  }

  function suggestedServiceTitle(dateInput: string) {
    const type = serviceTypeForDate(dateInput);
    return `${type?.name ?? "Service"} ${serviceLongDateForInput(dateInput)}`;
  }

  function updateServiceDraftDate(nextDate: string) {
    setServiceDraftDate((previousDate) => {
      setServiceDraftTitle((currentTitle) => {
        if (!serviceDraftPlanId && !currentTitle.trim()) {
          return suggestedServiceTitle(nextDate);
        }
        return replaceServiceTitleDate(currentTitle, nextDate, previousDate);
      });
      return nextDate;
    });
    setServiceCalendarMonth(nextDate.slice(0, 7) || serviceCalendarMonth);
  }

  function startNewServiceDraft(dateInput = serviceDraftDate || nextSundayDateInput()) {
    setServiceDraftPlanId(null);
    setServiceDraftDate(dateInput);
    setServiceDraftTitle(suggestedServiceTitle(dateInput));
    setServiceCalendarMonth(dateInput.slice(0, 7) || serviceCalendarMonth);
  }

  async function chooseServiceDate(dateInput: string) {
    const existing = plansByDate.get(dateInput);
    if (existing) {
      setServiceDraftDate(dateInput);
      setServiceCalendarMonth(dateInput.slice(0, 7) || serviceCalendarMonth);
      setServiceDraftPlanId(existing.id);
      setServiceDraftTitle(existing.title);
      return;
    }
    startNewServiceDraft(dateInput);
  }

  async function openServiceDate(dateInput: string) {
    const existing = plansByDate.get(dateInput);
    if (existing) {
      setServicePickerOpen(false);
      await selectPlan(existing.id);
      return;
    }
    startNewServiceDraft(dateInput);
  }

  async function createServiceForDate(dateInput = serviceDraftDate || nextSundayDateInput(), title = serviceDraftTitle) {
    if (!dateInput) {
      setMessage("Choose a date first.");
      return;
    }
    if (!canCreatePlan) {
      setMessage("Only service leaders, worship leaders, and administrators can create services.");
      return;
    }

    const primaryPlanType = serviceTypeForDate(dateInput);
    if (!primaryPlanType) {
      setMessage("No service types are configured yet.");
      return;
    }

    try {
      const serviceTitle = title.trim() || suggestedServiceTitle(dateInput);
      const created = await createPlan({
        plan_type_id: primaryPlanType.id,
        service_date: serviceIsoFromDateInput(dateInput),
        title: serviceTitle,
        subtitle: null,
        leader_id: null,
        teacher_id: null,
        status: "draft",
        info: null,
      });
      await load(created.id, { refreshCatalogs: true });
      setServicePickerOpen(false);
      setMessage("New service created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create a new service.");
    }
  }

  async function openDraftService() {
    if (serviceDraftPlanId) {
      await selectPlan(serviceDraftPlanId);
      return;
    }

    await createServiceForDate(serviceDraftDate, serviceDraftTitle);
  }

  async function saveDraftService() {
    if (!serviceDraftDate) {
      setMessage("Choose a date first.");
      return;
    }
    if (!serviceDraftPlanId) {
      await createServiceForDate(serviceDraftDate, serviceDraftTitle);
      return;
    }
    if (!canEditPlan) {
      setMessage("Only service leaders, worship leaders, and administrators can edit services.");
      return;
    }

    const target = plans.find((candidate) => candidate.id === serviceDraftPlanId);
    const currentDetail = serviceDraftPlanId === plan?.id ? plan : null;
    const primaryPlanType = serviceTypeForDate(serviceDraftDate);
    if (!primaryPlanType || !target) {
      setMessage("Could not find that service.");
      return;
    }

    try {
      await updatePlan(serviceDraftPlanId, {
        plan_type_id: currentDetail?.plan_type_id ?? primaryPlanType.id,
        service_date: serviceIsoFromDateInput(serviceDraftDate),
        title: serviceDraftTitle.trim() || suggestedServiceTitle(serviceDraftDate),
        subtitle: currentDetail?.subtitle ?? null,
        leader_id: currentDetail?.leader_id ?? null,
        teacher_id: currentDetail?.teacher_id ?? null,
        status: currentDetail?.status ?? target.status,
        info: currentDetail?.info ?? null,
      });
      await load(serviceDraftPlanId, { refreshCatalogs: true });
      setServicePickerOpen(false);
      setMessage("Service updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update this service.");
    }
  }

  async function archiveCurrentPlan() {
    if (!plan) {
      return;
    }
    if (!canDeletePlan) {
      setMessage("Only service leaders, worship leaders, and administrators can archive services.");
      return;
    }

    const confirmed = window.confirm(`Archive service "${plan.title}"?`);
    if (!confirmed) {
      return;
    }

    try {
      await deletePlan(plan.id);
      await load(undefined, { refreshCatalogs: true });
      setServicePickerOpen(false);
      setMessage("Service archived.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not archive this service.");
    }
  }

  function orderedPlanItems() {
    return [...(plan?.items ?? [])].sort((first, second) => {
      const firstSequence = Number.parseFloat(first.sequence) || 0;
      const secondSequence = Number.parseFloat(second.sequence) || 0;
      return firstSequence - secondSequence;
    });
  }

  function orderedWorshipSetItems() {
    return [...(worshipSetPlan?.items ?? [])].sort((first, second) => {
      const firstSequence = Number.parseFloat(first.sequence) || 0;
      const secondSequence = Number.parseFloat(second.sequence) || 0;
      return firstSequence - secondSequence;
    });
  }

  function syntheticWorshipAnchor(): PlanItem | null {
    if (!plan || !worshipSetPlan?.items.some((item) => item.item_type === "song" && item.song_id)) {
      return null;
    }

    return {
      id: "__worship_anchor__",
      plan_id: plan.id,
      song_id: null,
      item_type: WORSHIP_SET_ANCHOR_ITEM_TYPE,
      sequence: "30.00",
      title: "Worship songs",
      comment: null,
      key_signature: null,
      teacher_notes: null,
      files: [],
    };
  }

  function orderedPlanItemsWithWorshipAnchor() {
    const orderedItems = orderedPlanItems();
    if (orderedItems.some((item) => item.item_type === WORSHIP_SET_ANCHOR_ITEM_TYPE)) {
      return orderedItems;
    }

    const anchor = syntheticWorshipAnchor();
    if (!anchor) {
      return orderedItems;
    }

    return [...orderedItems, anchor].sort((first, second) => {
      const firstSequence = Number.parseFloat(first.sequence) || 0;
      const secondSequence = Number.parseFloat(second.sequence) || 0;
      return firstSequence - secondSequence;
    });
  }

  function sectionPlanItem(sectionId: string) {
    return serviceItemsById.get(sectionId) ?? worshipSetItemsById.get(sectionId) ?? null;
  }

  function sectionOwner(sectionId: string) {
    if (serviceItemsById.has(sectionId)) {
      return "service";
    }
    if (worshipSetItemsById.has(sectionId)) {
      return "worship";
    }
    return null;
  }

  function worshipAnchorItem() {
    return orderedPlanItems().find((item) => item.item_type === WORSHIP_SET_ANCHOR_ITEM_TYPE) ?? null;
  }

  function sequenceForInsertInItems(orderedItems: PlanItem[], afterIndex: number) {
    const previous = afterIndex >= 0 ? orderedItems[afterIndex] : null;
    const next = orderedItems[afterIndex + 1] ?? null;
    const previousSequence = previous ? Number.parseFloat(previous.sequence) || 0 : null;
    const nextSequence = next ? Number.parseFloat(next.sequence) || 0 : null;

    if (previousSequence !== null && nextSequence !== null) {
      return ((previousSequence + nextSequence) / 2).toFixed(2);
    }
    if (previousSequence !== null) {
      return (previousSequence + 10).toFixed(2);
    }
    if (nextSequence !== null) {
      return Math.max(nextSequence / 2, 1).toFixed(2);
    }
    return "10.00";
  }

  function sequenceForInsert(afterIndex: number) {
    const orderedItems = orderedPlanItemsWithWorshipAnchor();
    if (afterIndex < 0) {
      const firstSection = sections[0] ?? null;
      const firstOwner = firstSection ? sectionOwner(firstSection.id) : null;
      if (firstOwner === "service") {
        return sequenceForInsertInItems(
          orderedItems,
          orderedItems.findIndex((item) => item.id === firstSection.id) - 1,
        );
      }
      if (firstOwner === "worship") {
        const anchorIndex = orderedItems.findIndex((item) => item.item_type === WORSHIP_SET_ANCHOR_ITEM_TYPE);
        return sequenceForInsertInItems(orderedItems, anchorIndex - 1);
      }
      return sequenceForInsertInItems(orderedItems, -1);
    }

    const section = sections[afterIndex] ?? null;
    const owner = section ? sectionOwner(section.id) : null;

    if (owner === "service") {
      return sequenceForInsertInItems(
        orderedItems,
        orderedItems.findIndex((item) => item.id === section.id),
      );
    }

    if (owner === "worship") {
      const anchorIndex = orderedItems.findIndex((item) => item.item_type === WORSHIP_SET_ANCHOR_ITEM_TYPE);
      return sequenceForInsertInItems(orderedItems, anchorIndex);
    }

    return sequenceForInsertInItems(orderedItems, orderedItems.length - 1);
  }

  function suggestedWorshipSetTitleForService(servicePlan: PlanDetail) {
    return `Worship Set ${serviceLongDateForInput(dateInputFromIso(servicePlan.service_date))}`;
  }

  async function ensureWorshipSetForCurrentService() {
    if (!plan) {
      return null;
    }

    const setType = worshipSetType(planTypes);
    if (!setType) {
      setMessage("The Worship Set plan type has not been installed yet. Run migrations and rebuild the API.");
      return null;
    }

    let targetSet = worshipSetPlan;
    if (!targetSet) {
      targetSet = await createPlan({
        plan_type_id: setType.id,
        service_date: plan.service_date,
        title: suggestedWorshipSetTitleForService(plan),
        subtitle: null,
        leader_id: null,
        teacher_id: null,
        status: "draft",
        info: `Song set for ${plan.title}`,
      });
    }

    const serviceSongItems = orderedPlanItems().filter((item) => item.item_type === "song" && item.song_id);
    if (serviceSongItems.length) {
      const existingSongIds = new Set(targetSet.items.map((item) => item.song_id).filter(Boolean));
      for (const item of serviceSongItems) {
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
      targetSet = await getPlan(targetSet.id);
    }

    return targetSet;
  }

  async function ensureWorshipAnchor(sequenceOverride?: string) {
    if (!plan) {
      return null;
    }

    const existing = worshipAnchorItem();
    if (existing) {
      return existing;
    }

    const serviceSongItems = orderedPlanItems().filter((item) => item.item_type === "song" && item.song_id);
    const syntheticAnchor = syntheticWorshipAnchor();
    const sequence =
      sequenceOverride ??
      serviceSongItems[0]?.sequence ??
      syntheticAnchor?.sequence ??
      sequenceForInsertInItems(orderedPlanItems(), orderedPlanItems().length - 1);
    return createPlanItem(plan.id, {
      item_type: WORSHIP_SET_ANCHOR_ITEM_TYPE,
      sequence,
      title: "Worship songs",
      comment: null,
      key_signature: null,
      song_id: null,
    });
  }

  function sequenceForSongInsert(afterIndex: number, targetSet: PlanDetail) {
    const orderedItems = [...targetSet.items]
      .filter((item) => item.item_type === "song" && item.song_id)
      .sort((first, second) => (Number.parseFloat(first.sequence) || 0) - (Number.parseFloat(second.sequence) || 0));
    const section = sections[afterIndex] ?? null;

    if (section && orderedItems.some((item) => item.id === section.id)) {
      return sequenceForInsertInItems(
        orderedItems,
        orderedItems.findIndex((item) => item.id === section.id),
      );
    }

    const previousWorshipSection = [...sections.slice(0, afterIndex + 1)]
      .reverse()
      .find((candidate) => orderedItems.some((item) => item.id === candidate.id));
    if (previousWorshipSection) {
      return sequenceForInsertInItems(
        orderedItems,
        orderedItems.findIndex((item) => item.id === previousWorshipSection.id),
      );
    }

    const nextWorshipSection = sections.slice(afterIndex + 1).find((candidate) => orderedItems.some((item) => item.id === candidate.id));
    if (nextWorshipSection) {
      return sequenceForInsertInItems(
        orderedItems,
        orderedItems.findIndex((item) => item.id === nextWorshipSection.id) - 1,
      );
    }

    return sequenceForInsertInItems(orderedItems, orderedItems.length - 1);
  }

  async function songInsertTarget(afterIndex: number) {
    const targetSet = await ensureWorshipSetForCurrentService();
    if (!targetSet) {
      return null;
    }

    return {
      anchorSequence: sequenceForInsert(afterIndex),
      planId: targetSet.id,
      sequence: sequenceForSongInsert(afterIndex, targetSet),
    };
  }

  function activeSectionInsertIndex() {
    if (!liveSlide) {
      return sections.length - 1;
    }
    return sections.findIndex((section) => section.id === liveSlide.sectionId);
  }

  function captureOperatorScrollPositions() {
    return {
      rail: captureScrollPosition(sectionRailListRef.current),
      sorter: captureScrollPosition(slideGridRef.current),
    };
  }

  function restoreOperatorScrollPositions(position: { rail: number; sorter: number }) {
    suppressNextOperatorScrollRef.current = true;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (slideGridRef.current) {
          slideGridRef.current.scrollTop = position.sorter;
        }
        if (sectionRailListRef.current) {
          sectionRailListRef.current.scrollTop = position.rail;
        }
      });
    });
  }

  async function reloadPreservingOperatorScroll(options?: { refreshCatalogs?: boolean }) {
    if (!plan) {
      return;
    }
    const scrollPosition = captureOperatorScrollPositions();
    suppressNextOperatorScrollRef.current = true;
    await load(plan.id, { refreshCatalogs: options?.refreshCatalogs });
    restoreOperatorScrollPositions(scrollPosition);
  }

  async function reloadAfterInsertedItem(createdItem: PlanItem | null | undefined, options?: { refreshCatalogs?: boolean }) {
    if (!plan) {
      return;
    }

    if (searchSelectInserted && createdItem) {
      await load(plan.id, {
        preserveLocation: {
          planItemId: createdItem.id,
          slideOffset: 0,
        },
        refreshCatalogs: options?.refreshCatalogs,
      });
      return;
    }

    await reloadPreservingOperatorScroll(options);
  }

  function openSearchOverlay(
    afterIndex = activeSectionInsertIndex(),
    mode: SearchOverlayMode = "bible",
    options?: { selectInserted?: boolean },
  ) {
    if (!canEditPlan) {
      setMessage("You can present this plan, but only worship team members, worship leaders, and service leaders can change the running order.");
      return;
    }
    setSearchInsertIndex(afterIndex);
    setSearchMode(mode);
    setSearchSelectInserted(options?.selectInserted ?? mode === "bible");
    setSearchOverlayOpen(true);
  }

  function closeSearchOverlay() {
    setSearchOverlayOpen(false);
    setSearchLoading(false);
    setBibleSearchResults([]);
    setCustomProviderLoading(false);
    setCustomProviderResult(null);
    setSelectedCustomProviderMatchId(null);
    setCustomProviderSelection(null);
    setCustomProviderSelectionLoading(false);
    setGoogleDriveFiles([]);
    setGoogleDriveLoading(false);
    setGoogleDriveError("");
    setSearchQuery("");
    setSearchInsertIndex(null);
    setSearchSelectInserted(false);
    setDeckFile(null);
    setDeckFlattenBuilds(false);
    setDeckTitle("");
    setDeckTitleTouched(false);
    setVideoTitle("");
    setVideoFile(null);
  }

  async function insertSongById(songId: string, afterIndex: number, fallbackTitle?: string) {
    if (!plan) {
      setMessage("Select a plan before adding a song.");
      return;
    }
    if (!canEditPlan) {
      setMessage("Only worship team members, worship leaders, and service leaders can add songs to the running order.");
      return;
    }

    const song = songs.find((candidate) => candidate.id === songId);
    if (!song && !fallbackTitle) {
      setMessage("Choose a song first.");
      return;
    }

    const target = await songInsertTarget(afterIndex);
    if (!target?.planId) {
      setMessage("Select a service before adding a song.");
      return;
    }

    const createdItem = await createPlanItem(target.planId, {
      item_type: "song",
      sequence: target.sequence,
      title: song?.title ?? fallbackTitle ?? "Song",
      comment: null,
      key_signature: null,
      song_id: songId,
    });
    const anchorBefore = worshipAnchorItem();
    const anchor = await ensureWorshipAnchor(target.anchorSequence);
    setUndoAction({
      label: `adding "${createdItem.title}"`,
      run: async () => {
        await deletePlanItem(createdItem.id);
        if (!anchorBefore && anchor) {
          await deletePlanItem(anchor.id);
        }
        await load(plan.id);
      },
    });
    void recordServiceHistory(`adding "${createdItem.title}"`, "Worship set", "song");
    return createdItem;
  }

  async function runCustomSongImportSearch() {
    const query = searchQuery.trim();
    if (!query) {
      setCustomProviderResult(null);
      return;
    }

    setCustomProviderLoading(true);
    setSelectedCustomProviderMatchId(null);
    setCustomProviderSelection(null);

    try {
      const result = await runCustomProviderSearch(query);
      setCustomProviderResult(result);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not search your custom provider.");
      setCustomProviderResult(null);
    } finally {
      setCustomProviderLoading(false);
    }
  }

  async function loadCustomProviderMatch(match: CustomProviderMatch) {
    setSelectedCustomProviderMatchId(match.id);
    setCustomProviderSelectionLoading(true);

    try {
      const selection = await selectCustomProviderMatch(match.id);
      setCustomProviderSelection(selection);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load imported lyrics.");
      setCustomProviderSelection(null);
    } finally {
      setCustomProviderSelectionLoading(false);
    }
  }

  async function importSelectedCustomProviderSong() {
    if (!plan) {
      setMessage("Select a plan before importing a song.");
      return;
    }
    if (!canEditPlan) {
      setMessage("Only worship team members, worship leaders, and service leaders can add songs to the running order.");
      return;
    }
    if (!selectedCustomProviderMatch || !customProviderSelection?.output_text) {
      setMessage("Choose a matched song with lyrics first.");
      return;
    }

    const resolvedTitle = selectedCustomProviderMatch.title.trim() || customProviderSelection.title?.trim() || "";
    const duplicate = findDuplicateSong(resolvedTitle);
    if (!duplicate && !canCreateSong) {
      setMessage("Importing a new song into the library needs song-create permission.");
      return;
    }

    try {
      let songId = duplicate?.id ?? null;

      if (!songId) {
        const analysis = analyzeWorshipText(customProviderSelection.output_text, { title: resolvedTitle });
        const importedSong = await createSong({
          title: resolvedTitle,
          alternate_title: null,
          author: selectedCustomProviderMatch.subtitle?.trim() || null,
          lyrics: canonicalizeWorshipLyrics(buildLyricsFromSections(analysis.sections) || analysis.lyrics, analysis.sequence),
          chords: null,
          ccli_number: null,
          book_reference: null,
          license: "Unknown",
          sequence: analysis.sequence,
          youtube_id: null,
          external_link: null,
          worship_role: "any",
          energy: 3,
          tempo: null,
          theme_tags: null,
        });
        songId = importedSong.id;
        setSongs((current) => [...current, importedSong]);
      }

      const createdItem = await insertSongById(songId, searchInsertIndex ?? activeSectionInsertIndex(), resolvedTitle);
      await reloadAfterInsertedItem(createdItem, { refreshCatalogs: true });
      closeSearchOverlay();
      setMessage(
        duplicate
          ? `Added existing song "${duplicate.title}" to this service.`
          : `Imported "${resolvedTitle}" and added it to this service.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import this song into the service.");
    }
  }

  async function insertBibleResult(result: BibleSearchHit, afterIndex: number) {
    if (!plan) {
      setMessage("Select a plan before adding Scripture.");
      return;
    }
    if (!canEditPlan) {
      setMessage("Only worship team members, worship leaders, and service leaders can add Scripture to the running order.");
      return;
    }
    const createdItem = await createPlanItem(plan.id, {
      item_type: "reading",
      sequence: sequenceForInsert(afterIndex),
      title: result.reference,
      comment: result.text,
      key_signature: result.version,
      song_id: null,
    });
    setUndoAction({
      label: `adding ${result.reference}`,
      run: async () => {
        await deletePlanItem(createdItem.id);
        await load(plan.id);
      },
    });
    void recordServiceHistory(`adding ${result.reference}`, "Service", "reading");
    return createdItem;
  }

  async function addSongSearchResult(song: Song) {
    try {
      const createdItem = await insertSongById(song.id, searchInsertIndex ?? activeSectionInsertIndex());
      await reloadAfterInsertedItem(createdItem, { refreshCatalogs: true });
      closeSearchOverlay();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add song.");
    }
  }

  async function addBibleSearchResult(result: BibleSearchHit) {
    try {
      const createdItem = await insertBibleResult(result, searchInsertIndex ?? activeSectionInsertIndex());
      await reloadAfterInsertedItem(createdItem);
      closeSearchOverlay();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add Scripture.");
    }
  }

  async function addVideoSearchResult() {
    if (!plan) {
      setMessage("Select a plan before adding a video.");
      return;
    }
    if (!canEditPlan) {
      setMessage("Only worship team members, worship leaders, and service leaders can add videos to the running order.");
      return;
    }

    const query = searchQuery.trim();
    const videoId = extractYouTubeId(query);
    if (!videoId && !videoFile) {
      setMessage("Paste a valid YouTube link or choose a local video file.");
      return;
    }

    try {
      if (videoFile && !canAttachDeck) {
        setMessage("Uploading a local video requires library upload access.");
        return;
      }

      const resolvedTitle = videoTitle.trim() || videoFile?.name.replace(/\.[^.]+$/, "") || "YouTube Video";
      const createdItem = await createPlanItem(plan.id, {
        item_type: "video",
        sequence: sequenceForInsert(searchInsertIndex ?? activeSectionInsertIndex()),
        title: resolvedTitle,
        comment: videoId,
        key_signature: videoFile ? "video-file" : "youtube",
        song_id: null,
      });
      if (videoFile) {
        const stored = await uploadStoredFile({
          file: videoFile,
          display_name: resolvedTitle,
        });
        await attachItemFile(createdItem.id, { file_id: stored.id, sort_order: 0 });
      }
      void recordServiceHistory(`adding "${resolvedTitle}"`, "Service", "video");
      setUndoAction({
        label: `adding "${resolvedTitle}"`,
        run: async () => {
          await deletePlanItem(createdItem.id);
          await load(plan.id);
        },
      });
      await reloadAfterInsertedItem(createdItem);
      closeSearchOverlay();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add YouTube video.");
    }
  }

  async function selectTopSearchResult() {
    if (googleDriveLoading || customProviderLoading || customProviderSelectionLoading) {
      return;
    }
    if (searchMode === "songs") {
      const firstSong = songSearchResults[0];
      if (firstSong) {
        await addSongSearchResult(firstSong);
      }
      return;
    }
    if (searchMode === "bible") {
      const firstResult = bibleSearchResults[0] ?? (searchQuery.trim() ? (await runBibleSearch())[0] : null);
      if (firstResult) {
        await addBibleSearchResult(firstResult);
      }
      return;
    }
    if (searchMode === "deck") {
      if (deckFile) {
        await attachDeckToPlan();
        return;
      }
      const firstFile = googleDriveFiles[0];
      if (firstFile) {
        await attachImportedDriveDeck(firstFile);
      }
      return;
    }
    if (searchMode === "video") {
      await addVideoSearchResult();
    }
  }

  function handleSearchEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void selectTopSearchResult();
  }

  async function navigateBibleReading(mode: "verse" | "chapter", delta: -1 | 1) {
    if (!plan || !currentPlanItem || currentPlanItem.item_type !== "reading") {
      return;
    }
    if (!canEditPlan) {
      setMessage("Bible passage navigation updates the plan, so it is only available to worship team members, worship leaders, and service leaders.");
      return;
    }

    const parsed = parseBibleReference(currentPlanItem.title);
    if (!parsed) {
      setMessage("This reading does not have a standard Bible reference yet.");
      return;
    }
    const currentReference = parsed;

    const span = Math.max(currentReference.verseTo - currentReference.verseFrom, 0);
    const versionCode = currentPlanItem.key_signature || bibleVersion || "KJV";
    const currentSlideOffset = Math.max(
      slides.findIndex((slide) => slide.id === liveSlide?.id) -
        slides.findIndex((slide) => slide.planItemId === currentPlanItem.id),
      0,
    );

    async function resolveVerseStep() {
      const sameChapterVerse = currentReference.verseFrom + delta;
      if (sameChapterVerse > 0) {
        const sameChapterPassage = await tryFetchBiblePassage(
          versionCode,
          currentReference.book,
          currentReference.chapter,
          sameChapterVerse,
          span > 0 ? sameChapterVerse + span : undefined,
        );
        if (sameChapterPassage) {
          return sameChapterPassage;
        }
      }

      const nextChapter = currentReference.chapter + delta;
      if (nextChapter < 1) {
        return null;
      }

      if (delta > 0) {
        for (let verseFrom = 1; verseFrom <= 12; verseFrom += 1) {
          const passage = await tryFetchBiblePassage(
            versionCode,
            currentReference.book,
            nextChapter,
            verseFrom,
            span > 0 ? verseFrom + span : undefined,
          );
          if (passage) {
            return passage;
          }
        }
        return null;
      }

      for (let verseFrom = 200; verseFrom >= 1; verseFrom -= 1) {
        const passage = await tryFetchBiblePassage(
          versionCode,
          currentReference.book,
          nextChapter,
          verseFrom,
          span > 0 ? verseFrom + span : undefined,
        );
        if (passage) {
          return passage;
        }
      }
      return null;
    }

    async function resolveChapterStep() {
      const targetChapter = currentReference.chapter + delta;
      if (targetChapter < 1) {
        return null;
      }

      const verseFrom = 1;
      for (let verseTo = verseFrom + span; verseTo >= verseFrom; verseTo -= 1) {
        const passage = await tryFetchBiblePassage(
          versionCode,
          currentReference.book,
          targetChapter,
          verseFrom,
          verseTo > verseFrom ? verseTo : undefined,
        );
        if (passage) {
          return passage;
        }
      }
      return null;
    }

    try {
      const passage = mode === "verse" ? await resolveVerseStep() : await resolveChapterStep();
      if (!passage) {
        setMessage("No adjacent passage was found in this book.");
        return;
      }
      await updatePlanItem(currentPlanItem.id, {
        title: passage.reference,
        comment: passage.text,
        key_signature: versionCode,
      });
      void recordServiceHistory(`moving reading to ${passage.reference}`, currentPlanItem.title, "reading");
      setBibleVersion(versionCode);
      await load(plan.id, {
        preserveLocation: {
          planItemId: currentPlanItem.id,
          slideOffset: currentSlideOffset,
        },
        silent: true,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not move to the next Bible passage.");
    }
  }

  async function attachDeckToPlan() {
    if (!plan) {
      setMessage("Select a plan before attaching a deck.");
      return;
    }
    if (!canEditPlan || !canAttachDeck) {
      setMessage("Adding slide decks requires plan editing and library upload access.");
      return;
    }

    if (!deckFile) {
      setMessage("Choose a sermon or slide deck file first.");
      return;
    }

    try {
      const resolvedDeckTitle = deckTitle.trim() || "Sermon";
      if (plan.items.some((item) => item.item_type === "sermon" && item.title.trim().toLowerCase() === resolvedDeckTitle.toLowerCase())) {
        setMessage(`"${resolvedDeckTitle}" is already in this service.`);
        return;
      }
      const stored = await uploadStoredFile({
        file: deckFile,
        display_name: resolvedDeckTitle,
        flatten_builds: deckFlattenBuilds,
      });
      const item = await createPlanItem(plan.id, {
        item_type: "sermon",
        sequence: sequenceForInsert(searchInsertIndex ?? sections.length - 1),
        title: resolvedDeckTitle,
        comment: `Attached slide deck: ${stored.display_name}`,
        key_signature: null,
        song_id: null,
      });
      await attachItemFile(item.id, { file_id: stored.id, sort_order: 0 });
      void recordServiceHistory(`adding "${resolvedDeckTitle}"`, "Service", "slide_deck");
      setDeckFile(null);
      await reloadAfterInsertedItem(item);
      closeSearchOverlay();
    } catch (error) {
      if (error instanceof ApiError && error.status === 413) {
        setMessage(
          googleDriveStatus?.connected
            ? "This upload was blocked before it reached cspot. Use Google Drive import for this deck, or try a smaller PDF."
            : "This upload was blocked before it reached cspot. If this keeps happening on the hosted site, import from Google Drive or try a smaller PDF.",
        );
        return;
      }
      setMessage(error instanceof Error ? error.message : "Could not attach slide deck.");
    }
  }

  async function attachImportedDriveDeck(file: GoogleDriveFile) {
    if (!plan) {
      setMessage("Select a plan before attaching a deck.");
      return;
    }
    if (!canEditPlan || !canAttachDeck) {
      setMessage("Adding slide decks requires plan editing and library upload access.");
      return;
    }

    try {
      const resolvedDeckTitle = deckTitle.trim() || file.name.replace(/\.[^.]+$/, "") || "Sermon";
      if (
        plan.items.some(
          (item) =>
            item.item_type === "sermon" &&
            (item.title.trim().toLowerCase() === resolvedDeckTitle.toLowerCase() ||
              item.comment?.trim().toLowerCase() === `imported from google drive: ${file.name}`.toLowerCase()),
        )
      ) {
        setMessage(`"${resolvedDeckTitle}" is already in this service.`);
        return;
      }
      const imported = await importGoogleDriveDeck({
        file_id: file.id,
        display_name: resolvedDeckTitle,
        flatten_builds: deckFlattenBuilds,
      });
      const item = await createPlanItem(plan.id, {
        item_type: "sermon",
        sequence: sequenceForInsert(searchInsertIndex ?? sections.length - 1),
        title: resolvedDeckTitle,
        comment: `Imported from Google Drive: ${file.name}`,
        key_signature: null,
        song_id: null,
      });
      await attachItemFile(item.id, { file_id: imported.file.id, sort_order: 0 });
      void recordServiceHistory(`importing "${resolvedDeckTitle}"`, "Service", "slide_deck");
      await reloadAfterInsertedItem(item);
      closeSearchOverlay();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import this Google Drive deck.");
    }
  }

  async function removeSection(sectionId: string) {
    if (!plan || !canEditPlan) {
      return;
    }

    const owner = sectionOwner(sectionId);
    if (owner === "worship" && !worshipSetPlan) {
      setMessage("Could not find the worship set for this song.");
      return;
    }

    try {
      const removingLastWorshipSong =
        owner === "worship" &&
        orderedWorshipSetItems().filter((item) => item.item_type === "song" && item.song_id).length <= 1;
      const targetPlanId = owner === "worship" ? worshipSetPlan?.id : plan.id;
      const removedItem = owner === "worship" ? worshipSetItemsById.get(sectionId) : serviceItemsById.get(sectionId);
      const removedAnchor = removingLastWorshipSong ? worshipAnchorItem() : null;
      await deletePlanItem(sectionId);
      if (removingLastWorshipSong) {
        const anchor = worshipAnchorItem();
        if (anchor) {
          await deletePlanItem(anchor.id);
        }
      }
      if (targetPlanId && removedItem) {
        setUndoAction({
          label: `removing "${removedItem.title}"`,
          run: async () => {
            await createPlanItem(targetPlanId, {
              item_type: removedItem.item_type,
              sequence: removedItem.sequence,
              title: removedItem.title,
              comment: removedItem.comment,
              key_signature: removedItem.key_signature,
              song_id: removedItem.song_id,
            });
            if (removedAnchor) {
              await createPlanItem(plan.id, {
                item_type: removedAnchor.item_type,
                sequence: removedAnchor.sequence,
                title: removedAnchor.title,
                comment: removedAnchor.comment,
                key_signature: removedAnchor.key_signature,
                song_id: removedAnchor.song_id,
              });
            }
            await reloadPreservingOperatorScroll();
          },
        });
      }
      if (removedItem) {
        void recordServiceHistory(`removing "${removedItem.title}"`, owner === "worship" ? "Worship set" : "Service", removedItem.item_type);
      }
      await reloadPreservingOperatorScroll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove section.");
    }
  }

  async function moveSection(sectionId: string, delta: -1 | 1) {
    if (!plan || !canEditPlan) {
      return;
    }

    const owner = sectionOwner(sectionId);
    if (!owner) {
      return;
    }

    let orderedItems = owner === "worship" ? orderedWorshipSetItems() : orderedPlanItems();
    if (owner === "service" && worshipSetPlan?.items.some((item) => item.item_type === "song" && item.song_id)) {
      const anchor = await ensureWorshipAnchor();
      if (anchor && !orderedItems.some((item) => item.id === anchor.id)) {
        orderedItems = [...orderedItems, anchor].sort((first, second) => {
          const firstSequence = Number.parseFloat(first.sequence) || 0;
          const secondSequence = Number.parseFloat(second.sequence) || 0;
          return firstSequence - secondSequence;
        });
      }
    }
    const itemIndex = orderedItems.findIndex((item) => item.id === sectionId);
    const target = orderedItems[itemIndex + delta];
    const item = orderedItems[itemIndex];
    if (!item || !target) {
      return;
    }

    try {
      const originalItemSequence = item.sequence;
      const originalTargetSequence = target.sequence;
      await Promise.all([
        updatePlanItem(item.id, { sequence: target.sequence }),
        updatePlanItem(target.id, { sequence: item.sequence }),
      ]);
      setUndoAction({
        label: `moving "${item.title}"`,
        run: async () => {
          await Promise.all([
            updatePlanItem(item.id, { sequence: originalItemSequence }),
            updatePlanItem(target.id, { sequence: originalTargetSequence }),
          ]);
          await reloadPreservingOperatorScroll();
        },
      });
      void recordServiceHistory(`moving "${item.title}"`, owner === "worship" ? "Worship set" : "Service", item.item_type);
      await reloadPreservingOperatorScroll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reorder section.");
    }
  }

  async function runUndoAction() {
    if (!undoAction) {
      return;
    }

    const action = undoAction;
    setUndoAction(null);
    try {
      await action.run();
      setMessage(`Undid ${action.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not undo ${action.label}.`);
    }
  }

  async function addBiblePassageSlide() {
    if (!plan) {
      setMessage("Select a plan before adding Scripture.");
      return;
    }
    if (!canEditPlan) {
      setMessage("Only worship team members, worship leaders, and service leaders can add Scripture slides.");
      return;
    }

    try {
      const passage = await getBiblePassage(
        bibleVersion,
        bibleBook,
        Number(bibleChapter),
        Number(bibleVerseFrom),
        bibleVerseTo ? Number(bibleVerseTo) : undefined,
      );
      const createdItem = await insertBibleResult(
        {
          version: passage.version,
          reference: passage.reference,
          text: passage.text,
          book: bibleBook,
          chapter: Number(bibleChapter),
          verse_from: Number(bibleVerseFrom),
          verse_to: bibleVerseTo ? Number(bibleVerseTo) : Number(bibleVerseFrom),
        },
        searchInsertIndex ?? sections.length - 1,
      );
      await reloadAfterInsertedItem(createdItem);
      closeSearchOverlay();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Could not add Scripture slide.";
      setMessage(
        messageText.includes("404")
          ? "Passage not found in the local Bible data yet. Try John 3:16 WEB, or import more Bible text later."
          : messageText,
      );
    }
  }

  useEffect(() => {
    void load(undefined, { refreshCatalogs: true });
  }, []);

  useEffect(() => {
    setTopbarSlot(document.getElementById("workspace-topbar-slot"));
  }, []);

  useEffect(() => {
    async function loadBibleOptions() {
      try {
        const [versions, books] = await Promise.all([getBibleVersions(), getBibleBooks()]);
        setBibleVersions(versions);
        setBibleBooks(books);
        setBibleVersion((current) => {
          if (versions.some((version) => version.code === current)) {
            return current;
          }
          return versions.find((version) => version.code === "KJV")?.code || versions[0]?.code || "";
        });
        setBibleBook((current) =>
          books.some((book) => book.name === current) ? current : books[0]?.name || "",
        );
      } catch {
        setBibleVersions([]);
        setBibleBooks([]);
      }
    }

    void loadBibleOptions();
  }, []);

  useEffect(() => {
    const files = (plan?.items ?? []).flatMap((item) => item.files ?? []);
    const activeFileIds = new Set(currentPlanItem?.files?.map((file) => file.file_id) ?? []);
    const uniqueFiles = Array.from(new Map(files.map((file) => [file.file_id, file])).values());
    const availableFileIds = new Set(uniqueFiles.map((file) => file.file_id));

    setRenderedSlidesByFileId((previous) => {
      const nextEntries = Object.entries(previous).filter(([fileId]) => availableFileIds.has(fileId));
      if (nextEntries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(nextEntries);
    });
    setRenderErrorsByFileId((previous) => {
      const nextEntries = Object.entries(previous).filter(([fileId]) => availableFileIds.has(fileId));
      if (nextEntries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(nextEntries);
    });
    setRenderingFileIds((previous) => {
      const next = previous.filter((fileId) => availableFileIds.has(fileId));
      return next.length === previous.length ? previous : next;
    });

    const pendingFiles = uniqueFiles.filter(
      (file) =>
        !renderedSlidesByFileId[file.file_id] &&
        !renderErrorsByFileId[file.file_id] &&
        !activeDeckLoadsRef.current.has(file.file_id),
    );

    if (!pendingFiles.length) {
      return;
    }

    const prioritizedFiles = pendingFiles.sort((left, right) => {
      const leftActive = activeFileIds.has(left.file_id) ? 1 : 0;
      const rightActive = activeFileIds.has(right.file_id) ? 1 : 0;
      return rightActive - leftActive;
    });
    const nextBatch = prioritizedFiles.slice(0, activeFileIds.size ? 2 : 1);
    const nextBatchIds = nextBatch.map((file) => file.file_id);

    nextBatchIds.forEach((fileId) => activeDeckLoadsRef.current.add(fileId));
    setRenderingFileIds((previous) => [...new Set([...previous, ...nextBatchIds])]);

    void Promise.all(
      nextBatch.map(async (file) => {
        try {
          const renderedSlides = await getFileSlides(file.file_id);
          if (!renderedSlides.length) {
            window.setTimeout(() => setDeckRenderRetryToken((current) => current + 1), 1500);
            return;
          }
          setRenderedSlidesByFileId((previous) => ({
            ...previous,
            [file.file_id]: renderedSlides,
          }));
          setRenderErrorsByFileId((previous) => {
            const next = { ...previous };
            delete next[file.file_id];
            return next;
          });
        } catch (error) {
          if (isTransientApiError(error)) {
            window.setTimeout(() => setDeckRenderRetryToken((current) => current + 1), 2500);
            return;
          }
          setRenderedSlidesByFileId((previous) => ({
            ...previous,
            [file.file_id]: [],
          }));
          setRenderErrorsByFileId((previous) => ({
            ...previous,
            [file.file_id]: error instanceof Error ? error.message : "Could not render this slide deck.",
          }));
        } finally {
          activeDeckLoadsRef.current.delete(file.file_id);
          setRenderingFileIds((previous) => previous.filter((fileId) => fileId !== file.file_id));
        }
      }),
    );
  }, [currentPlanItem, deckRenderRetryToken, plan, renderErrorsByFileId, renderedSlidesByFileId]);

  useEffect(() => {
    if (!message) {
      return;
    }
    showToast(message);
    const timer = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    channelRef.current = new BroadcastChannel(PRESENTATION_CHANNEL);
    return () => channelRef.current?.close();
  }, []);

  useEffect(() => {
    if (!searchOverlayOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchMode, searchOverlayOpen]);

  useEffect(() => {
    if (!deckFile || deckTitleTouched) {
      return;
    }

    const trimmedName = deckFile.name.replace(/\.[^.]+$/, "");
    const nextTitle = trimmedName.length > 42 ? `${trimmedName.slice(0, 39).trimEnd()}...` : trimmedName;
    setDeckTitle(nextTitle);
  }, [deckFile, deckTitleTouched]);

  useEffect(() => {
    if (!selectedPlanId) {
      return;
    }

    const timer = window.setInterval(() => {
      if (livePollInFlightRef.current) {
        return;
      }
      livePollInFlightRef.current = true;
      void (async () => {
        try {
          const previousPlanItemId = currentLiveStateRef.current?.planItemId ?? null;
          const remoteState = await getPresentationLiveState(selectedPlanId);
          if (remoteState.updated_at <= lastLiveStateRef.current) {
            return;
          }

          applyRemoteLiveState({
            planId: remoteState.plan_id,
            index: remoteState.index,
            updatedAt: remoteState.updated_at,
            planItemId: remoteState.plan_item_id,
            slideOffset: remoteState.slide_offset,
            theme: remoteState.theme,
            blanked: remoteState.blanked,
            fullscreen: remoteState.fullscreen,
            videoAction: remoteState.video_action,
            videoActionAt: remoteState.video_action_at ?? undefined,
          });
          if (remoteState.plan_item_id && remoteState.plan_item_id === previousPlanItemId) {
            await load(selectedPlanId, {
              preserveLocation: {
                planItemId: remoteState.plan_item_id,
                slideOffset: remoteState.slide_offset,
              },
              publishPreservedLocation: false,
              silent: true,
            });
          }
        } catch {
          // Keep local presentation usable even if sync polling fails briefly.
        } finally {
          livePollInFlightRef.current = false;
        }
      })();
    }, 900);

    return () => {
      livePollInFlightRef.current = false;
      window.clearInterval(timer);
    };
  }, [selectedPlanId, slides]);

  useEffect(() => {
    if (!currentLiveStateRef.current || currentLiveStateRef.current.planId !== selectedPlanId) {
      return;
    }

    setLiveIndex(resolveLiveIndex(slides, currentLiveStateRef.current));
  }, [selectedPlanId, slides]);

  useEffect(() => {
    syncSlideshowStatusFromStorage();

    const timer = window.setInterval(() => {
      syncSlideshowStatusFromStorage();
      if (outputWindowRef.current && outputWindowRef.current.closed) {
        outputWindowRef.current = null;
        localStorage.removeItem(PRESENTATION_OUTPUT_STATUS_KEY);
        setSlideshowOpen(false);
      }
    }, 500);

    function onStorage(event: StorageEvent) {
      if (event.key === PRESENTATION_OUTPUT_STATUS_KEY) {
        syncSlideshowStatusFromStorage();
      }
    }

    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [selectedPlanId]);

  useEffect(() => {
    if (suppressPublishRef.current) {
      suppressPublishRef.current = false;
      return;
    }
    void publishLiveState(liveIndex);
  }, [liveBlanked, slideTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const token = catchUpCheckTokenRef.current + 1;
    catchUpCheckTokenRef.current = token;
    const shouldFollowSorter = !sorterCatchUpDirectionRef.current;
    const shouldFollowRail = !railCatchUpDirectionRef.current;
    const timer = window.setTimeout(() => {
      if (catchUpCheckTokenRef.current !== token) {
        return;
      }
      const activeSlide = slides[liveIndex];
      if (activeSlide) {
        if (shouldFollowSorter) {
          scrollItemIntoOperatorView(slideGridRef.current, thumbnailRefs.current[activeSlide.id] ?? null);
        }
        if (shouldFollowRail) {
          scrollItemIntoOperatorView(sectionRailListRef.current, sectionRailRefs.current[activeSlide.sectionId] ?? null);
        }
      }
      window.requestAnimationFrame(() => {
        if (catchUpCheckTokenRef.current === token) {
          updateCatchUpDirectionsForSlide(liveIndex);
        }
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [liveIndex, slides]);

  useEffect(() => {
    const token = catchUpCheckTokenRef.current + 1;
    catchUpCheckTokenRef.current = token;
    const timer = window.setTimeout(() => {
      if (catchUpCheckTokenRef.current !== token) {
        return;
      }
      updateCatchUpDirectionsForSlide(liveIndex);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [sections]);

  useEffect(() => {
    const activeSlide = slides[liveIndex];
    if (!activeSlide) {
      sorterCatchUpDirectionRef.current = null;
      railCatchUpDirectionRef.current = null;
      setSorterCatchUpDirection(null);
      setRailCatchUpDirection(null);
      return;
    }
    if (suppressNextOperatorScrollRef.current) {
      suppressNextOperatorScrollRef.current = false;
      return;
    }
    const forceSync = scrollOperatorToSelectedSlideRef.current;
    scrollOperatorToSelectedSlideRef.current = false;
    if (!forceSync) {
      return;
    }

    window.requestAnimationFrame(() => {
      scrollItemIntoOperatorView(slideGridRef.current, thumbnailRefs.current[activeSlide.id] ?? null);
      scrollItemIntoOperatorView(sectionRailListRef.current, sectionRailRefs.current[activeSlide.sectionId] ?? null);
    });
  }, [liveIndex, sections, slides]);

  useEffect(() => {
    if (!searchOverlayOpen && !servicePickerOpen && !editingSongId) {
      keyCaptureRef.current?.focus({ preventScroll: true });
    }
  }, [editingSongId, plan?.id, searchOverlayOpen, servicePickerOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.type !== "keydown") {
        return;
      }
      if (handledKeyboardEventsRef.current.has(event)) {
        return;
      }

      const direction = slideKeyboardDirection(event);
      const editing = isEditableKeyboardTarget(event.target);

      if (event.key === "Escape" && editingSongId) {
        event.preventDefault();
        closeSongEditor();
        return;
      }
      if (event.key === "Escape" && searchOverlayOpen) {
        event.preventDefault();
        closeSearchOverlay();
        return;
      }
      if (event.key === "Enter" && searchOverlayOpen && !event.shiftKey) {
        event.preventDefault();
        void selectTopSearchResult();
        return;
      }
      if (event.key === "Escape" && servicePickerOpen) {
        event.preventDefault();
        setServicePickerOpen(false);
        return;
      }
      if ((event.key === "s" || event.key === "S") && !editing) {
        event.preventDefault();
        openSearchOverlay(activeSectionInsertIndex(), "bible", { selectInserted: true });
        return;
      }
      if (editing || searchOverlayOpen || servicePickerOpen) {
        return;
      }

      const verticalNavigation =
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.code === "ArrowDown" ||
        event.code === "ArrowUp" ||
        event.keyCode === 40 ||
        event.keyCode === 38 ||
        event.which === 40 ||
        event.which === 38;

      if (direction) {
        const eventKey = `${event.key}:${event.code}:${event.keyCode || event.which}`;
        const now = Date.now();
        const lastNavigation = lastKeyboardNavigationRef.current;
        if (
          lastNavigation &&
          lastNavigation.direction === direction &&
          lastNavigation.key === eventKey &&
          now - lastNavigation.time < 120
        ) {
          return;
        }
        lastKeyboardNavigationRef.current = { direction, key: eventKey, time: now };
        handledKeyboardEventsRef.current.add(event);
        event.preventDefault();
        clearHotkeyButtonFocus();
        if (verticalNavigation && currentPlanItem?.item_type === "reading" && canEditPlan) {
          void navigateBibleReading("verse", direction);
        } else {
          moveLive(direction);
        }
        return;
      }

      if (event.key === "F5") {
        event.preventDefault();
        clearHotkeyButtonFocus();
        void startSlideshow();
        return;
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        clearHotkeyButtonFocus();
        void startSlideshow();
        return;
      }
      if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        clearHotkeyButtonFocus();
        setLiveBlankedAndPublish(!liveBlanked);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clearHotkeyButtonFocus();
        setLiveBlankedAndPublish(false);
        return;
      }
      if (/^[1-9]$/.test(event.key)) {
        const section = sections[Number(event.key) - 1];
        if (section) {
          event.preventDefault();
          const sectionStart = slides.findIndex((slide) => slide.sectionId === section.id);
          setLiveSlide(sectionStart);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [
    canEditPlan,
    currentPlanItem,
    editingSongId,
    liveBlanked,
    liveIndex,
    plan,
    screens,
    searchOverlayOpen,
    searchMode,
    searchQuery,
    searchLoading,
    googleDriveLoading,
    customProviderLoading,
    customProviderSelectionLoading,
    songSearchResults,
    bibleSearchResults,
    googleDriveFiles,
    deckFile,
    selectedScreenIndex,
    servicePickerOpen,
    slides,
    sections,
  ]);

  async function runBibleSearch(): Promise<BibleSearchHit[]> {
    const query = searchQuery.trim();
    if (!query) {
      setBibleSearchResults([]);
      return [];
    }
    setSearchLoading(true);
    try {
      const referenceQuery = normalizeBibleReferenceSearchQuery(query, bibleBooks);
      const [referenceMatches, keywordMatches] = await Promise.all([
        searchBible({
          q: referenceQuery,
          version_code: bibleVersion || "KJV",
          search_type: "reference",
          limit: 8,
        }).catch(() => []),
        searchBible({
          q: query,
          version_code: bibleVersion || "KJV",
          search_type: "keyword",
          limit: 20,
        }).catch(() => []),
      ]);

      const merged = [...referenceMatches, ...keywordMatches].filter((result, index, all) => {
        const key = `${result.version}:${result.reference}:${result.verse_from}:${result.verse_to}`;
        return all.findIndex((candidate) => (
          `${candidate.version}:${candidate.reference}:${candidate.verse_from}:${candidate.verse_to}` === key
        )) === index;
      });

      setBibleSearchResults(merged);
      setMessage(null);
      return merged;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not search Bible.");
      setBibleSearchResults([]);
      return [];
    } finally {
      setSearchLoading(false);
    }
  }

  useEffect(() => {
    if (!searchOverlayOpen || searchMode !== "bible") {
      return;
    }

    const query = searchQuery.trim();
    if (!query) {
      setBibleSearchResults([]);
      setSearchLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      void runBibleSearch();
    }, 180);

    return () => window.clearTimeout(timer);
  }, [bibleVersion, searchMode, searchOverlayOpen, searchQuery]);

  useEffect(() => {
    if (!searchOverlayOpen || searchMode !== "deck") {
      return;
    }

    void getGoogleDriveStatus()
      .then((status) => {
        setGoogleDriveStatus(status);
        setGoogleDriveError("");
      })
      .catch((error: unknown) => {
        setGoogleDriveStatus(null);
        setGoogleDriveError(error instanceof Error ? error.message : "Could not check Google Drive connection.");
      });
  }, [searchMode, searchOverlayOpen]);

  useEffect(() => {
    if (!searchOverlayOpen || searchMode !== "deck" || !googleDriveStatus?.connected) {
      return;
    }

    const timer = window.setTimeout(() => {
      setGoogleDriveLoading(true);
      setGoogleDriveError("");
      void searchGoogleDriveFiles(searchQuery.trim())
        .then((files) => {
          setGoogleDriveFiles(files);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Could not search Google Drive.";
          setGoogleDriveError(message);
          setMessage(message);
          setGoogleDriveFiles([]);
        })
        .finally(() => {
          setGoogleDriveLoading(false);
        });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [googleDriveStatus?.connected, searchMode, searchOverlayOpen, searchQuery]);

  return (
    <section
      className="presentation-workspace"
      aria-label="Presentation preview"
      onPointerDownCapture={(event) => {
        if (!isEditableKeyboardTarget(event.target)) {
          keyCaptureRef.current?.focus({ preventScroll: true });
        }
      }}
    >
      <input
        aria-hidden="true"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="slide-key-capture"
        data-slide-key-capture="true"
        inputMode="none"
        ref={keyCaptureRef}
        spellCheck={false}
        tabIndex={-1}
      />
      {topbarSlot
        ? createPortal(
            <div className="presentation-topbar-tools">
              <button
                className="text-button topbar-service-button"
                disabled={loading}
                onClick={openServicePicker}
                title="Choose or create a service"
                type="button"
              >
                <CalendarDays size={16} aria-hidden="true" />
                <span>{plan ? `${formatServiceDate(plan.service_date)} · ${plan.title}` : "Choose service"}</span>
              </button>
            </div>,
            topbarSlot,
          )
        : null}
      {servicePickerOpen ? (
        <div className="app-dialog-backdrop" role="presentation" onMouseDown={() => setServicePickerOpen(false)}>
          <section
            aria-labelledby="service-picker-title"
            className="app-dialog app-dialog-wide service-picker-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">Calendar</p>
                <h2 id="service-picker-title">Services</h2>
              </div>
              <button className="text-button" onClick={() => setServicePickerOpen(false)} type="button">
                Close
              </button>
            </div>

            <div className="service-picker-grid">
              <section className="service-picker-panel service-calendar-panel">
                <div className="service-calendar-heading">
                  <button
                    aria-label="Previous month"
                    className="text-button"
                    onClick={() => {
                      const month = monthDateFromInput(serviceCalendarMonth);
                      month.setMonth(month.getMonth() - 1);
                      setServiceCalendarMonth(monthInputFromDate(month));
                    }}
                    type="button"
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <strong>{SERVICE_MONTH_FORMATTER.format(monthDateFromInput(serviceCalendarMonth))}</strong>
                  <button
                    aria-label="Next month"
                    className="text-button"
                    onClick={() => {
                      const month = monthDateFromInput(serviceCalendarMonth);
                      month.setMonth(month.getMonth() + 1);
                      setServiceCalendarMonth(monthInputFromDate(month));
                    }}
                    type="button"
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
                <div className="service-calendar-grid" aria-label="Service calendar">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                    <span className="service-calendar-weekday" key={day}>{day}</span>
                  ))}
                  {calendarDays.map((day) => {
                    const dateInput = dateInputFromDate(day);
                    const existing = plansByDate.get(dateInput);
                    const inMonth = dateInput.startsWith(serviceCalendarMonth);
                    const isSelected = dateInput === dateInputFromIso(plan?.service_date);
                    const isToday = dateInput === dateInputFromDate(new Date());
                    return (
                      <button
                        className={`service-calendar-day ${inMonth ? "" : "is-muted"} ${existing ? "has-service" : ""} ${isSelected ? "is-selected" : ""} ${isToday ? "is-today" : ""}`}
                        disabled={!existing && !canCreatePlan}
                        key={dateInput}
                        onClick={() => void chooseServiceDate(dateInput)}
                        onDoubleClick={() => void openServiceDate(dateInput)}
                        title={existing ? `Open ${existing.title}` : `Create ${suggestedServiceTitle(dateInput)}`}
                        type="button"
                      >
                        <span>{day.getDate()}</span>
                        {existing ? <small>{existing.title}</small> : null}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="service-picker-panel service-list-panel">
                <div className="service-panel-heading">
                  <h3>Existing Services</h3>
                  <button
                    className="text-button compact-button"
                    disabled={!canCreatePlan}
                    onClick={() => startNewServiceDraft()}
                    type="button"
                  >
                    New
                  </button>
                </div>
                <div className="stack-list compact service-date-list">
                  {sortedPlans.map((planSummary) => (
                    <button
                      className={`stack-row ${planSummary.id === serviceDraftPlanId ? "selected" : ""}`}
                      key={planSummary.id}
                      onClick={() => {
                        const dateInput = dateInputFromIso(planSummary.service_date);
                        setServiceDraftPlanId(planSummary.id);
                        setServiceDraftDate(dateInput);
                        setServiceDraftTitle(planSummary.title);
                        setServiceCalendarMonth(dateInput.slice(0, 7) || serviceCalendarMonth);
                      }}
                      onDoubleClick={() => {
                        setServicePickerOpen(false);
                        void selectPlan(planSummary.id);
                      }}
                      type="button"
                    >
                      <strong>{formatServiceDate(planSummary.service_date)}</strong>
                      <span>
                        {planSummary.title} · {planSummary.item_count} item{planSummary.item_count === 1 ? "" : "s"}
                      </span>
                    </button>
                  ))}
                  {!plans.length ? <p className="search-empty">No services yet.</p> : null}
                </div>
              </section>

              <section className="service-picker-panel service-edit-panel">
                <div className="service-panel-heading">
                  <h3>{serviceDraftPlanId ? "Edit Service" : "New Service"}</h3>
                  {serviceDraftPlanId ? (
                    <button
                      className="text-button compact-button"
                      disabled={!canCreatePlan}
                      onClick={() => startNewServiceDraft(serviceDraftDate)}
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
                        updateServiceDraftDate(event.target.value);
                      }}
                      type="date"
                      value={serviceDraftDate}
                    />
                  </label>
                  <label>
                    Title
                    <input
                      onChange={(event) => setServiceDraftTitle(event.target.value)}
                      placeholder={suggestedServiceTitle(serviceDraftDate)}
                      value={serviceDraftTitle}
                    />
                  </label>
                </div>
                <div className="action-row">
                  <button
                    className="primary-button"
                    disabled={!serviceDraftDate || (!serviceDraftPlanId && !canCreatePlan)}
                    onClick={() => void openDraftService()}
                    type="button"
                  >
                    {serviceDraftPlanId ? "Open Service" : "Create & Open"}
                  </button>
                  <button
                    className="text-button"
                    disabled={!serviceDraftDate || (!serviceDraftPlanId && !canCreatePlan) || (Boolean(serviceDraftPlanId) && !canEditPlan)}
                    onClick={() => void saveDraftService()}
                    type="button"
                  >
                    {serviceDraftPlanId ? "Save Changes" : "Create Service"}
                  </button>
                </div>
                {plan && canDeletePlan ? (
                  <div className="service-picker-danger">
                    <p className="muted-copy">Archive the current service if it was created by mistake.</p>
                    <button className="danger-button" onClick={() => void archiveCurrentPlan()} type="button">
                      Archive Current
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          </section>
        </div>
      ) : null}
      {!canEditPlan ? (
        <p className="empty-state presentation-readonly-note">
          Presenter mode is live, but this account is read-only for plan changes.
        </p>
      ) : null}

      <div className="presenter-console">
        <div className="presenter-stage-column">
          <div
            className={`stage-shell stage-shell-live presenter-current stage-theme-${slideTheme} ${
              liveSlide ? presentationTypeClass(liveSlide.itemType) : "type-generic"
            }`}
          >
            <div className="stage-meta">
              <div className="stage-service-tools">
                <button
                  className="stage-header-button stage-service-picker-button"
                  disabled={loading}
                  onClick={openServicePicker}
                  title="Choose or create a service"
                  type="button"
                >
                  <CalendarDays size={14} aria-hidden="true" />
                  <span>{plan ? formatServiceDate(plan.service_date) : "Service"}</span>
                </button>
                <button
                  aria-expanded={serviceHistoryOpen}
                  aria-label="Open service edit history"
                  className="stage-header-icon-button"
                  disabled={!plan || serviceHistoryLoading}
                  onClick={() => void openServiceHistory()}
                  title="Service edit history"
                  type="button"
                >
                  <History size={14} aria-hidden="true" />
                </button>
                {serviceHistoryOpen ? (
                  <section className="worship-history-popover service-history-popover" aria-label="Service edit history">
                    <div className="worship-history-popover-heading">
                      <strong>Edit History</strong>
                      <button className="section-icon-button" onClick={() => setServiceHistoryOpen(false)} type="button" aria-label="Close edit history">
                        x
                      </button>
                    </div>
                    <div className="worship-history-list">
                      {serviceHistoryLoading ? <p className="search-empty">Loading history...</p> : null}
                      {!serviceHistoryLoading && !serviceHistory.length ? <p className="search-empty">No service edits recorded yet.</p> : null}
                      {serviceHistory.map((entry) => {
                        const meta = [entry.restorable ? "Service" : "Audit", entry.actor_name, formatHistoryTime(entry.created_at)].filter(Boolean).join(" · ");
                        return (
                          <button
                            className={`worship-history-row ${entry.restorable ? "" : "is-audit"}`}
                            disabled
                            key={entry.id}
                            type="button"
                          >
                            <span>{entry.label}</span>
                            {entry.affected ? <em>{entry.affected}</em> : null}
                            <small>{meta}</small>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </div>
              {stageContextTitle ? (
                <span className="stage-context-label">
                  <span className="stage-context-title">{stageContextTitle}</span>
                  {stageContextCounter ? <span className="stage-context-count">{stageContextCounter}</span> : null}
                </span>
              ) : null}
              <div className="stage-meta-actions">
                <label className="stage-theme-switch stage-toggle-switch" title="Toggle slide theme">
                  <input
                    aria-label="Use light slide theme"
                    checked={slideTheme === "light"}
                    onChange={(event) => setSlideTheme(event.target.checked ? "light" : "dark")}
                    type="checkbox"
                  />
                  <span className="stage-theme-slider" aria-hidden="true" />
                </label>
                <label className="stage-blank-switch stage-toggle-switch" title="Blank live output">
                  <input
                    aria-label="Blank live output"
                    checked={liveBlanked}
                    onChange={(event) => setLiveBlankedAndPublish(event.target.checked)}
                    type="checkbox"
                  />
                  <span aria-hidden="true">B</span>
                </label>
                <span className="stage-slide-counter">{stageSlideCounter}</span>
              </div>
            </div>
            <div className={`presentation-stage ${liveSlide?.imageUrl || liveSlide?.videoUrl ? "presentation-stage-image" : ""}`}>
              {liveSlide?.imageUrl || liveSlide?.videoUrl || liveSlide?.itemType === "song" || liveSlide?.itemType === "reading" ? null : (
                <div className="stage-title">
                  <span>{liveSlide?.title ?? "Ready"}</span>
                </div>
              )}
              {liveSlide?.imageUrl ? (
                <ScaledSlideImage alt={liveSlide.title} className="stage-image-frame-preview" src={liveSlide.imageUrl} />
              ) : liveSlide?.videoUrl ? (
                <div className="stage-video-frame">
                  {liveSlide.videoProvider === "file" ? (
                    <video controls src={liveSlide.videoUrl} title={liveSlide.title} />
                  ) : (
                    <iframe
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      src={liveSlide.videoUrl}
                      title={liveSlide.title}
                    />
                  )}
                </div>
              ) : (
                <SlideTextBlock maxFontSize={liveTextFontCap} text={liveSlide?.text ?? "No live slide selected"} />
              )}
            </div>
          </div>

          <div className="presenter-controls" aria-label="Slide controls">
            <div className="action-row presenter-mobile-command-row">
              <button className="primary-button" disabled={loading || !plan} onClick={() => void startSlideshow()} title={slideshowOpen ? "Close slides" : "Start slides"} type="button">
                <MonitorUp size={16} aria-hidden="true" />
                <span className="mobile-button-label">{slideshowOpen ? "Close Slides" : "Start Slides"}</span>
              </button>
              {canEditPlan ? (
                <button className="text-button" disabled={!plan} onClick={() => openSearchOverlay()} title="Search" type="button">
                  <Search size={16} aria-hidden="true" />
                  <span className="mobile-button-label">Search</span>
                </button>
              ) : null}
              <button className="text-button" disabled={loading || !plan} onClick={() => moveLive(-1)} title="Previous slide" type="button">
                <ChevronLeft size={16} aria-hidden="true" />
                <span className="mobile-button-label">Previous</span>
              </button>
              <button className="text-button" disabled={loading || !plan} onClick={() => moveLive(1)} title="Next slide" type="button">
                <span className="mobile-button-label">Next</span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
            {liveSlide?.videoUrl ? (
              <div className="video-control-group" aria-label="Video controls">
                <button className="text-button" onClick={() => sendVideoCommand("play")} type="button">
                  Play
                </button>
                <button className="text-button" onClick={() => sendVideoCommand("pause")} type="button">
                  Pause
                </button>
                <button className="text-button" onClick={() => sendVideoCommand("stop")} type="button">
                  Stop
                </button>
              </div>
            ) : null}
            {currentPlanItem?.item_type === "reading" && canEditPlan ? (
              <div className="action-row bible-nav-row is-open">
                <button aria-label="Previous chapter" className="text-button" disabled={!canEditPlan} onClick={() => void navigateBibleReading("chapter", -1)} title="Previous chapter" type="button">
                  &lt;&lt;
                </button>
                <button aria-label="Previous verse" className="text-button" disabled={!canEditPlan} onClick={() => void navigateBibleReading("verse", -1)} title="Previous verse" type="button">
                  &lt;
                </button>
                <button aria-label="Next verse" className="text-button" disabled={!canEditPlan} onClick={() => void navigateBibleReading("verse", 1)} title="Next verse" type="button">
                  &gt;
                </button>
                <button aria-label="Next chapter" className="text-button" disabled={!canEditPlan} onClick={() => void navigateBibleReading("chapter", 1)} title="Next chapter" type="button">
                  &gt;&gt;
                </button>
              </div>
            ) : null}
          </div>

          {canEditSlideNotes && currentPlanItemAllowsNotes ? (
            <div className="slide-notes-panel">
              <textarea
                disabled={!currentPlanItem || slideNotesSaving}
                onBlur={() => void saveSlideNotes()}
                onChange={(event) => setSlideNotesDraft(event.target.value)}
                placeholder={currentPlanItem ? "Notes for this sermon slide..." : "Select a sermon slide to add notes."}
                value={slideNotesDraft}
              />
            </div>
          ) : null}
        </div>

        <aside className="presenter-sidebar" aria-label="Slide context">
          {sorterCatchUpDirection ? (
            <button
              className={`sorter-catch-up sorter-catch-up-${sorterCatchUpDirection}`}
              aria-label="Catch slide sorter up to live slide"
              onClick={catchOperatorUpToLiveSlide}
              type="button"
            >
              {sorterCatchUpDirection === "up" ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
            </button>
          ) : null}
          <div
            className="slide-grid"
            aria-label="All slides"
            onScroll={() => {
              const activeSlide = slides[liveIndex];
              const nextDirection = slideVisibilityDirection(slideGridRef.current, activeSlide ? thumbnailRefs.current[activeSlide.id] ?? null : null);
              sorterCatchUpDirectionRef.current = nextDirection;
              setSorterCatchUpDirection(nextDirection);
            }}
            ref={slideGridRef}
          >
            {sections.map((section) => {
              const sectionStart = slides.findIndex((slide) => slide.sectionId === section.id);
              const visibleSectionSlides = sorterSlidesForSection(section.slides);
              const sectionItem = sectionPlanItem(section.id);
              const sectionFileIds = sectionItem?.files?.map((file) => file.file_id) ?? [];
              const canEditSectionSong = canEditSong && sectionItem?.song_id;
              const deckStatus = describeDeckStatus(
                sectionFileIds,
                renderedSlidesByFileId,
                renderingFileIds,
                renderErrorsByFileId,
              );
              const sectionRenderError = sectionItem?.files
                ?.map((file) => renderErrorsByFileId[file.file_id])
                .find(Boolean);
              const canCollapseSection = Boolean(sectionItem?.files?.length) && visibleSectionSlides.length > 4;
              const sectionExpanded = expandedSorterSectionIds.has(section.id) || liveSlide?.sectionId === section.id;
              const showSlideTiles =
                !canCollapseSection ||
                sectionExpanded;
              const sectionAudioSlide = section.slides.find((slide) => slide.youtubeAudioUrl);
              const sectionAudioPlaying = playingAudioSectionId === section.id;
              return (
                <div className="section-slide-group" key={section.id}>
                  <div className="section-jump-row">
                    <button
                      className={`section-jump ${presentationTypeClass(section.itemType)} ${
                        liveSlide?.sectionId === section.id ? "active" : ""
                      }`}
                      onClick={() => selectSlideFromOperator(sectionStart)}
                      type="button"
                    >
                      {["song", "reading", "sermon"].includes(section.itemType) ? null : <span>{section.itemType}</span>}
                      <strong>{section.title}</strong>
                      {section.slides.some(
                        (slide) =>
                          !slide.imageUrl &&
                          sectionItem?.files?.some((file) => renderingFileIds.includes(file.file_id)),
                      ) ? (
                        <em>Rendering</em>
                      ) : null}
                      {sectionRenderError ? <em className="error-badge">Render failed</em> : null}
                    </button>
                    {sectionAudioSlide ? (
                      <button
                        aria-label={`${sectionAudioPlaying ? "Pause" : "Play"} YouTube audio for ${section.title}`}
                        aria-pressed={sectionAudioPlaying}
                        className={`section-icon-button section-audio-button ${sectionAudioPlaying ? "is-active" : ""}`}
                        onClick={() => toggleSectionAudio(section)}
                        title={`${sectionAudioPlaying ? "Pause" : "Play"} YouTube audio`}
                        type="button"
                      >
                        {sectionAudioPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                      </button>
                    ) : null}
                    {canCollapseSection ? (
                      <button
                        aria-expanded={showSlideTiles}
                        aria-label={`${showSlideTiles ? "Collapse" : "Expand"} ${section.title} slides`}
                        className="section-icon-button section-collapse-button"
                        onClick={() => toggleSorterSection(section.id)}
                        title={showSlideTiles ? "Collapse slides" : "Expand slides"}
                        type="button"
                      >
                        {showSlideTiles ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                      </button>
                    ) : null}
                    {canEditSectionSong ? (
                      <button
                        aria-label={`Edit song ${section.title}`}
                        className="section-icon-button section-edit-button"
                        onClick={() => openSongEditor(sectionItem.song_id!)}
                        type="button"
                      >
                        <Pencil size={14} aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                    ) : null}
                  </div>
                  {sectionRenderError ? <p className="render-error-message">{sectionRenderError}</p> : null}
                  {showSlideTiles ? (
                    <div className="section-slide-list">
                      {visibleSectionSlides.map((slide) => {
                        const slideIndex = slides.findIndex((candidate) => candidate.id === slide.id);
                        const matchesLiveBuild =
                          Boolean(slide.imageUrl && liveSlide?.imageUrl) &&
                          deckBuildGroupKey(slide) === deckBuildGroupKey(liveSlide);
                        const tileRefIds = matchesLiveBuild && liveSlide ? [slide.id, liveSlide.id] : [slide.id];
                        return (
                          <button
                            className={`slide-tile preview-tile ${presentationTypeClass(slide.itemType)} ${
                              slideIndex === liveIndex || matchesLiveBuild ? "active" : ""
                            }`}
                            key={slide.id}
                            onClick={() => selectSlideFromOperator(slideIndex)}
                            ref={(element) => {
                              tileRefIds.forEach((id) => {
                                thumbnailRefs.current[id] = element;
                              });
                            }}
                            type="button"
                            title={`${slideIndex + 1}. ${slide.title}`}
                          >
                            <span>{(slideIndex + 1).toString().padStart(2, "0")}</span>
                            {renderMiniSlide(
                              slide,
                              "Empty",
                              slideTheme,
                              compactPlanTextFontCap,
                            )}
                            {(slide.buildCount ?? 1) > 1 ? <small className="build-count-badge">{slide.buildCount} steps</small> : null}
                            <div className="thumbnail-menu">
                              <span>Go</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <button
                      className={`deck-slide-summary status-${deckStatus.tone}`}
                      onClick={() => toggleSorterSection(section.id)}
                      type="button"
                    >
                      {renderMiniSlide(
                        section.slides[0] ?? null,
                        "Rendering deck",
                        slideTheme,
                        compactPlanTextFontCap,
                      )}
                      <strong>
                        {visibleSectionSlides.length} deck slides
                        {section.slides.length > visibleSectionSlides.length ? ` · ${section.slides.length} steps` : ""}
                      </strong>
                      <span>{deckStatus.label}</span>
                      <small>{deckStatus.detail} · Click to expand</small>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <aside className="section-rail" aria-label="Sections">
          {railCatchUpDirection ? (
            <button
              aria-label="Catch section rail up to live slide"
              className={`sorter-catch-up sorter-catch-up-${railCatchUpDirection}`}
              onClick={catchOperatorUpToLiveSlide}
              type="button"
            >
              {railCatchUpDirection === "up" ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
            </button>
          ) : null}
          <div className="section-rail-title">Sections</div>
          <div
            className="section-rail-list"
            onScroll={() => {
              const activeSlide = slides[liveIndex];
              const nextDirection = slideVisibilityDirection(sectionRailListRef.current, activeSlide ? sectionRailRefs.current[activeSlide.sectionId] ?? null : null);
              railCatchUpDirectionRef.current = nextDirection;
              setRailCatchUpDirection(nextDirection);
            }}
            ref={sectionRailListRef}
          >
            {canEditPlan ? (
              <button
                aria-label="Search or add at the start"
                className="section-insert-button"
                onClick={() => openSearchOverlay(-1, "bible", { selectInserted: false })}
                type="button"
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            ) : null}
            {sections.map((section, sectionIndex) => {
              const sectionStart = slides.findIndex((slide) => slide.sectionId === section.id);
              const ownerItems = sectionOwner(section.id) === "worship" ? orderedWorshipSetItems() : orderedPlanItemsWithWorshipAnchor();
              const ownerItemIndex = ownerItems.findIndex((item) => item.id === section.id);
              return (
                <div
                  key={section.id}
                  className="section-rail-block"
                  ref={(element) => {
                    sectionRailRefs.current[section.id] = element;
                  }}
                >
                  <div
                    className={`section-rail-item ${presentationTypeClass(section.itemType)} ${
                      liveSlide?.sectionId === section.id ? "active" : ""
                    }`}
                  >
                    <button
                      className="section-rail-jump"
                      onClick={() => selectSlideFromOperator(sectionStart)}
                      type="button"
                      title={section.title}
                    >
                      <span>{(sectionIndex + 1).toString().padStart(2, "0")}</span>
                      <strong>{section.title}</strong>
                    </button>
                    {canEditPlan || canDeletePlan ? (
                      <div className="section-actions">
                        <button
                          aria-label={`Move ${section.title} up`}
                          className="section-icon-button"
                          disabled={ownerItemIndex <= 0}
                          onClick={() => void moveSection(section.id, -1)}
                          type="button"
                        >
                          <ChevronUp size={14} aria-hidden="true" />
                        </button>
                        <button
                          aria-label={`Move ${section.title} down`}
                          className="section-icon-button"
                          disabled={ownerItemIndex < 0 || ownerItemIndex === ownerItems.length - 1}
                          onClick={() => void moveSection(section.id, 1)}
                          type="button"
                        >
                          <ChevronDown size={14} aria-hidden="true" />
                        </button>
                        <button
                          aria-label={`Remove ${section.title}`}
                          className="section-icon-button section-remove-button"
                          onClick={() => void removeSection(section.id)}
                          type="button"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {canEditPlan ? (
                    <button
                      aria-label={`Search or add after ${section.title}`}
                      className="section-insert-button"
                      onClick={() => openSearchOverlay(sectionIndex, "bible", { selectInserted: false })}
                      type="button"
                    >
                      <Plus size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {searchOverlayOpen ? (
        <div className="app-dialog-backdrop" role="presentation">
          <div aria-labelledby="search-overlay-title" aria-modal="true" className="app-dialog app-dialog-wide" role="dialog">
            <div>
              <h2 id="search-overlay-title">Search And Add</h2>
              <p>Find songs, Bible passages, or upload a slide deck.</p>
            </div>

            <div className="insert-choice-grid search-mode-grid">
              <button
                className={`text-button ${searchMode === "songs" ? "active-choice" : ""}`}
                onClick={() => {
                  setSearchMode("songs");
                  setSearchQuery("");
                  setSearchSelectInserted(false);
                }}
                type="button"
              >
                Songs
              </button>
              <button
                className={`text-button ${searchMode === "bible" ? "active-choice" : ""}`}
                onClick={() => {
                  setSearchMode("bible");
                  setSearchQuery("");
                  setSearchSelectInserted(true);
                }}
                type="button"
              >
                Bible
              </button>
              <button
                className={`text-button ${searchMode === "deck" ? "active-choice" : ""}`}
                onClick={() => {
                  setSearchMode("deck");
                  setSearchQuery("");
                  setGoogleDriveError("");
                  setSearchSelectInserted(false);
                }}
                type="button"
              >
                Slide Deck
              </button>
              <button
                className={`text-button ${searchMode === "video" ? "active-choice" : ""}`}
                onClick={() => {
                  setSearchMode("video");
                  setSearchQuery("");
                  setSearchSelectInserted(false);
                  setVideoTitle("");
                  setVideoFile(null);
                }}
                type="button"
              >
                Video
              </button>
            </div>

            <label className="inline-checkbox search-follow-checkbox">
              <input
                checked={searchSelectInserted}
                onChange={(event) => setSearchSelectInserted(event.target.checked)}
                type="checkbox"
              />
              <span>Show after adding</span>
            </label>

            <div className="dialog-form-grid">
              {searchMode === "bible" ? (
                <label>
                  Version
                  <select onChange={(event) => setBibleVersion(event.target.value)} value={bibleVersion}>
                    {bibleVersions.map((version) => (
                      <option key={version.id} value={version.code}>
                        {version.code}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {searchMode !== "deck" ? (
                <label>
                  Search
                  <input
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={handleSearchEnter}
                    ref={searchInputRef}
                    placeholder={
                      searchMode === "bible"
                        ? "John 3 16 or shepherd"
                        : searchMode === "video"
                          ? "Paste YouTube link or video ID"
                          : "Amazing Grace"
                    }
                    value={searchQuery}
                  />
                </label>
              ) : null}
              {searchMode === "video" ? (
                <label>
                  Video Title
                  <input
                    onChange={(event) => setVideoTitle(event.target.value)}
                    onKeyDown={handleSearchEnter}
                    placeholder="Optional video title"
                    value={videoTitle}
                  />
                </label>
              ) : null}
            </div>

            {searchMode === "video" ? (
              <div className="dialog-form-grid">
                <label>
                  Local Video File
                  <input
                    accept="video/mp4,video/webm,video/ogg"
                    disabled={!canAttachDeck}
                    onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>
              </div>
            ) : null}

            {searchMode === "deck" ? (
              <>
                <div className="dialog-form-grid">
                  <label>
                    Deck File
                    <input
                      disabled={!canAttachDeck}
                      accept=".ppt,.pptx,.odp,.pdf,.key"
                      onChange={(event) => {
                        setDeckFile(event.target.files?.[0] ?? null);
                      }}
                      type="file"
                    />
                  </label>
                  <label>
                    Deck Name
                    <input
                      disabled={!canAttachDeck}
                      onChange={(event) => {
                        setDeckTitle(event.target.value);
                        setDeckTitleTouched(true);
                      }}
                      onKeyDown={handleSearchEnter}
                      placeholder="Sermon"
                      value={deckTitle}
                    />
                  </label>
                </div>
                <label className="checkbox-label">
                  <input
                    checked={deckFlattenBuilds}
                    disabled={!canAttachDeck}
                    onChange={(event) => setDeckFlattenBuilds(event.target.checked)}
                    type="checkbox"
                  />
                  Import click builds as slides
                </label>
                <p className="field-help">Best effort for PowerPoint appear/fade bullet and overlay builds.</p>

                <div className="search-deck-divider">
                  <span>or import from Google Drive</span>
                </div>

                <div className="dialog-form-grid">
                  <label className="wide-field">
                    Drive Search
                    <input
                      disabled={!googleDriveStatus?.connected}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={handleSearchEnter}
                      placeholder={
                        googleDriveStatus?.connected
                          ? "Search sermons, slides, or PDF decks"
                          : "Connect Google Drive in Admin first"
                      }
                      ref={searchInputRef}
                      value={searchQuery}
                    />
                  </label>
                </div>
                {searchMode === "deck" ? (
                  <p className={`search-empty ${googleDriveError ? "error-text" : ""}`}>
                    {googleDriveError
                      ? googleDriveError
                      : googleDriveStatus?.connected
                        ? `Connected to ${googleDriveStatus.account_name || googleDriveStatus.account_email || "Google Drive"}.`
                        : googleDriveStatus?.configured
                          ? "Connect Google Drive in Admin first."
                          : "Google Drive is not configured on this server."}
                  </p>
                ) : null}
              </>
            ) : null}

            <div className="app-dialog-actions">
              <button className="text-button" onClick={closeSearchOverlay} type="button">
                Close
              </button>
              {searchMode === "deck" ? (
                <button className="primary-button" disabled={!canAttachDeck || !deckFile} onClick={() => void attachDeckToPlan()} type="button">
                  Add Deck
                </button>
              ) : null}
              {searchMode === "video" ? (
                <button
                  className="primary-button"
                  disabled={!canEditPlan || (!extractYouTubeId(searchQuery) && !videoFile)}
                  onClick={() => void addVideoSearchResult()}
                  type="button"
                >
                  Add Video
                </button>
              ) : null}
            </div>

            <div className="search-results-list">
              {searchLoading ? <p className="search-empty">Searching…</p> : null}
              {searchMode === "deck" && googleDriveLoading ? <p className="search-empty">Searching Google Drive…</p> : null}
              {!searchLoading && searchMode === "songs"
                ? songSearchResults.map((song) => (
                      <button
                        className="search-result-card"
                        disabled={!canEditPlan}
                        key={song.id}
                        onClick={() => {
                          void addSongSearchResult(song);
                        }}
                        type="button"
                      >
                        <strong>{song.title}</strong>
                        <span>{song.author ?? "Song"}</span>
                      </button>
                    ))
                : null}
              {searchMode === "songs" &&
              searchQuery.trim() &&
              (songSearchResults.length === 0 || customProviderResult !== null || customProviderSelection !== null) ? (
                <div className="custom-provider-panel">
                  <div className="custom-provider-header">
                    <div>
                      <strong>Not seeing the right song?</strong>
                      <span>Search your custom provider and import straight into this service.</span>
                    </div>
                    <button
                      className="text-button"
                      disabled={customProviderLoading}
                      onClick={() => void runCustomSongImportSearch()}
                      type="button"
                    >
                      <WandSparkles size={16} aria-hidden="true" />
                      {customProviderLoading ? "Searching…" : "Import from Provider"}
                    </button>
                  </div>

                  {customProviderResult?.notes?.length ? (
                    <div className="custom-provider-notes">
                      {customProviderResult.notes.map((note) => (
                        <span key={note}>{note}</span>
                      ))}
                    </div>
                  ) : null}

                  {customProviderResult?.matches?.length ? (
                    <div className="custom-provider-matches">
                      {customProviderResult.matches.map((match) => (
                        <button
                          className={`search-result-card ${selectedCustomProviderMatchId === match.id ? "active-import-match" : ""}`}
                          key={match.id}
                          onClick={() => void loadCustomProviderMatch(match)}
                          type="button"
                        >
                          <strong>{match.title}</strong>
                          <span>{match.subtitle ?? match.summary ?? "Provider match"}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {customProviderSelectionLoading ? <p className="search-empty">Loading imported lyrics…</p> : null}

                  {customProviderSelection ? (
                    <div className="custom-provider-preview">
                      <div className="custom-provider-preview-header">
                        <div>
                          <strong>{customProviderSelection.title ?? selectedCustomProviderMatch?.title ?? "Imported song"}</strong>
                          <span>{selectedCustomProviderMatch?.subtitle ?? "Lyrics ready to import"}</span>
                        </div>
                        <button
                          className="primary-button"
                          disabled={!customProviderSelection.output_text || !canEditPlan || (!findDuplicateSong(customProviderSelection.title?.trim() || selectedCustomProviderMatch?.title || "") && !canCreateSong)}
                          onClick={() => void importSelectedCustomProviderSong()}
                          type="button"
                        >
                          Import Song
                        </button>
                      </div>
                      {customProviderSelection.notes.length ? (
                        <div className="custom-provider-notes">
                          {customProviderSelection.notes.map((note) => (
                            <span key={note}>{note}</span>
                          ))}
                        </div>
                      ) : null}
                      {customProviderSelection.output_text ? (
                        <pre className="import-lyric-preview compact-preview">{customProviderSelection.output_text}</pre>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!searchLoading && searchMode === "bible"
                ? bibleSearchResults.map((result) => (
                    <button
                      className="search-result-card"
                      disabled={!canEditPlan}
                      key={`${result.version}:${result.reference}:${result.verse_from}`}
                      onClick={() => {
                        void addBibleSearchResult(result);
                      }}
                      type="button"
                    >
                      <strong>{result.reference}</strong>
                      <span>{result.text}</span>
                    </button>
                  ))
                : null}
              {!searchLoading && searchMode === "video" && videoFile ? (
                <button
                  className="search-result-card"
                  disabled={!canEditPlan || !canAttachDeck}
                  onClick={() => void addVideoSearchResult()}
                  type="button"
                >
                  <strong>{videoTitle.trim() || videoFile.name.replace(/\.[^.]+$/, "")}</strong>
                  <span>Local video file</span>
                </button>
              ) : null}
              {!searchLoading && searchMode === "video" && searchQuery.trim() ? (
                extractYouTubeId(searchQuery) ? (
                  <button
                    className="search-result-card"
                    disabled={!canEditPlan}
                    onClick={() => void addVideoSearchResult()}
                    type="button"
                  >
                    <strong>{videoTitle.trim() || "YouTube Video"}</strong>
                    <span>{extractYouTubeId(searchQuery)}</span>
                  </button>
                ) : (
                  <p className="search-empty">Paste a valid YouTube link or 11-character video ID.</p>
                )
              ) : null}
              {!googleDriveLoading && searchMode === "deck" && googleDriveStatus?.connected
                ? googleDriveFiles.map((file) => (
                    <button
                      className="search-result-card"
                      disabled={!canEditPlan || !canAttachDeck}
                      key={file.id}
                      onClick={() => {
                        void attachImportedDriveDeck(file);
                      }}
                      type="button"
                    >
                      <strong>{file.name}</strong>
                      <span>{file.source_kind === "google_slides" ? "Google Slides" : file.mime_type}</span>
                    </button>
                  ))
                : null}
              {!searchLoading &&
              ((searchMode === "songs" &&
                songSearchResults.length === 0 &&
                !customProviderResult?.matches?.length) ||
                (searchMode === "bible" && searchQuery.trim() && bibleSearchResults.length === 0) ||
                (searchMode === "deck" &&
                  googleDriveStatus?.connected &&
                  searchQuery.trim() &&
                  googleDriveFiles.length === 0 &&
                  !googleDriveLoading) ||
                (searchMode === "video" && !searchQuery.trim() && !videoFile)) ? (
                <p className="search-empty">No matches yet.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {editingSong ? (
        <SongEditorDialog
          canEdit={canEditPlan}
          onClose={closeSongEditor}
          onSaved={async (updated) => {
            setSongs((current) => current.map((song) => (song.id === updated.id ? updated : song)));
            await load(plan?.id, { refreshCatalogs: true, silent: true });
            setMessage(`Saved "${updated.title}".`);
          }}
          song={editingSong}
        />
      ) : null}
    </section>
  );
}
