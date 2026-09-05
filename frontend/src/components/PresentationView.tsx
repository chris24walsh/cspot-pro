import { Archive, CircleStop, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, EyeOff, Layers3, Mic, MonitorUp, Moon, Pause, Pencil, Play, Plus, RotateCcw, Search, Trash2, Volume2, WandSparkles, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  ApiError,
  addMissingServiceSections,
  createPlanHistoryEntry,
  createSong,
  createPlan,
  createPlanItem,
  attachItemFile,
  deleteItemFile,
  updateItemFile,
  deletePlan,
  deletePreServiceMedia,
  getGoogleDriveStatus,
  deletePlanItem,
  getFileSlides,
  getBibleBooks,
  getBiblePassage,
  getPresentationOutputStatus,
  getBroadcastViewerSettings,
  searchBible,
  getBibleVersions,
  getPlan,
  getPlans,
  getPlanTypes,
  createPlanType,
  insertSectionTemplate,
  saveServiceOutline,
  getPresentationLiveState,
  getBroadcastRecordings,
  getPlanHistory,
  getSongs,
  importGoogleDriveDeck,
  runCustomProviderSearch,
  searchGoogleDriveFiles,
  searchYouTubeVideos,
  pauseBroadcastRecording,
  resumeBroadcastRecording,
  selectCustomProviderMatch,
  startBroadcastRecording,
  stopBroadcastRecording,
  uploadStoredFile,
  updatePlan,
  updatePlanType,
  updateSong,
  restoreSong,
  restorePlan,
  updatePresentationOutputStatus,
  updatePresentationLiveState,
  updatePlanItem,
  type BibleBook,
  type BibleSearchHit,
  type BibleVersion,
  type BroadcastRecording,
  type BroadcastAudioScene,
  type ServiceScheduleRule,
  type CustomProviderMatch,
  type CustomProviderSearchResult,
  type CustomProviderSelectResult,
  type PresentationLiveSyncState,
  type RenderedSlide,
  type GoogleDriveFile,
  type GoogleDriveStatus,
  type YouTubeVideo,
  type PlanDetail,
  type PlanHistoryEntry,
  type PlanHistorySnapshotItem,
  type PlanItem,
  type PresentationOptions,
  type PlanSummary,
  type PlanType,
  type Song,
} from "../api";
import { PROGRAM_AUDIO_FADE_DURATION_MS } from "../audioTransitions";
import { useDurableChange } from "../changePolling";
import {
  PRESENTATION_CHANNEL,
  LCF_BACKGROUND_URL,
  PRESENTATION_STORAGE_KEY,
  buildPresentationSections,
  buildPresentationSlides,
  extractYouTubeId,
  presentationTypeClass,
  resolveLiveIndex,
  suggestSlideGroupFontCap,
  suggestedSlideFontCap,
  storedFileDownloadUrl,
  videoPlaybackStateForSlideTransition,
  type PresentationSlide,
  type PresentationLiveState,
  type PresentationTheme,
} from "../presentation";
import { isMobileOrTabletDevice } from "../presentationDevice";
import { undoHistoryEntrySnapshot } from "../planHistory";
import { calendarDatesAround, sundayDatesAround } from "../leaderSchedule";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { useConfirmationDialog } from "./ConfirmationDialog";
import { CalendarPopup } from "./CalendarPopup";
import { CountdownSlide } from "./CountdownSlide";
import { PreServiceSlide, serviceScheduleForPlan } from "./PreServiceSlide";
import { DateNavigator, formatNavigatorDate } from "./DateNavigator";
import { defaultPlanningDate, nextSundayDate } from "../planningDates";
import { ScaledSlideImage } from "./ScaledSlideImage";
import { SlideOverlay } from "./SlideOverlay";
import { SongYouTubeSearch } from "./SongYouTubeSearch";
import { SongEditorDialog } from "./SongEditorDialog";
import { useEscapeClose } from "./useEscapeClose";
import { showToast } from "../toast";
import { isEditableKeyboardTarget, slideKeyboardDirection, type SlideKeyboardDirection } from "../keyboardNavigation";
import { analyzeWorshipText, buildLyricsFromSections, canonicalizeWorshipLyrics } from "../worshipText";
import {
  WORSHIP_SET_ANCHOR_ITEM_TYPE,
  combinedPlanningItemCount,
  explicitPlanningItemCount,
  isPlanEditingLocked,
  isWorshipSetPlan,
  matchingWorshipSetForService,
  mergeWorshipSetIntoService,
  preferredServicePlanId,
  worshipSetType,
} from "../worshipSets";

const SELECTED_SERVICE_SESSION_KEY = "cspot.selectedServicePlanId";
const AUDIO_FADE_STEPS = 20;
const AUDIO_FADE_INTERVAL_MS = PROGRAM_AUDIO_FADE_DURATION_MS / AUDIO_FADE_STEPS;
const REMOTE_LIVE_STATE_POLL_INTERVAL_MS = 250;
const FILLER_MEDIA_ITEM_TYPES = new Set(["open_time", "sermon", "announcements"]);
const FIXED_WELCOME_STAGE_TYPES = new Set(["welcome_montage", "welcome_countdown", "welcome_seated"]);
const INLINE_EDIT_ITEM_TYPES = new Set([...FILLER_MEDIA_ITEM_TYPES, ...FIXED_WELCOME_STAGE_TYPES, "reading", "pre_service", "worship_set", "post_service", "custom"]);

const EMPTY_ITEM_EDIT_DRAFT: { title: string; comment: string; planned_start: string; auto_collapse_items: boolean } & Required<PresentationOptions> = {
  title: "", comment: "", planned_start: "", auto_collapse_items: false,
  template_id: "", scheduled_start: "", backing_audio_id: "", stop_backing_audio: false,
  dwell_seconds: 8, auto_advance_seconds: 8, transition: "fade", fit_mode: "contain", overlay_text: "",
  overlay_mode: "none", overlay_countdown_seconds: 300, overlay_position: "bottom",
  overlay_size: "medium", overlay_font: "sans", overlay_panel_opacity: 68,
  overlay_background_dim: 0, auto_advance: false, repeat: false, announcement_date: "",
  announcement_location: "", announcement_contact: "", announcement_url: "",
  announcement_layout: "split",
  audio_scene_id: "", display_targets: ["church", "livestream"], end_after_section: false,
};

function outputOwnerId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `output-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function automaticSceneIdForItem(itemType: string, parentType?: string) {
  if (parentType === "post_service" || itemType === "post_service") return "post_service";
  if (["pre_service", "welcome_montage", "welcome_countdown", "welcome_seated"].includes(itemType)) return "pre_service";
  if (itemType === "song") return "worship";
  if (["seating", "testimony", "sharing", "community", "open_time", "end"].includes(itemType)) return "congregation";
  return "pastor";
}

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

type SearchOverlayMode = "songs" | "bible" | "deck" | "images" | "video";
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

function isTransientApiError(error: unknown) {
  return error instanceof ApiError && [408, 502, 503, 504].includes(error.status);
}

function scrollItemIntoOperatorView(container: HTMLElement | null, item: HTMLElement | null, behavior: ScrollBehavior = "smooth") {
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

  container.scrollTo({ top: targetTop, behavior });
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
  const match = parts
    .map((_part, index) => {
      if (index <= 0 || !/^\d+$/.test(parts[index])) {
        return null;
      }
      const book = findBibleBookForQuery(parts.slice(0, index).join(" "), books);
      return book ? { book, chapterIndex: index } : null;
    })
    .filter((candidate): candidate is { book: BibleBook; chapterIndex: number } => Boolean(candidate))
    .sort((left, right) => right.chapterIndex - left.chapterIndex)[0];
  if (!match) {
    return raw;
  }

  const { book, chapterIndex } = match;
  const chapter = parts[chapterIndex];
  const verseFrom = parts[chapterIndex + 1];
  if (!verseFrom || !/^\d+$/.test(verseFrom)) {
    return `${book.name} ${chapter}`;
  }

  let verseTo = "";
  if (parts[chapterIndex + 2] === "-" && /^\d+$/.test(parts[chapterIndex + 3] ?? "")) {
    verseTo = parts[chapterIndex + 3];
  } else if (/^\d+$/.test(parts[chapterIndex + 2] ?? "")) {
    verseTo = parts[chapterIndex + 2];
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
  className,
  maxFontSize,
}: {
  text: string;
  compact?: boolean;
  className?: string;
  maxFontSize?: number;
}) {
  return <AutoFitSlideText className={className} compact={compact} maxFontSize={maxFontSize} text={text} />;
}

function DeferredMiniSlideImage({ src }: { src: string }) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || shouldLoad) {
      return undefined;
    }
    if (!("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(image);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <img
      alt=""
      decoding="async"
      loading="lazy"
      ref={imageRef}
      src={shouldLoad ? src : undefined}
    />
  );
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
      {slide.montageImageUrls ? (
        <div
          className="mini-slide-photo"
          style={{ backgroundImage: `url(${slide.montageImageUrls[0]})` }}
        >
          <strong>Welcome</strong>
          <span>30:00</span>
        </div>
      ) : slide.countdownSeconds ? (
        <div className="mini-countdown-slide">
          <span>Starts in</span>
          <strong>5:00</strong>
        </div>
      ) : slide.backgroundImageUrl ? (
        <div
          className="lcf-background-slide"
          style={{ backgroundImage: `url(${slide.backgroundImageUrl})` }}
          aria-label={slide.title}
        />
      ) : slide.imageUrl ? (
        <DeferredMiniSlideImage src={slide.imageUrl} />
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

function recordingGraceCountdown(deadline: string, now: number) {
  const seconds = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PresentationView({
  active = true,
  canAttachDeck,
  canAccessAdminTools,
  canCreatePlan,
  canDeletePlan,
  canEditPlan: hasPlanEditPermission,
  canManagePreServiceMedia,
  canSimulateService,
  canEditSlideNotes,
  canCreateSong,
  canEditSong,
}: {
  active?: boolean;
  canAttachDeck: boolean;
  canAccessAdminTools: boolean;
  canCreatePlan: boolean;
  canDeletePlan: boolean;
  canEditPlan: boolean;
  canManagePreServiceMedia: boolean;
  canSimulateService: boolean;
  canEditSlideNotes: boolean;
  canCreateSong: boolean;
  canEditSong: boolean;
}) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [planTypes, setPlanTypes] = useState<PlanType[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [worshipSetPlan, setWorshipSetPlan] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fillerMediaPlanItemId, setFillerMediaPlanItemId] = useState<string | null>(null);
  const [fillerMediaSectionId, setFillerMediaSectionId] = useState<string | null>(null);
  const [fillerMediaBusy, setFillerMediaBusy] = useState(false);
  const [fillerMediaEditorLoading, setFillerMediaEditorLoading] = useState(false);
  const [loadedFillerMediaFileIds, setLoadedFillerMediaFileIds] = useState<Set<string>>(() => new Set());
  const [itemEditDraft, setItemEditDraft] = useState(EMPTY_ITEM_EDIT_DRAFT);
  const [itemEditorSection, setItemEditorSection] = useState<string | null>("visual");
  const [serviceSchedules, setServiceSchedules] = useState<ServiceScheduleRule[]>([]);
  const [audioScenes, setAudioScenes] = useState<BroadcastAudioScene[]>([]);

  const [liveIndex, setLiveIndex] = useState(0);
  const [autoAdvanceArmedSlideId, setAutoAdvanceArmedSlideId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [screens, setScreens] = useState<PresentationScreen[]>([]);
  const [selectedScreenIndex, setSelectedScreenIndex] = useState(0);
  const [deckFlattenBuilds, setDeckFlattenBuilds] = useState(false);
  const [importingDriveFileId, setImportingDriveFileId] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [renderedSlidesByFileId, setRenderedSlidesByFileId] = useState<Record<string, RenderedSlide[]>>({});
  const [renderingFileIds, setRenderingFileIds] = useState<string[]>([]);
  const [renderErrorsByFileId, setRenderErrorsByFileId] = useState<Record<string, string>>({});
  const [expandedSorterSectionIds, setExpandedSorterSectionIds] = useState<Set<string>>(() => new Set());
  const [expandedRailGroupIds, setExpandedRailGroupIds] = useState<Set<string>>(() => new Set());
  const [bibleVersions, setBibleVersions] = useState<BibleVersion[]>([]);
  const [bibleBooks, setBibleBooks] = useState<BibleBook[]>([]);
  const [bibleVersion, setBibleVersion] = useState("ASV");
  const [bibleBook, setBibleBook] = useState("John");
  const [bibleChapter, setBibleChapter] = useState("3");
  const [bibleVerseFrom, setBibleVerseFrom] = useState("16");
  const [bibleVerseTo, setBibleVerseTo] = useState("");
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
  const [groupInsertIndex, setGroupInsertIndex] = useState<number | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [sectionTemplateKey, setSectionTemplateKey] = useState("");
  const [saveSectionTemplate, setSaveSectionTemplate] = useState(true);
  const [addingSection, setAddingSection] = useState(false);
  const [saveItemTemplate, setSaveItemTemplate] = useState(false);
  const [audioSearchOpen, setAudioSearchOpen] = useState(false);
  const [groupTitleDraft, setGroupTitleDraft] = useState("");
  const [searchMode, setSearchMode] = useState<SearchOverlayMode>("songs");
  const [searchInsertIndex, setSearchInsertIndex] = useState<number | null>(null);
  const [deckTargetPlanItemId, setDeckTargetPlanItemId] = useState<string | null>(null);
  const [searchParentItemId, setSearchParentItemId] = useState<string | null>(null);
  const [searchParentInsertIndex, setSearchParentInsertIndex] = useState<number | null>(null);
  const [searchSelectInserted, setSearchSelectInserted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [bibleSearchResults, setBibleSearchResults] = useState<BibleSearchHit[]>([]);
  const [bibleSearchHasMore, setBibleSearchHasMore] = useState(false);
  const [bibleSearchLoadingMore, setBibleSearchLoadingMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [customProviderLoading, setCustomProviderLoading] = useState(false);
  const [customProviderResult, setCustomProviderResult] = useState<CustomProviderSearchResult | null>(null);
  const [selectedCustomProviderMatchId, setSelectedCustomProviderMatchId] = useState<string | null>(null);
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);

  useEffect(() => {
    if (!active) setServicePickerOpen(false);
  }, [active]);

  const [serviceDraftDate, setServiceDraftDate] = useState("");
  const [serviceHistoryOpen, setServiceHistoryOpen] = useState(false);
  const [pendingServiceDate, setPendingServiceDate] = useState<string | null>(null);
  const [pendingServiceTypeId, setPendingServiceTypeId] = useState("");
  const [pendingServiceMode, setPendingServiceMode] = useState<"create" | "edit">("create");
  const [creatingService, setCreatingService] = useState(false);
  const [serviceHistory, setServiceHistory] = useState<PlanHistoryEntry[]>([]);
  const [serviceHistoryLoading, setServiceHistoryLoading] = useState(false);
  const [serviceHistoryApplying, setServiceHistoryApplying] = useState(false);
  const [archivedServiceUndo, setArchivedServiceUndo] = useState<{ id: string; title: string; serviceDate: string; replacementId: string } | null>(null);
  const [archivedServiceToastVisible, setArchivedServiceToastVisible] = useState(false);
  const [emptyServiceDate, setEmptyServiceDate] = useState("");
  useEscapeClose(serviceHistoryOpen, () => setServiceHistoryOpen(false));
  useEscapeClose(Boolean(pendingServiceDate), () => setPendingServiceDate(null));
  useEffect(() => {
    if (!serviceHistoryOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".service-history-popover, .date-navigator-history")) setServiceHistoryOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [serviceHistoryOpen]);
  useEffect(() => {
    if (!archivedServiceToastVisible) return;
    const timer = window.setTimeout(() => setArchivedServiceToastVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [archivedServiceToastVisible]);
  const [customProviderSelection, setCustomProviderSelection] = useState<CustomProviderSelectResult | null>(null);
  const [customProviderSelectionLoading, setCustomProviderSelectionLoading] = useState(false);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [googleDriveStatus, setGoogleDriveStatus] = useState<GoogleDriveStatus | null>(null);
  const [googleDriveFiles, setGoogleDriveFiles] = useState<GoogleDriveFile[]>([]);
  const [googleDriveLoading, setGoogleDriveLoading] = useState(false);
  const [googleDriveError, setGoogleDriveError] = useState("");
  const [youtubeResults, setYoutubeResults] = useState<YouTubeVideo[]>([]);
  const [youtubeNextPageToken, setYoutubeNextPageToken] = useState<string | null>(null);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeLoadingMore, setYoutubeLoadingMore] = useState(false);
  const [youtubeError, setYoutubeError] = useState("");
  const [slideTheme, setSlideTheme] = useState<PresentationTheme>("light");
  const [liveBlanked, setLiveBlanked] = useState(false);
  const [audioControlsEnabled, setAudioControlsEnabled] = useState(false);
  const [recordingControlsEnabled, setRecordingControlsEnabled] = useState(false);
  const [playingAudioSectionId, setPlayingAudioSectionId] = useState<string | null>(null);
  const [localAudioUrl, setLocalAudioUrl] = useState<string | null>(null);
  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const [presentationSessionActive, setPresentationSessionActive] = useState(false);
  const [presentationAutoStarted, setPresentationAutoStarted] = useState(false);
  const [openSlideshowWindowOnStart, setOpenSlideshowWindowOnStart] = useState(false);
  const [slideshowStartMenuOpen, setSlideshowStartMenuOpen] = useState(false);
  const [broadcastRecordings, setBroadcastRecordings] = useState<BroadcastRecording[]>([]);
  const [recordingAction, setRecordingAction] = useState(false);
  const [recordingClock, setRecordingClock] = useState(Date.now());
  const [deckRenderRetryToken, setDeckRenderRetryToken] = useState(0);
  const [undoAction, setUndoAction] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const [sorterCatchUpDirection, setSorterCatchUpDirection] = useState<"up" | "down" | null>(null);
  const [railCatchUpDirection, setRailCatchUpDirection] = useState<"up" | "down" | null>(null);
  const [slideNotesDraft, setSlideNotesDraft] = useState("");
  const [slideNotesSaving, setSlideNotesSaving] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const bibleSearchLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const youtubeLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const youtubeSearchRequestIdRef = useRef(0);
  const bibleSearchRequestIdRef = useRef(0);
  const bibleSearchKeywordOffsetRef = useRef(0);
  const searchSelectionInFlightRef = useRef(false);
  const bibleSearchInsertInFlightRef = useRef(false);
  const keyCaptureRef = useRef<HTMLInputElement | null>(null);
  const outputWindowRef = useRef<Window | null>(null);
  const outputOwnerIdRef = useRef<string | null>(null);
  const slideshowStartControlRef = useRef<HTMLDivElement | null>(null);
  const localAudioFrameRef = useRef<HTMLIFrameElement | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const slideGridRef = useRef<HTMLDivElement | null>(null);
  const sectionRailListRef = useRef<HTMLDivElement | null>(null);
  const thumbnailRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const sorterSectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const sectionRailRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const currentLiveStateRef = useRef<PresentationLiveState | null>(null);
  const lastLiveStateRef = useRef<number>(0);
  const livePollInFlightRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const selectedPlanIdRef = useRef("");
  const suppressPublishRef = useRef(false);
  const suppressNextOperatorScrollRef = useRef(false);
  const scrollOperatorToSelectedSlideRef = useRef(false);
  const catchUpCheckTokenRef = useRef(0);
  const sorterCatchUpDirectionRef = useRef<"up" | "down" | null>(null);
  const railCatchUpDirectionRef = useRef<"up" | "down" | null>(null);
  const sorterFollowingRef = useRef(true);
  const railFollowingRef = useRef(true);
  const sorterProgrammaticScrollUntilRef = useRef(0);
  const railProgrammaticScrollUntilRef = useRef(0);
  const activeDeckLoadsRef = useRef<Set<string>>(new Set());
  const handledKeyboardEventsRef = useRef<WeakSet<KeyboardEvent>>(new WeakSet());
  const lastKeyboardNavigationRef = useRef<{ direction: SlideKeyboardDirection; key: string; time: number } | null>(null);

  const servicePlans = useMemo(() => plans.filter((candidate) => !isWorshipSetPlan(candidate)), [plans]);
  const worshipSetPlans = useMemo(() => plans.filter(isWorshipSetPlan), [plans]);
  const completedPlanLocked = !canAccessAdminTools && isPlanEditingLocked(plan, planTypes, plans);
  const canEditPlan = hasPlanEditPermission && !completedPlanLocked;
  const currentPlanType = useMemo(
    () => planTypes.find((type) => type.id === plan?.plan_type_id) ?? null,
    [plan?.plan_type_id, planTypes],
  );
  const pendingServiceType = planTypes.find((type) => type.id === pendingServiceTypeId && type.active) ?? null;
  const effectivePlanItems = useMemo(
    () => {
      const mergedItems = mergeWorshipSetIntoService(plan?.items ?? [], worshipSetPlan?.items ?? []);
      const worshipSongIds = new Set(
        (worshipSetPlan?.items ?? [])
          .filter((item) => item.item_type === "song" && item.song_id)
          .map((item) => item.id),
      );
      if (!worshipSongIds.size || !plan) return mergedItems;
      const firstWorshipIndex = mergedItems.findIndex((item) => worshipSongIds.has(item.id));
      if (firstWorshipIndex < 0) return mergedItems;
      const storedAnchor = (plan.items ?? []).find((item) => item.item_type === WORSHIP_SET_ANCHOR_ITEM_TYPE);
      const anchor: PlanItem = storedAnchor ?? {
        id: "__worship_anchor__",
        plan_id: plan.id,
        song_id: null,
        item_type: WORSHIP_SET_ANCHOR_ITEM_TYPE,
        sequence: mergedItems[firstWorshipIndex]?.sequence ?? "30.00",
        title: "Worship",
        comment: null,
        key_signature: null,
        teacher_notes: null,
        files: [],
      };
      const withoutWorshipSongs = mergedItems.filter((item) => !worshipSongIds.has(item.id));
      const insertionIndex = mergedItems.slice(0, firstWorshipIndex).filter((item) => !worshipSongIds.has(item.id)).length;
      const groupedSongs = mergedItems
        .filter((item) => worshipSongIds.has(item.id))
        .map((item) => ({ ...item, parent_item_id: anchor.id }));
      return [
        ...withoutWorshipSongs.slice(0, insertionIndex),
        anchor,
        ...groupedSongs,
        ...withoutWorshipSongs.slice(insertionIndex),
      ];
    },
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

  const plansByDate = useMemo(
    () =>
      new Map(
        servicePlans
          .map((planSummary) => [dateInputFromIso(planSummary.service_date), planSummary] as const)
          .filter(([date]) => Boolean(date)),
      ),
    [servicePlans],
  );
  const worshipSetsByDate = useMemo(
    () => new Map(worshipSetPlans.map((setSummary) => [dateInputFromIso(setSummary.service_date), setSummary] as const)),
    [worshipSetPlans],
  );
  const plannedServiceDates = useMemo(() => {
    const byDate = new Map<string, PlanSummary>();
    for (const service of servicePlans) {
      const date = dateInputFromIso(service.service_date);
      if (date && combinedPlanningItemCount(service, worshipSetsByDate.get(date)) > 0 && !byDate.has(date)) {
        byDate.set(date, service);
      }
    }
    return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [servicePlans, worshipSetsByDate]);
  const currentServiceDate = dateInputFromIso(plan?.service_date) || emptyServiceDate;
  const previousPlannedService = [...plannedServiceDates]
    .reverse()
    .find(([date]) => date < currentServiceDate)?.[1] ?? null;
  const nextPlannedService = plannedServiceDates.find(([date]) => date > currentServiceDate)?.[1] ?? null;
  const allCalendarDates = useMemo(
    () => calendarDatesAround(serviceDraftDate || nextSundayDateInput()),
    [serviceDraftDate],
  );
  const sundayCalendarDates = useMemo(
    () => sundayDatesAround(serviceDraftDate || nextSundayDateInput()),
    [serviceDraftDate],
  );
  function serviceCalendarItemCount(dateInput: string) {
    if (dateInputFromIso(plan?.service_date) === dateInput) return explicitPlanningItemCount(effectivePlanItems);
    return combinedPlanningItemCount(plansByDate.get(dateInput), worshipSetsByDate.get(dateInput));
  }
  function serviceCalendarDay(dateInput: string) {
    const isToday = dateInput === dateInputFromDate(new Date());
    return {
      date: dateInput,
      className: `${serviceCalendarItemCount(dateInput) > 0 ? "has-service" : ""} ${isToday ? "is-today" : ""}`.trim(),
      itemCount: serviceCalendarItemCount(dateInput),
      itemLabel: "service item",
    };
  }
  const slides = useMemo(
    () => buildPresentationSlides(effectivePlanItems, songs, renderedSlidesByFileId),
    [effectivePlanItems, songs, renderedSlidesByFileId],
  );
  const liveSlide = slides[liveIndex] ?? null;
  const preServicePlanItem = effectivePlanItems.find((item) => item.item_type === "welcome_montage")
    ?? effectivePlanItems.find((item) => item.item_type === "pre_service")
    ?? null;
  const fillerMediaPlanItem = effectivePlanItems.find((item) => item.id === fillerMediaPlanItemId) ?? null;
  const fillerMediaSectionItem = effectivePlanItems.find((item) => item.id === fillerMediaSectionId) ?? null;
  const inheritedSectionBackingAudioId = fillerMediaPlanItem && fillerMediaSectionItem?.id !== fillerMediaPlanItem.id
    ? fillerMediaSectionItem?.presentation_options?.backing_audio_id ?? ""
    : "";
  const automaticAudioSceneId = fillerMediaPlanItem
    ? automaticSceneIdForItem(fillerMediaPlanItem.item_type, fillerMediaSectionItem?.item_type)
    : "pastor";
  const automaticAudioSceneLabel = audioScenes.find((scene) => scene.id === automaticAudioSceneId)?.label ?? automaticAudioSceneId;
  const fillerMediaImageFiles = fillerMediaPlanItem?.files.filter((file) => file.content_type?.startsWith("image/")) ?? [];
  const fillerMediaEditorReady = fillerMediaImageFiles.every((file) => loadedFillerMediaFileIds.has(file.file_id));
  const currentPlanItem = effectivePlanItems.find((item) => item.id === liveSlide?.planItemId) ?? null;
  const activeSermonRecording = broadcastRecordings.find(
    (recording) => recording.plan_id === plan?.id && (recording.status === "recording" || recording.status === "paused"),
  ) ?? null;
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
  const isWelcomePlanItem = [
    "pre_service",
    "welcome",
    "welcome_montage",
    "welcome_countdown",
    "welcome_seated",
    "opening",
    "seating",
    "countdown",
  ].includes(
    currentPlanItem?.item_type ?? "",
  );
  const currentParentPlanItem = currentPlanItem?.parent_item_id
    ? effectivePlanItems.find((item) => item.id === currentPlanItem.parent_item_id) ?? null
    : null;
  const currentPlanItemAllowsNotes =
    !isWelcomePlanItem &&
    (currentPlanItem?.item_type === "sermon" || currentParentPlanItem?.item_type === "sermon");
  const currentSlideSavedNotes = slideNoteFor(currentPlanItem?.teacher_notes, liveSlide, currentPlanItemSlides);
  const slideNotesDirty = slideNotesDraft.trim() !== currentSlideSavedNotes;
  const planTextSlides = useMemo(
    () => slides.filter((slide) => !slide.imageUrl && slide.text.trim()),
    [slides],
  );
  const liveTextFontCap = suggestedSlideFontCap(liveSlide);
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
            : `${song.title} ${song.author ?? ""} ${song.alternate_title ?? ""} ${song.theme_tags ?? ""} ${song.lyrics ?? ""}`
                .toLowerCase()
                .includes(searchQuery.trim().toLowerCase()),
        ),
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

  async function openPlanItemEditor(item: PlanItem, sectionItem?: PlanItem | null) {
    if (item.song_id) {
      openSongEditor(item.song_id);
      return;
    }
    if (!INLINE_EDIT_ITEM_TYPES.has(item.item_type)) return;
    setFillerMediaEditorLoading(true);
    setLoadedFillerMediaFileIds(new Set());
    setItemEditorSection(null);
    setSaveItemTemplate(false);
    setAudioSearchOpen(false);
    try {
      const freshPlan = await getPlan(item.plan_id);
      const freshItem = freshPlan.items.find((candidate) => candidate.id === item.id) ?? item;
      const requestedSection = sectionItem ?? (!item.parent_item_id
        ? item
        : freshPlan.items.find((candidate) => candidate.id === item.parent_item_id) ?? null);
      const freshSection = requestedSection
        ? freshPlan.items.find((candidate) => candidate.id === requestedSection.id) ?? requestedSection
        : null;
      if (freshPlan.id === plan?.id) setPlan(freshPlan);
      if (freshPlan.id === worshipSetPlan?.id) setWorshipSetPlan(freshPlan);
      setItemEditDraft({
        ...EMPTY_ITEM_EDIT_DRAFT,
        ...freshItem.presentation_options,
        title: freshItem.title,
        comment: freshItem.comment ?? "",
        planned_start: freshItem.parent_item_id ? (freshItem.planned_start ?? "") : (freshPlan.queued_start ?? ""),
        auto_collapse_items: Boolean(freshSection?.auto_collapse_items),
      });
      setFillerMediaPlanItemId(freshItem.id);
      setFillerMediaSectionId(freshSection?.id ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load the item editor.");
    } finally {
      setFillerMediaEditorLoading(false);
    }
  }

  function closePlanItemEditor() {
    setFillerMediaPlanItemId(null);
    setFillerMediaSectionId(null);
    setLoadedFillerMediaFileIds(new Set());
    setItemEditorSection(null);
    setSaveItemTemplate(false);
    setAudioSearchOpen(false);
    setItemEditDraft(EMPTY_ITEM_EDIT_DRAFT);
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

  useEffect(() => {
    void getBroadcastViewerSettings()
      .then((settings) => { setServiceSchedules(settings.service_schedules); setAudioScenes(settings.audio_scenes); })
      .catch(() => setServiceSchedules([]));
  }, []);

  useEffect(() => {
    if (!plan?.id) {
      setBroadcastRecordings([]);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const recordings = await getBroadcastRecordings();
        if (!cancelled) {
          setBroadcastRecordings(recordings);
        }
      } catch {
        // Presentation remains usable when recording status is temporarily unavailable.
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [plan?.id]);

  useEffect(() => {
    if (!activeSermonRecording?.pending_stop_at) return undefined;
    setRecordingClock(Date.now());
    const timer = window.setInterval(() => setRecordingClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeSermonRecording?.pending_stop_at]);

  async function runRecordingAction(action: "start" | "stop" | "pause" | "resume") {
    if (recordingAction || !plan) {
      return;
    }
    setRecordingAction(true);
    try {
      if (action === "start") {
        if (currentPlanItem?.item_type !== "sermon") {
          setMessage("Select a sermon slide before starting the recording.");
          return;
        }
        await startBroadcastRecording({ plan_id: plan.id, plan_item_id: currentPlanItem.id });
      } else if (action === "stop") {
        await stopBroadcastRecording();
      } else if (action === "pause") {
        await pauseBroadcastRecording();
      } else {
        await resumeBroadcastRecording();
      }
      setBroadcastRecordings(await getBroadcastRecordings());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not ${action} the sermon recording.`);
    } finally {
      setRecordingAction(false);
    }
  }

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

  function toggleRailGroup(groupId: string) {
    setExpandedRailGroupIds((current) => {
      const next = new Set(current);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
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
    const currentState = currentLiveStateRef.current;
    const currentSlide = currentState
      ? slideList[resolveLiveIndex(slideList, currentState)] ?? null
      : null;
    const videoPlaybackState = videoPlaybackStateForSlideTransition(
      currentState,
      currentSlide,
      slide,
      overrides,
    );

    return {
      planId,
      index: nextIndex,
      updatedAt: overrides.updatedAt ?? Date.now(),
      planItemId: overrides.planItemId ?? slide?.planItemId ?? null,
      slideOffset: overrides.slideOffset ?? Math.max(slideOffset, 0),
      theme: overrides.theme ?? slideTheme,
      blanked: overrides.blanked ?? liveBlanked,
      fullscreen: currentLiveStateRef.current?.fullscreen ?? false,
      videoAction: videoPlaybackState.videoAction,
      videoActionAt: videoPlaybackState.videoActionAt,
      serviceStage: overrides.serviceStage ?? currentLiveStateRef.current?.serviceStage,
      preServicePhase: overrides.preServicePhase === undefined
        ? currentLiveStateRef.current?.preServicePhase
        : overrides.preServicePhase,
      autoStarted: overrides.autoStarted ?? currentLiveStateRef.current?.autoStarted,
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
    if (state.videoAction === "play" && state.planItemId) setPlayingAudioSectionId(state.planItemId);
    if (["pause", "stop", "fade-stop"].includes(state.videoAction ?? "")) setPlayingAudioSectionId(null);
    const nextIndex = resolveLiveIndex(slides, state);
    setLiveIndex(nextIndex);
    setAutoAdvanceArmedSlideId(slides[nextIndex]?.id ?? null);
    localStorage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify(state));
    channelRef.current?.postMessage(state);
  }

  async function load(planId?: string, options?: LoadOptions) {
    const requestId = ++loadRequestIdRef.current;
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
          : sessionStorage.getItem(SELECTED_SERVICE_SESSION_KEY) || selectedPlanIdRef.current;
      const nextServicePlans = nextPlans.filter((candidate) => !isWorshipSetPlan(candidate));
      const nextWorshipSetPlans = nextPlans.filter(isWorshipSetPlan);
      const requestedPlan = nextServicePlans.find((candidate) => candidate.id === requestedPlanId);
      const defaultServicePlanId = preferredServicePlanId(nextServicePlans, nextWorshipSetPlans);
      const defaultServiceDate = dateInputFromIso(
        nextServicePlans.find((candidate) => candidate.id === defaultServicePlanId)?.service_date,
      ) || defaultPlanningDate([]);
      const requestedPlanIsUsable =
        planId !== undefined || (requestedPlan && dateInputFromIso(requestedPlan.service_date) === defaultServiceDate);
      const targetPlanId = requestedPlan && requestedPlanIsUsable
        ? requestedPlanId
        : defaultServicePlanId;
      const [targetPlan, liveState] = await Promise.all([
        targetPlanId ? getPlan(targetPlanId) : Promise.resolve(null),
        targetPlanId ? getPresentationLiveState(targetPlanId) : Promise.resolve(null),
      ]);
      const matchingWorshipSet = matchingWorshipSetForService(targetPlan, nextWorshipSetPlans);
      const nextWorshipSetPlan = matchingWorshipSet ? await getPlan(matchingWorshipSet.id) : null;
      if (requestId !== loadRequestIdRef.current) return;
      selectedPlanIdRef.current = targetPlanId;
      setSelectedPlanId(targetPlanId);
      if (targetPlanId) {
        sessionStorage.setItem(SELECTED_SERVICE_SESSION_KEY, targetPlanId);
      } else {
        sessionStorage.removeItem(SELECTED_SERVICE_SESSION_KEY);
      }
      setPlan(targetPlan);
      setWorshipSetPlan(nextWorshipSetPlan);
      setEmptyServiceDate(targetPlan ? "" : defaultServiceDate);
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
            serviceStage: liveState.service_stage ?? "ready",
            preServicePhase: liveState.pre_service_phase ?? null,
            autoStarted: Boolean(liveState.auto_started),
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
      setPresentationSessionActive(liveState?.status === "live");
      setPresentationAutoStarted(Boolean(liveState?.auto_started));
      const nextLiveIndex = preservedIndex >= 0 ? preservedIndex : 0;
      if (options?.preserveLocation && preservedIndex >= 0 && options.publishPreservedLocation !== false) {
        setLiveBlanked(false);
        void publishLiveStateForSlides(nextSlides, nextLiveIndex, { blanked: false }, targetPlan?.id);
      }
      if (!options?.silent) {
        catchUpCheckTokenRef.current += 1;
        scrollOperatorToSelectedSlideRef.current = true;
        sorterCatchUpDirectionRef.current = null;
        railCatchUpDirectionRef.current = null;
        setSorterCatchUpDirection(null);
        setRailCatchUpDirection(null);
        sorterFollowingRef.current = true;
        railFollowingRef.current = true;
      }
      setLiveIndex(nextLiveIndex);
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) return;
      if (!isTransientApiError(error) || !plan) {
        setPlan(null);
        setWorshipSetPlan(null);
      }
      setMessage(error instanceof Error ? error.message : "Could not load presentation.");
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
      }
    }
  }

  function publishFadeOutAudio() {
    if (!playingAudioSectionId) {
      return;
    }
    setPlayingAudioSectionId(null);
    if (localAudioUrl) {
      let step = 0;
      const interval = window.setInterval(() => {
        step += 1;
        const volume = Math.max(0, Math.round(100 * (1 - step / AUDIO_FADE_STEPS)));
        localAudioFrameRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: "command", func: "setVolume", args: [volume] }),
          "*",
        );
        if (step >= AUDIO_FADE_STEPS) {
          window.clearInterval(interval);
          localAudioFrameRef.current?.contentWindow?.postMessage(
            JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
            "*",
          );
          setLocalAudioUrl(null);
        }
      }, AUDIO_FADE_INTERVAL_MS);
    }
    void publishLiveState(liveIndex, {
      videoAction: "fade-stop",
      videoActionAt: Date.now(),
    });
  }

  async function guardedLiveNavigation(nextIndex: number, navigate: (boundedIndex: number) => void) {
    const slideCount = slides.length;
    if (!slideCount) {
      setLiveBlanked(false);
      setLiveIndex(0);
      void publishLiveState(0, { blanked: false });
      return;
    }

    const boundedIndex = Math.min(Math.max(nextIndex, 0), slideCount - 1);
    const targetSlide = slides[boundedIndex];
    if (playingAudioSectionId && (targetSlide?.stopBackingAudio || (targetSlide?.planItemId !== playingAudioSectionId && targetSlide?.sectionId !== playingAudioSectionId))) {
      const confirmed = targetSlide?.stopBackingAudio || await confirm({
        confirmLabel: "Fade Out",
        message: "This will fade out the playing YouTube audio. Continue?",
        title: "Fade Playing Audio",
      });
      if (!confirmed) {
        return;
      }
      publishFadeOutAudio();
      window.setTimeout(() => navigate(boundedIndex), PROGRAM_AUDIO_FADE_DURATION_MS);
      return;
    }
    navigate(boundedIndex);
  }

  function setLiveSlide(nextIndex: number) {
    void guardedLiveNavigation(nextIndex, (boundedIndex) => {
      setLiveBlanked(false);
      setLiveIndex(boundedIndex);
      setAutoAdvanceArmedSlideId(slides[boundedIndex]?.id ?? null);
      void publishLiveState(boundedIndex, { blanked: false });
    });
  }

  function moveLive(delta: number) {
    const slideCount = slides.length;
    if (!slideCount) {
      setLiveBlanked(false);
      setLiveIndex(0);
      void publishLiveState(0, { blanked: false });
      return;
    }
    const nextIndex = Math.min(Math.max(liveIndex + delta, 0), slideCount - 1);
    void guardedLiveNavigation(nextIndex, (boundedIndex) => {
      setLiveBlanked(false);
      setLiveIndex(boundedIndex);
      setAutoAdvanceArmedSlideId(slides[boundedIndex]?.id ?? null);
      void publishLiveState(boundedIndex, { blanked: false });
    });
  }

  useEffect(() => {
    const selectedForAutoAdvance = autoAdvanceArmedSlideId === liveSlide?.id;
    if (!presentationSessionActive || (!slideshowOpen && !selectedForAutoAdvance) || liveBlanked || !liveSlide?.autoAdvanceSeconds) return undefined;
    const nextSlide = slides[liveIndex + 1];
    const endsHere = liveSlide.endAfterSection && nextSlide?.sectionId !== liveSlide.sectionId;
    if (!endsHere && liveIndex >= slides.length - 1) return undefined;
    const timer = window.setTimeout(() => {
      if (endsHere) {
        void closeActiveSlideshow().then(() => setMessage(`Service ended after ${liveSlide.sectionTitle}.`));
      } else {
        moveLive(1);
      }
    }, Math.max(liveSlide.autoAdvanceSeconds, 1) * 1000);
    return () => window.clearTimeout(timer);
  }, [autoAdvanceArmedSlideId, liveBlanked, liveIndex, liveSlide?.autoAdvanceSeconds, liveSlide?.endAfterSection, liveSlide?.id, liveSlide?.sectionId, liveSlide?.sectionTitle, presentationSessionActive, slideshowOpen, slides]);

  function sorterTargetForSlide(slide: PresentationSlide | null | undefined) {
    if (!slide) return null;
    const directTarget = thumbnailRefs.current[slide.id];
    if (directTarget) return directTarget;
    const section = sections.find((candidate) => candidate.id === slide.sectionId);
    const firstVisibleSlide = section ? sorterSlidesForSection(section.slides)[0] : null;
    return (firstVisibleSlide ? thumbnailRefs.current[firstVisibleSlide.id] : null) ?? sorterSectionRefs.current[slide.sectionId] ?? null;
  }

  function railTargetForSlide(slide: PresentationSlide | null | undefined) {
    if (!slide) return null;
    return sectionRailRefs.current[slide.planItemId] ?? sectionRailRefs.current[slide.sectionId] ?? null;
  }

  function selectSlideFromOperator(nextIndex: number) {
    const targetSlide = slides[Math.min(Math.max(nextIndex, 0), Math.max(slides.length - 1, 0))];
    catchUpCheckTokenRef.current += 1;
    scrollOperatorToSelectedSlideRef.current = true;
    sorterCatchUpDirectionRef.current = null;
    railCatchUpDirectionRef.current = null;
    setSorterCatchUpDirection(null);
    setRailCatchUpDirection(null);
    sorterFollowingRef.current = true;
    railFollowingRef.current = true;
    if (targetSlide) {
      sorterProgrammaticScrollUntilRef.current = Date.now() + 900;
      railProgrammaticScrollUntilRef.current = Date.now() + 900;
      window.requestAnimationFrame(() => {
        scrollItemIntoOperatorView(
          slideGridRef.current,
          sorterTargetForSlide(targetSlide),
        );
        scrollItemIntoOperatorView(sectionRailListRef.current, railTargetForSlide(targetSlide));
      });
    }
    setLiveSlide(nextIndex);
  }

  function updateCatchUpDirectionsForSlide(index: number) {
    const activeSlide = slides[index];
    const sorterTarget = sorterTargetForSlide(activeSlide);
    const nextSorterDirection = slideVisibilityDirection(slideGridRef.current, sorterTarget);
    const nextRailDirection = slideVisibilityDirection(sectionRailListRef.current, railTargetForSlide(activeSlide));
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
    sorterFollowingRef.current = true;
    railFollowingRef.current = true;
    sorterProgrammaticScrollUntilRef.current = Date.now() + 900;
    railProgrammaticScrollUntilRef.current = Date.now() + 900;
    scrollItemIntoOperatorView(
      slideGridRef.current,
      sorterTargetForSlide(activeSlide),
    );
    scrollItemIntoOperatorView(sectionRailListRef.current, railTargetForSlide(activeSlide));
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

  async function toggleSectionAudio(section: { id: string; slides: PresentationSlide[] }) {
    const isPlaying = playingAudioSectionId === section.id;
    if (!audioControlsEnabled && !isPlaying) {
      return;
    }
    const audioSlide = section.slides.find((slide) => slide.youtubeAudioUrl);
    if (!audioSlide) {
      return;
    }
    const audioIndex = slides.findIndex((slide) => slide.id === audioSlide.id);
    if (audioIndex < 0) {
      return;
    }
    const targetIndex = liveSlide?.planItemId === section.id || liveSlide?.sectionId === section.id ? liveIndex : audioIndex;
    if (isPlaying) {
      publishFadeOutAudio();
      return;
    }
    setPlayingAudioSectionId(section.id);
    const outputStatus = plan?.id ? await getPresentationOutputStatus(plan.id).catch(() => null) : null;
    const shouldPlayLocally = !outputStatus?.active;
    if (!isPlaying) {
      setLiveBlanked(false);
      setLiveIndex(targetIndex);
    }
    if (shouldPlayLocally) {
      setLocalAudioUrl(audioSlide.youtubeAudioUrl ?? null);
      window.setTimeout(() => {
        localAudioFrameRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: "command", func: "playVideo", args: [] }),
          "*",
        );
      }, 350);
    } else {
      setLocalAudioUrl(null);
    }
    void publishLiveState(targetIndex, {
      blanked: false,
      videoAction: "play",
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
        service_stage: state.serviceStage ?? "ready",
        pre_service_phase: state.preServicePhase ?? null,
      });
      lastLiveStateRef.current = synced.updated_at;
      setPresentationSessionActive(synced.status === "live");
      setPresentationAutoStarted(Boolean(synced.auto_started));
    } catch (error) {
      if (!isTransientApiError(error)) {
        setMessage(error instanceof Error ? error.message : "Could not sync presentation state.");
      }
    }
  }

  async function publishLiveState(nextIndex: number, overrides: Partial<PresentationLiveState> = {}) {
    await publishLiveStateForSlides(slides, nextIndex, overrides);
  }

  async function showPreServiceRehearsalPhase(phase: "montage" | "countdown" | "complete") {
    const stageType = phase === "montage"
      ? "welcome_montage"
      : phase === "countdown"
        ? "welcome_countdown"
        : "welcome_seated";
    const stageIndex = slides.findIndex((slide) => slide.itemType === stageType);
    const welcomeIndex = stageIndex >= 0
      ? stageIndex
      : slides.findIndex((slide) => slide.itemType === "pre_service");
    if (welcomeIndex < 0) {
      setMessage("This service does not have a Welcome section to rehearse.");
      return;
    }
    setLiveIndex(welcomeIndex);
    setLiveBlanked(false);
    setSlideshowStartMenuOpen(false);
    await publishLiveState(welcomeIndex, {
      blanked: false,
      serviceStage: "pre_service",
      preServicePhase: phase,
    });
    setMessage(
      phase === "montage"
        ? "Test preview: welcome montage selected. The slideshow has not started."
        : phase === "countdown"
          ? "Test preview: pre-service countdown selected. The slideshow has not started."
          : "Test preview: countdown ending selected. The slideshow has not started.",
    );
  }

  async function startServiceFromMenu() {
    if (!slideshowOpen && !(await startSlideshow(openSlideshowWindowOnStart))) {
      return;
    }
    setLiveBlanked(false);
    setSlideshowStartMenuOpen(false);
    await publishLiveState(liveIndex, {
      blanked: false,
      serviceStage: "service",
      preServicePhase: null,
    });
    setMessage("Service started on the current slide.");
  }

  async function stopServiceTest() {
    setSlideshowStartMenuOpen(false);
    await closeActiveSlideshow();
    setMessage("Service test stopped and live output reset.");
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

  function closeLocalSlideshowWindow() {
    if (outputWindowRef.current && !outputWindowRef.current.closed) {
      outputWindowRef.current.close();
    }
    outputWindowRef.current = null;
  }

  async function closeActiveSlideshow() {
    if (!plan) {
      return;
    }
    const status = await getPresentationOutputStatus(plan.id).catch(() => null);
    const ownerId = status?.owner_id ?? outputOwnerIdRef.current ?? outputOwnerId();
    try {
      await updatePresentationOutputStatus(plan.id, {
        owner_id: ownerId,
        heartbeat_at: Date.now(),
        release: true,
      });
      closeLocalSlideshowWindow();
      outputOwnerIdRef.current = null;
      setSlideshowOpen(false);
      setPresentationSessionActive(false);
      setPresentationAutoStarted(false);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not stop the slideshow.");
    }
  }

  async function toggleOutputFullscreen() {
    const outputWindow = outputWindowRef.current;
    if (!outputWindow || outputWindow.closed) {
      if (slideshowOpen) {
        setMessage("Use the Fullscreen button on the display; remote browsers cannot enter fullscreen without a click on that device.");
      } else {
        await startSlideshow(true);
      }
      return;
    }
    try {
      if (outputWindow.document.fullscreenElement) {
        await outputWindow.document.exitFullscreen();
      } else {
        await outputWindow.document.documentElement.requestFullscreen();
      }
      outputWindow.focus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not change slideshow fullscreen mode.");
    }
  }

  async function startSlideshow(openLocalWindow = openSlideshowWindowOnStart) {
    if (!plan) {
      setMessage("Select a plan before starting the slideshow.");
      return false;
    }

    if (slideshowOpen) {
      await closeActiveSlideshow();
      return false;
    }

    const currentOutputStatus = await getPresentationOutputStatus(plan.id).catch(() => null);
    if (currentOutputStatus?.active) {
      outputOwnerIdRef.current = currentOutputStatus.owner_id;
      setSlideshowOpen(true);
      setPresentationSessionActive(true);
      setPresentationAutoStarted(false);
      return true;
    }

    const ownerId = outputOwnerId();
    const claimed = await updatePresentationOutputStatus(plan.id, {
      owner_id: ownerId,
      heartbeat_at: Date.now(),
    }).catch(() => null);
    if (!claimed?.claimed || claimed.owner_id !== ownerId) {
      setMessage("Could not start the slideshow because another output session is active.");
      setSlideshowOpen(Boolean(claimed?.active));
      return false;
    }

    outputOwnerIdRef.current = ownerId;
    setSlideshowOpen(true);
    setPresentationSessionActive(true);
    setLiveBlanked(false);
    await publishLiveState(liveIndex, { blanked: false, serviceStage: "service", preServicePhase: null });

    if (!openLocalWindow) {
      setMessage("Slideshow started. Connected TV and browser displays are active.");
      return true;
    }

    const detectedScreens = isMobileOrTabletDevice() ? [] : screens.length ? screens : await detectDisplays();
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
    url.searchParams.set("outputId", ownerId);

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
      setMessage("The TV presentation is active, but the browser blocked the local output window. Allow pop-ups to open it next time.");
      return true;
    }

    outputWindowRef.current = outputWindow;
    setMessage(null);
    outputWindow.focus();
    return true;
  }

  async function selectPlan(planId: string) {
    selectedPlanIdRef.current = planId;
    setEmptyServiceDate("");
    setServiceHistoryOpen(false);
    setServicePickerOpen(false);
    await load(planId);
  }

  function openServicePicker() {
    const draftDate = dateInputFromIso(plan?.service_date) || emptyServiceDate || nextSundayDateInput();
    setServiceDraftDate(draftDate);
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

  function formatHistoryLabel(label: string) {
    return label.replace(/^(?:(?:reverting|restoring|restored)\s+)+/gi, "").replace(/^adding\s+/i, "Added ").replace(/^removing\s+/i, "Removed ").replace(/^moving\s+/i, "Moved ").replace(/^importing\s+/i, "Imported ").replace(/^editing\s+/i, "Edited ").replace(/^archiving\s+/i, "Archived ");
  }

  async function openServiceHistory() {
    if (!plan && !archivedServiceUndo) {
      return;
    }
    const nextOpen = !serviceHistoryOpen;
    setServicePickerOpen(false);
    setServiceHistoryOpen(nextOpen);
    if (!nextOpen) {
      return;
    }
    if (!plan) return;
    setServiceHistoryLoading(true);
    try {
      setServiceHistory(await getPlanHistory(plan.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load service history.");
    } finally {
      setServiceHistoryLoading(false);
    }
  }

  function snapshotServiceItems(items: PlanItem[]): PlanHistorySnapshotItem[] {
    return items.map(({ id, parent_item_id, item_type, sequence, title, planned_start, comment, key_signature, song_id }) => ({
      id, parent_item_id, item_type, sequence, title, planned_start, comment, key_signature, song_id,
    }));
  }

  async function applyServiceSnapshot(target: PlanHistorySnapshotItem[]) {
    if (!plan) throw new Error("Select a service first.");
    const current = await getPlan(plan.id);
      const targetIds = new Set(target.map((item) => item.id));
      await Promise.all(current.items.filter((item) => !targetIds.has(item.id)).map((item) => deletePlanItem(item.id)));
      const restoredIds = new Map(current.items.map((item) => [item.id, item.id]));
      const orderedTarget = [...target.filter((item) => !item.parent_item_id), ...target.filter((item) => item.parent_item_id)];
      for (const item of orderedTarget) {
        const payload = {
          parent_item_id: item.parent_item_id ? restoredIds.get(item.parent_item_id) ?? null : null,
          item_type: item.item_type, sequence: item.sequence, title: item.title,
          planned_start: item.planned_start, comment: item.comment,
          key_signature: item.key_signature, song_id: item.song_id,
        };
        if (current.items.some((candidate) => candidate.id === item.id)) await updatePlanItem(item.id, payload);
        else {
          const created = await createPlanItem(plan.id, payload);
          restoredIds.set(item.id, created.id);
        }
      }
    return { before: current, after: await getPlan(plan.id) };
  }

  async function applyServiceHistory(entry: PlanHistoryEntry) {
    if (!plan || !entry.restorable || serviceHistoryApplying) return;
    const confirmed = await confirm({
      confirmLabel: "Restore version",
      message: "Restore the service to this point in time? Changes made after it will be unwound, and this restore will be recorded in history.",
      title: "Restore Service Version",
    });
    if (!confirmed) return;
    setServiceHistoryApplying(true);
    try {
      const restored = await applyServiceSnapshot(entry.after);
      const historyEntry = await createPlanHistoryEntry(plan.id, {
        label: `Restored ${formatHistoryLabel(entry.label)}`,
        before: snapshotServiceItems(restored.before.items),
        after: snapshotServiceItems(restored.after.items),
        affected: entry.affected || entry.label,
        change_type: "plan_items",
        restorable: true,
      });
      setServiceHistory((history) => [...history, historyEntry]);
      await load(plan.id, { silent: true });
      setServiceHistoryOpen(false);
      setMessage("Service restored to the selected version.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not restore this service version.");
    } finally {
      setServiceHistoryApplying(false);
    }
  }

  async function undoServiceHistoryEntry(entry: PlanHistoryEntry) {
    if (!plan || !entry.restorable || serviceHistoryApplying) return;
    setServiceHistoryApplying(true);
    try {
      if (entry.entity_type === "song" && entry.entity_id) {
        if (entry.change_type === "song_archive") await restoreSong(entry.entity_id);
        else await updateSong(entry.entity_id, (entry.data_before ?? {}) as Parameters<typeof updateSong>[1]);
        await load(plan.id, { refreshCatalogs: true, silent: true });
        setMessage(`Undid only: ${formatHistoryLabel(entry.label)}.`);
        return;
      }
      const current = await getPlan(plan.id);
      const target = undoHistoryEntrySnapshot(snapshotServiceItems(current.items), entry);
      const restored = await applyServiceSnapshot(target);
      const historyEntry = await createPlanHistoryEntry(plan.id, {
        label: `Undid ${formatHistoryLabel(entry.label)}`,
        before: snapshotServiceItems(restored.before.items),
        after: snapshotServiceItems(restored.after.items),
        affected: entry.affected || entry.label,
        change_type: "plan_items",
        restorable: true,
      });
      setServiceHistory((history) => [...history, historyEntry]);
      await load(plan.id, { silent: true });
      setMessage(`Undid only: ${formatHistoryLabel(entry.label)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not undo this service change.");
    } finally {
      setServiceHistoryApplying(false);
    }
  }

  async function stepService(direction: "previous" | "next") {
    const target = direction === "previous" ? previousPlannedService : nextPlannedService;
    if (target) {
      await selectPlan(target.id);
    }
  }

  function serviceHistoryContent() {
    if (!serviceHistoryOpen) {
      return null;
    }
    const firstVersion = serviceHistory.find((entry) => entry.entity_type !== "song" && entry.restorable && entry.before.length > 0);
    return (
      <section className="worship-history-popover service-history-popover" aria-label="Service edit history">
        <div className="worship-history-popover-heading">
          <strong>Edit History</strong>
          {plan && canAccessAdminTools && canDeletePlan ? (
            <button className="text-button history-archive-button" onClick={() => void archiveCurrentPlan()} type="button"><Archive size={14} /> Archive</button>
          ) : null}
          <button className="section-icon-button" onClick={() => setServiceHistoryOpen(false)} type="button" aria-label="Close edit history">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="worship-history-list">
          {serviceHistoryLoading ? <p className="search-empty">Loading history...</p> : null}
          {!serviceHistoryLoading && !serviceHistory.length && !archivedServiceUndo ? <p className="search-empty">No service edits recorded yet.</p> : null}
          {archivedServiceUndo ? (
            <div className="worship-history-row is-audit">
              <div className="history-version-button">
                <span>Archived “{archivedServiceUndo.title}”</span>
                <small>{serviceLongDateForInput(archivedServiceUndo.serviceDate)}</small>
              </div>
              <button aria-label={`Restore archived service ${archivedServiceUndo.title}`} className="history-single-undo-button" onClick={() => void undoArchivedService()} title="Restore archived service" type="button">
                <RotateCcw size={15} aria-hidden="true" /><span>Undo archive</span>
              </button>
            </div>
          ) : null}
          {firstVersion ? (
            <div className="worship-history-row">
              <button className="history-version-button" disabled={serviceHistoryApplying} onClick={() => void applyServiceHistory({ ...firstVersion, id: `original-${firstVersion.id}`, label: "Original service", after: firstVersion.before })} title="Restore the original service" type="button">
                <span>Original service</span><small>First recorded version</small>
              </button>
            </div>
          ) : null}
          {[...serviceHistory].reverse().map((entry) => {
            const isPlanVersion = entry.entity_type !== "song" && entry.after.length > 0;
            const meta = [entry.entity_type === "song" ? "Song" : entry.restorable ? "Service" : "Audit", entry.actor_name, formatHistoryTime(entry.created_at)].filter(Boolean).join(" · ");
            return (
              <div className={`worship-history-row ${entry.restorable ? "" : "is-audit"}`} key={entry.id}>
                <button className="history-version-button" disabled={!isPlanVersion || serviceHistoryApplying} onClick={() => void applyServiceHistory(entry)} title={isPlanVersion ? "Restore this point in time" : undefined} type="button">
                  <span>{formatHistoryLabel(entry.label)}</span>
                  <small>{meta}</small>
                </button>
                {entry.restorable ? (
                  <button aria-label={`Undo only ${formatHistoryLabel(entry.label)}`} className="history-single-undo-button" disabled={serviceHistoryApplying} onClick={() => void undoServiceHistoryEntry(entry)} title="Undo only this change" type="button">
                    <RotateCcw size={15} aria-hidden="true" /><span>Undo change</span>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  async function recordServiceHistory(label: string, affected: string, changeType: string) {
    if (!plan?.id) {
      return;
    }
    try {
      const current = await getPlan(plan.id);
      const entry = await createPlanHistoryEntry(plan.id, {
        label,
        before: snapshotServiceItems(plan.items),
        after: snapshotServiceItems(current.items),
        affected,
        change_type: changeType,
        restorable: true,
      });
      setServiceHistory((history) => [...history.filter((candidate) => candidate.id !== entry.id), entry]);
    } catch {
      // History is helpful but should not block service edits.
    }
  }

  function nextSundayDateInput() {
    return nextSundayDate();
  }

  function serviceTypeForDate(dateInput: string, selectedTypeId?: string) {
    const selectedType = planTypes.find((type) => type.id === selectedTypeId && type.active);
    if (selectedType) return selectedType;
    const date = new Date(serviceIsoFromDateInput(dateInput));
    const scheduled = serviceSchedules.find((rule) => rule.enabled && rule.weekday === (date.getUTCDay() + 6) % 7);
    const scheduledType = planTypes.find((type) => type.active && type.name === scheduled?.plan_type);
    if (scheduledType) return scheduledType;
    const weekday = date.toLocaleDateString("en", { weekday: "long", timeZone: "UTC" });
    const weekdayType = planTypes.find((type) => type.active && type.name.toLowerCase().includes(weekday.toLowerCase()));
    if (weekdayType) return weekdayType;
    const defaultName = !Number.isNaN(date.getTime()) && date.getUTCDay() === 0
      ? "Sunday Service"
      : "Midweek Meeting";
    return planTypes.find((type) => type.active && type.name === defaultName)
      ?? planTypes.find((type) => type.active && type.name.toLowerCase().includes(defaultName.split(" ")[0].toLowerCase()))
      ?? planTypes.find((type) => type.active && type.name !== "Worship Set")
      ?? null;
  }

  function suggestedServiceTitle(dateInput: string, selectedTypeId?: string) {
    const type = serviceTypeForDate(dateInput, selectedTypeId);
    return `${type?.name ?? "Service"} ${serviceLongDateForInput(dateInput)}`;
  }

  async function openServiceDate(dateInput: string) {
    const targetType = serviceTypeForDate(dateInput);
    const servicesOnDate = servicePlans.filter(
      (candidate) => dateInputFromIso(candidate.service_date) === dateInput,
    );
    const existing = servicesOnDate.find((candidate) => candidate.plan_type === targetType?.name)
      ?? servicesOnDate[0];
    if (existing) {
      setServicePickerOpen(false);
      await selectPlan(existing.id);
      return;
    }
    setServicePickerOpen(false);
    setEmptyServiceDate(dateInput);
    selectedPlanIdRef.current = "";
    setPlan(null);
    sessionStorage.removeItem(SELECTED_SERVICE_SESSION_KEY);
    if (!canCreatePlan || !targetType) return;
    try {
      const created = await createPlan({
        plan_type_id: targetType.id,
        service_date: serviceIsoFromDateInput(dateInput),
        title: suggestedServiceTitle(dateInput, targetType.id),
        subtitle: null,
        leader_id: null,
        teacher_id: null,
        status: "draft",
        info: null,
      });
      selectedPlanIdRef.current = created.id;
      setEmptyServiceDate("");
      await load(created.id, { refreshCatalogs: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open this service date.");
    }
  }

  async function createServiceForDate(dateInput: string, selectedTypeId: string) {
    if (!dateInput) {
      setMessage("Choose a date first.");
      return;
    }
    if (!canCreatePlan) {
      setMessage("Only teachers and administrators can create services.");
      return;
    }

    const primaryPlanType = serviceTypeForDate(dateInput, selectedTypeId);
    if (!primaryPlanType) {
      setMessage("No service types are configured yet.");
      return;
    }

    setCreatingService(true);
    try {
      if (pendingServiceMode === "edit" && plan) {
        if (plan.plan_type_id !== primaryPlanType.id) {
          await updatePlan(plan.id, { plan_type_id: primaryPlanType.id });
        }
        await addMissingServiceSections(plan.id);
        await load(plan.id, { refreshCatalogs: true });
        setMessage(`Applied ${primaryPlanType.name}; existing content was preserved and missing outline sections were added.`);
        setPendingServiceDate(null);
        return;
      }
      const existing = servicePlans.find((candidate) => (
        dateInputFromIso(candidate.service_date) === dateInput && candidate.plan_type === primaryPlanType.name
      ));
      if (existing) {
        setPendingServiceDate(null);
        await selectPlan(existing.id);
        return;
      }
      const created = await createPlan({
        plan_type_id: primaryPlanType.id,
        service_date: serviceIsoFromDateInput(dateInput),
        title: suggestedServiceTitle(dateInput, primaryPlanType.id),
        subtitle: null,
        leader_id: null,
        teacher_id: null,
        status: "draft",
        info: null,
      });
      selectedPlanIdRef.current = created.id;
      await load(created.id, { refreshCatalogs: true });
      setServicePickerOpen(false);
      setPendingServiceDate(null);
      setMessage(`${primaryPlanType.name} created with its service outline.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create a new service.");
    } finally {
      setCreatingService(false);
    }
  }

  async function setMediaPersistence(file: PlanItem["files"][number], persistent: boolean) {
    if (!plan || file.id.startsWith("pre-service:")) return;
    setFillerMediaBusy(true);
    try {
      await updateItemFile(file.id, { persistent });
      await load(plan.id, { silent: true });
      setMessage(persistent ? `"${file.display_name}" will be kept for future services.` : `"${file.display_name}" is now for this service only.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update image persistence.");
    } finally {
      setFillerMediaBusy(false);
    }
  }

  async function addFillerMedia(files: FileList | null) {
    if (!files?.length || !plan || !fillerMediaPlanItem) return;
    setFillerMediaBusy(true);
    try {
      const existingImages = fillerMediaPlanItem.files.filter((file) => file.content_type?.startsWith("image/"));
      for (const [index, file] of Array.from(files).entries()) {
        const stored = await uploadStoredFile({ file, display_name: file.name });
        await attachItemFile(fillerMediaPlanItem.id, {
          file_id: stored.id,
          sort_order: existingImages.length + index,
        });
      }
      await load(plan.id, { silent: true });
      setMessage(`${files.length} slide image${files.length === 1 ? "" : "s"} added.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add slide images.");
    } finally {
      setFillerMediaBusy(false);
    }
  }

  async function removeFillerMedia(file: PlanItem["files"][number]) {
    if (!plan || !fillerMediaPlanItem) return;
    const confirmed = await confirm({
      confirmLabel: "Remove image",
      message: file.persistent
        ? `Remove "${file.display_name}" from this and future ${fillerMediaPlanItem.title} slides?`
        : `Remove "${file.display_name}" from the ${fillerMediaPlanItem.title} slide?`,
      title: "Remove slide image",
      tone: "danger",
    });
    if (!confirmed) return;
    setFillerMediaBusy(true);
    try {
      if (file.id.startsWith("pre-service:")) {
        await deletePreServiceMedia(file.file_id);
      } else {
        await deleteItemFile(file.id);
      }
      await load(plan.id, { silent: true });
      setMessage("Slide image removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove the slide image.");
    } finally {
      setFillerMediaBusy(false);
    }
  }

  async function setMontageRandom(item: PlanItem, random: boolean) {
    try {
      await updatePlanItem(item.id, { montage_random: random });
      await load(item.plan_id, { silent: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update montage order.");
    }
  }

  async function savePlanItemDetails() {
    if (!fillerMediaPlanItem) return;
    const title = itemEditDraft.title.trim() || itemEditDraft.overlay_text.trim();
    if (!title) {
      setMessage("Item name is required.");
      return;
    }
    setFillerMediaBusy(true);
    try {
      const details = {
        ...(title !== fillerMediaPlanItem.title ? { title } : {}),
        ...(fillerMediaPlanItem.item_type === "announcements" ? { comment: itemEditDraft.comment.trim() || null } : {}),
        ...(fillerMediaPlanItem.parent_item_id ? { planned_start: fillerMediaPlanItem.planned_start ?? null } : {}),
        save_template: saveItemTemplate,
        presentation_options: {
          ...fillerMediaPlanItem.presentation_options,
          backing_audio_id: itemEditDraft.backing_audio_id,
          stop_backing_audio: itemEditDraft.stop_backing_audio,
          scheduled_start: fillerMediaPlanItem.parent_item_id ? fillerMediaPlanItem.planned_start ?? "" : undefined,
          dwell_seconds: Number(itemEditDraft.dwell_seconds) || 8,
          auto_advance_seconds: Number(itemEditDraft.auto_advance_seconds) || 8,
          transition: itemEditDraft.transition,
          fit_mode: itemEditDraft.fit_mode,
          overlay_text: itemEditDraft.overlay_text.trim(),
          overlay_mode: itemEditDraft.overlay_mode,
          overlay_countdown_seconds: Number(itemEditDraft.overlay_countdown_seconds) || 300,
          overlay_position: itemEditDraft.overlay_position,
          overlay_size: itemEditDraft.overlay_size,
          overlay_font: itemEditDraft.overlay_font,
          overlay_panel_opacity: Number(itemEditDraft.overlay_panel_opacity),
          overlay_background_dim: Number(itemEditDraft.overlay_background_dim),
          auto_advance: itemEditDraft.auto_advance,
          repeat: itemEditDraft.repeat,
          announcement_date: itemEditDraft.announcement_date,
          announcement_location: itemEditDraft.announcement_location.trim(),
          announcement_contact: itemEditDraft.announcement_contact.trim(),
          announcement_url: itemEditDraft.announcement_url.trim(),
          announcement_layout: itemEditDraft.announcement_layout,
          audio_scene_id: itemEditDraft.audio_scene_id || undefined,
          display_targets: itemEditDraft.display_targets,
          end_after_section: fillerMediaSectionItem?.id === fillerMediaPlanItem.id ? itemEditDraft.end_after_section : undefined,
        },
      };
      if (fillerMediaSectionItem?.id === fillerMediaPlanItem.id) {
        if (plan) await updatePlan(plan.id, { queued_start: itemEditDraft.planned_start || null });
        if (canAccessAdminTools && currentPlanType && fillerMediaPlanItem.id === effectivePlanItems.find((item) => !item.parent_item_id)?.id) {
          await updatePlanType(currentPlanType.id, { automation_start: itemEditDraft.planned_start || null, starts_at: itemEditDraft.planned_start || null });
        }
        await updatePlanItem(fillerMediaPlanItem.id, { ...details, auto_collapse_items: itemEditDraft.auto_collapse_items });
      } else {
        await Promise.all([
          updatePlanItem(fillerMediaPlanItem.id, details),
          ...(fillerMediaSectionItem ? [updatePlanItem(fillerMediaSectionItem.id, { auto_collapse_items: itemEditDraft.auto_collapse_items })] : []),
        ]);
      }
      if (itemEditDraft.auto_collapse_items && fillerMediaSectionItem) {
        setExpandedSorterSectionIds((current) => {
          const next = new Set(current);
          next.delete(fillerMediaSectionItem.id);
          return next;
        });
      }
      await load(fillerMediaPlanItem.plan_id, { silent: true, refreshCatalogs: true });
      closePlanItemEditor();
      setMessage(`Updated ${title}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the item.");
    } finally {
      setFillerMediaBusy(false);
    }
  }

  async function archiveCurrentPlan() {
    if (!plan) {
      return;
    }
    if (!canDeletePlan) {
      setMessage("Only administrators can archive services.");
      return;
    }

    const confirmed = await confirm({
      confirmLabel: "Archive",
      message: `Archive service "${plan.title}"?`,
      title: "Archive Service",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    try {
      const archived = { id: plan.id, title: plan.title, serviceDate: dateInputFromIso(plan.service_date) };
      const archivedPlanTypeId = plan.plan_type_id;
      await deletePlan(plan.id);
      const replacement = await createPlan({
        plan_type_id: archivedPlanTypeId,
        service_date: serviceIsoFromDateInput(archived.serviceDate),
        title: suggestedServiceTitle(archived.serviceDate, archivedPlanTypeId),
        subtitle: null,
        leader_id: null,
        teacher_id: null,
        status: "draft",
        info: null,
      });
      setArchivedServiceUndo({ ...archived, replacementId: replacement.id });
      setArchivedServiceToastVisible(true);
      setEmptyServiceDate(archived.serviceDate);
      selectedPlanIdRef.current = "";
      sessionStorage.removeItem(SELECTED_SERVICE_SESSION_KEY);
      await load(replacement.id, { refreshCatalogs: true });
      setServicePickerOpen(false);
      setServiceHistoryOpen(false);
      setMessage("Service archived.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not archive this service.");
    }
  }

  async function undoArchivedService() {
    if (!archivedServiceUndo) return;
    try {
      await deletePlan(archivedServiceUndo.replacementId);
      const restored = await restorePlan(archivedServiceUndo.id);
      setArchivedServiceUndo(null);
      setArchivedServiceToastVisible(false);
      setEmptyServiceDate("");
      await load(restored.id, { refreshCatalogs: true });
      setMessage("Service restored.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not restore the archived service.");
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

  function sequenceForSearchInsert(afterIndex: number) {
    if (!searchParentItemId) return sequenceForInsert(afterIndex);
    const siblings = (plan?.items ?? [])
      .filter((item) => item.parent_item_id === searchParentItemId)
      .sort((left, right) => Number(left.sequence) - Number(right.sequence));
    return sequenceForInsertInItems(siblings, searchParentInsertIndex ?? siblings.length - 1);
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
      setMessage("Worship Sets are temporarily unavailable. Ask an administrator to update and restart the app.");
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
      if (currentPlanType?.default_outline.length) {
        const outlined = await addMissingServiceSections(plan.id);
        setPlan(outlined);
      }
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
    if (searchParentItemId && searchParentInsertIndex !== null) {
      return sequenceForInsertInItems(orderedItems, searchParentInsertIndex);
    }
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

  async function reloadPreservingOperatorScroll(options?: { refreshCatalogs?: boolean; silent?: boolean }) {
    const scrollPosition = captureOperatorScrollPositions();
    suppressNextOperatorScrollRef.current = true;
    // The selected plan may have just been archived on another device. Always
    // refresh the catalog so load() can resolve the replacement/next service;
    // requiring the old detail here leaves this device stuck after a 404.
    await load(selectedPlanIdRef.current || undefined, {
      refreshCatalogs: options?.refreshCatalogs,
      silent: options?.silent,
    });
    restoreOperatorScrollPositions(scrollPosition);
  }

  useDurableChange(() => {
    void reloadPreservingOperatorScroll({ refreshCatalogs: true, silent: true });
  }, active, ["planning", "music"]);

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
    options?: { deckTargetPlanItemId?: string; parentInsertIndex?: number; parentItemId?: string; selectInserted?: boolean },
  ) {
    if (!canEditPlan) {
      setMessage("You can present this plan, but only worship team members, worship leaders, and service leaders can change the running order.");
      return;
    }
    setSearchInsertIndex(afterIndex);
    setDeckTargetPlanItemId(options?.deckTargetPlanItemId ?? null);
    setSearchParentItemId(options?.parentItemId ?? null);
    setSearchParentInsertIndex(options?.parentInsertIndex ?? null);
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
    setYoutubeResults([]);
    setYoutubeNextPageToken(null);
    setYoutubeLoading(false);
    setYoutubeLoadingMore(false);
    setYoutubeError("");
    setSearchQuery("");
    setSearchInsertIndex(null);
    setDeckTargetPlanItemId(null);
    setSearchParentItemId(null);
    setSearchParentInsertIndex(null);
    setSearchSelectInserted(false);
    setDeckFlattenBuilds(false);
    setImportingDriveFileId(null);
    setVideoFile(null);
    setImageFiles([]);
  }

  async function addImageItem() {
    if (!plan || !searchParentItemId || !imageFiles.length || !canAttachDeck) return;
    try {
      const title = imageFiles.length === 1
        ? imageFiles[0].name.replace(/\.[^.]+$/, "")
        : `${imageFiles[0].name.replace(/\.[^.]+$/, "")} + ${imageFiles.length - 1}`;
      const item = await createPlanItem(plan.id, {
        parent_item_id: searchParentItemId,
        item_type: sectionPlanItem(searchParentItemId)?.item_type ?? "announcements",
        sequence: sequenceForSearchInsert(searchInsertIndex ?? activeSectionInsertIndex()),
        title,
        comment: null,
        key_signature: null,
        song_id: null,
      });
      for (const [index, file] of imageFiles.entries()) {
        const stored = await uploadStoredFile({ file, display_name: file.name });
        await attachItemFile(item.id, { file_id: stored.id, sort_order: index });
      }
      await reloadAfterInsertedItem(item);
      closeSearchOverlay();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add images.");
    }
  }

  const sectionTemplates = [...planTypes].sort((a, b) => Number(b.id === plan?.plan_type_id) - Number(a.id === plan?.plan_type_id))
    .flatMap((type) => type.default_outline.filter((item) => !item.parent_id).map((item) => ({ type, item, key: `${type.id}:${item.id}` })));

  async function saveCurrentOutline() {
    if (!plan || creatingService) return;
    setCreatingService(true);
    try {
      const saved = await saveServiceOutline(plan.id);
      setPlanTypes((current) => current.map((type) => type.id === saved.id ? saved : type));
      setMessage(`Saved the current outline and settings to “${saved.name}” for future services.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the outline.");
    } finally { setCreatingService(false); }
  }

  async function createAndUseTemplate() {
    if (!newTemplateName.trim() || !pendingServiceDate || creatingService) return;
    setCreatingService(true);
    try {
      const created = await createPlanType({ name: newTemplateName.trim(), description: null, starts_at: null, automation_start: null, default_duration_minutes: null, active: true, default_outline: [] });
      setPlanTypes((current) => [...current, created]);
      setPendingServiceTypeId(created.id);
      setNewTemplateName("");
      setMessage(`Template “${created.name}” created. Apply it, then add sections to populate it.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create template.");
    } finally { setCreatingService(false); }
  }

  async function addOutlineGroup() {
    if (!plan || groupInsertIndex === null || !groupTitleDraft.trim() || addingSection) return;
    setAddingSection(true);
    try {
      const source = sectionTemplates.find((entry) => entry.key === sectionTemplateKey);
      const created = await insertSectionTemplate(plan.id, {
        template_id: source?.item.id ?? null, title: groupTitleDraft.trim(),
        sequence: sequenceForInsert(groupInsertIndex), save_template: saveSectionTemplate,
      });
      setGroupInsertIndex(null); setGroupTitleDraft(""); setSectionTemplateKey("");
      setPlanTypes(await getPlanTypes());
      await reloadAfterInsertedItem(created);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add section group.");
      if (plan) await load(plan.id, { silent: true });
    } finally { setAddingSection(false); }
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
      parent_item_id: searchParentItemId,
      item_type: "reading",
      sequence: sequenceForSearchInsert(afterIndex),
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
    if (bibleSearchInsertInFlightRef.current) {
      return;
    }
    bibleSearchInsertInFlightRef.current = true;
    try {
      const createdItem = await insertBibleResult(result, searchInsertIndex ?? activeSectionInsertIndex());
      await reloadAfterInsertedItem(createdItem);
      closeSearchOverlay();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add Scripture.");
    } finally {
      bibleSearchInsertInFlightRef.current = false;
    }
  }

  async function addVideoSearchResult(youtubeResult?: YouTubeVideo) {
    if (!plan) {
      setMessage("Select a plan before adding a video.");
      return;
    }
    if (!canEditPlan) {
      setMessage("Only worship team members, worship leaders, and service leaders can add videos to the running order.");
      return;
    }

    const query = searchQuery.trim();
    const videoId = youtubeResult?.id ?? extractYouTubeId(query);
    if (!videoId && !videoFile) {
      setMessage("Paste a valid YouTube link or choose a local video file.");
      return;
    }

    try {
      if (videoFile && !canAttachDeck) {
        setMessage("Uploading a local video requires library upload access.");
        return;
      }

      const resolvedTitle = youtubeResult?.title || videoFile?.name.replace(/\.[^.]+$/, "") || "YouTube Video";
      const createdItem = await createPlanItem(plan.id, {
        parent_item_id: searchParentItemId,
        item_type: "video",
        sequence: sequenceForSearchInsert(searchInsertIndex ?? activeSectionInsertIndex()),
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
    if (
      searchSelectionInFlightRef.current ||
      googleDriveLoading ||
      customProviderLoading ||
      customProviderSelectionLoading
    ) {
      return;
    }
    searchSelectionInFlightRef.current = true;
    try {
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
        const firstFile = googleDriveFiles[0];
        if (firstFile) {
          await attachImportedDriveDeck(firstFile);
        }
        return;
      }
      if (searchMode === "video") {
        if (!videoFile && !extractYouTubeId(searchQuery) && youtubeResults[0]) {
          await addVideoSearchResult(youtubeResults[0]);
          return;
        }
        if (!videoFile && !extractYouTubeId(searchQuery) && googleDriveFiles[0]) {
          await attachImportedDriveVideo(googleDriveFiles[0]);
          return;
        }
        await addVideoSearchResult();
      }
    } finally {
      searchSelectionInFlightRef.current = false;
    }
  }

  function suppressSearchEnterKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleSearchEnterKeyUp(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.defaultPrevented) {
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
    const versionCode = currentPlanItem.key_signature || bibleVersion || "ASV";
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

  async function attachImportedDriveDeck(file: GoogleDriveFile) {
    if (!plan) {
      setMessage("Select a plan before attaching a deck.");
      return;
    }
    if (!canEditPlan || !canAttachDeck) {
      setMessage("Adding slide decks requires plan editing and library upload access.");
      return;
    }
    if (importingDriveFileId) {
      return;
    }

    try {
      setImportingDriveFileId(file.id);
      const resolvedDeckTitle = file.name.replace(/\.[^.]+$/, "") || "Sermon";
      const explicitTarget = deckTargetPlanItemId
        ? plan.items.find((item) => item.id === deckTargetPlanItemId)
        : null;
      const sermonPlaceholder = plan.items.find(
        (item) => item.item_type === "sermon" && item.title.trim().toLowerCase() === "sermon",
      );
      const targetItem = explicitTarget ?? sermonPlaceholder ?? null;
      const attachToPlaceholder = false;
      if (
        targetItem?.files?.some(
          (attached) =>
            attached.display_name.trim().toLowerCase() === file.name.trim().toLowerCase() ||
            attached.display_name.trim().toLowerCase() === resolvedDeckTitle.toLowerCase(),
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
      if (attachToPlaceholder && targetItem) {
        await attachItemFile(targetItem.id, {
          file_id: imported.file.id,
          sort_order: targetItem.files?.length ?? 0,
        });
        void recordServiceHistory(
          `attaching ${targetItem.item_type} deck "${resolvedDeckTitle}"`,
          targetItem.title,
          "slide_deck",
        );
        await load(plan.id, {
          preserveLocation: { planItemId: targetItem.id, slideOffset: 0 },
          silent: true,
        });
        closeSearchOverlay();
        return;
      }
      const item = await createPlanItem(plan.id, {
        parent_item_id: targetItem?.id ?? searchParentItemId,
        item_type: "sermon",
        sequence: sequenceForSearchInsert(searchInsertIndex ?? sections.length - 1),
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
    } finally {
      setImportingDriveFileId(null);
    }
  }

  async function attachImportedDriveVideo(file: GoogleDriveFile) {
    if (!plan) {
      setMessage("Select a plan before attaching a video.");
      return;
    }
    if (!canEditPlan || !canAttachDeck) {
      setMessage("Adding Google Drive videos requires plan editing and library upload access.");
      return;
    }
    if (importingDriveFileId) {
      return;
    }

    try {
      setImportingDriveFileId(file.id);
      const resolvedTitle = file.name.replace(/\.[^.]+$/, "") || "Video";
      if (
        plan.items.some(
          (item) =>
            item.item_type === "video" &&
            (item.title.trim().toLowerCase() === resolvedTitle.toLowerCase() ||
              item.comment?.trim().toLowerCase() === `imported from google drive: ${file.name}`.toLowerCase()),
        )
      ) {
        setMessage(`"${resolvedTitle}" is already in this service.`);
        return;
      }
      const imported = await importGoogleDriveDeck({
        file_id: file.id,
        display_name: resolvedTitle,
        flatten_builds: false,
      });
      const item = await createPlanItem(plan.id, {
        parent_item_id: searchParentItemId,
        item_type: "video",
        sequence: sequenceForSearchInsert(searchInsertIndex ?? activeSectionInsertIndex()),
        title: resolvedTitle,
        comment: `Imported from Google Drive: ${file.name}`,
        key_signature: "video-file",
        song_id: null,
      });
      await attachItemFile(item.id, { file_id: imported.file.id, sort_order: 0 });
      void recordServiceHistory(`importing "${resolvedTitle}"`, "Service", "video");
      setUndoAction({
        label: `importing "${resolvedTitle}"`,
        run: async () => {
          await deletePlanItem(item.id);
          await load(plan.id);
        },
      });
      await reloadAfterInsertedItem(item);
      closeSearchOverlay();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import this Google Drive video.");
    } finally {
      setImportingDriveFileId(null);
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

  async function removeSermonDeck(item: PlanItem) {
    const deckFiles = item.files.filter(
      (file) => !file.content_type?.startsWith("image/") && !file.content_type?.startsWith("video/"),
    );
    if (!deckFiles.length || !canEditPlan) return;
    const confirmed = await confirm({
      title: "Remove sermon deck",
      message: `Remove the deck from “${item.title}”? The Sermon outline slide will remain.`,
      confirmLabel: "Remove deck",
    });
    if (!confirmed) return;
    try {
      await Promise.all(deckFiles.map((file) => deleteItemFile(file.id)));
      await load(plan!.id, { preserveLocation: { planItemId: item.id, slideOffset: 0 }, silent: true });
      setMessage("Sermon deck removed; the Sermon outline slide remains.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove sermon deck.");
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

    const movingItem = sectionPlanItem(sectionId);
    let orderedItems = owner === "worship" ? orderedWorshipSetItems() : orderedPlanItems();
    if (movingItem?.parent_item_id) {
      orderedItems = orderedItems.filter((candidate) => candidate.parent_item_id === movingItem.parent_item_id);
    } else {
      orderedItems = orderedItems.filter((candidate) => !candidate.parent_item_id);
    }
    if (!movingItem?.parent_item_id && owner === "service" && worshipSetPlan?.items.some((item) => item.item_type === "song" && item.song_id)) {
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
          return versions.find((version) => version.code === "ASV")?.code || versions.find((version) => version.code === "KJV")?.code || versions[0]?.code || "";
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
    const files = (plan?.items ?? []).flatMap((item) =>
      item.item_type === "video"
        ? []
        : (item.files ?? []).filter(
            (file) => !file.content_type?.startsWith("video/") && !file.content_type?.startsWith("image/"),
          ),
    );
    const activeFileIds = new Set(
      currentPlanItem?.item_type === "video"
        ? []
        : (currentPlanItem?.files ?? [])
            .filter(
              (file) => !file.content_type?.startsWith("video/") && !file.content_type?.startsWith("image/"),
            )
            .map((file) => file.file_id),
    );
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
      const isMobileDeckSearch = searchMode === "deck" && window.matchMedia("(max-width: 700px)").matches;
      if (!isMobileDeckSearch) {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchMode, searchOverlayOpen]);

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
          if (selectedPlanIdRef.current !== selectedPlanId) return;
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
            serviceStage: remoteState.service_stage ?? "ready",
            preServicePhase: remoteState.pre_service_phase ?? null,
            autoStarted: Boolean(remoteState.auto_started),
          });
          setPresentationSessionActive(remoteState.status === "live");
          setPresentationAutoStarted(Boolean(remoteState.auto_started));
          if (remoteState.plan_item_id && remoteState.plan_item_id === previousPlanItemId) {
            if (selectedPlanIdRef.current !== selectedPlanId) return;
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
    }, REMOTE_LIVE_STATE_POLL_INTERVAL_MS);

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
    let inFlight = false;
    const refreshOutputStatus = async () => {
      if (inFlight) return;
      if (!selectedPlanId) {
        setSlideshowOpen(false);
        return;
      }
      inFlight = true;
      const status = await getPresentationOutputStatus(selectedPlanId).catch(() => null);
      if (status) {
        setSlideshowOpen(status.active);
        if (status.active) {
          outputOwnerIdRef.current = status.owner_id;
        } else {
          closeLocalSlideshowWindow();
          outputOwnerIdRef.current = null;
        }
      }
      inFlight = false;
    };
    void refreshOutputStatus();
    const timer = window.setInterval(() => {
      void refreshOutputStatus();
      if (outputWindowRef.current && outputWindowRef.current.closed) {
        outputWindowRef.current = null;
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
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
    const shouldFollowSorter = sorterFollowingRef.current;
    const shouldFollowRail = railFollowingRef.current;
    const timer = window.setTimeout(() => {
      if (catchUpCheckTokenRef.current !== token) {
        return;
      }
      const activeSlide = slides[liveIndex];
      if (activeSlide) {
        if (shouldFollowSorter) {
          sorterProgrammaticScrollUntilRef.current = Date.now() + 900;
          scrollItemIntoOperatorView(
            slideGridRef.current,
            sorterTargetForSlide(activeSlide),
          );
          sorterCatchUpDirectionRef.current = null;
          setSorterCatchUpDirection(null);
        }
        if (shouldFollowRail) {
          railProgrammaticScrollUntilRef.current = Date.now() + 900;
          scrollItemIntoOperatorView(sectionRailListRef.current, railTargetForSlide(activeSlide));
          railCatchUpDirectionRef.current = null;
          setRailCatchUpDirection(null);
        }
      }
      window.setTimeout(() => {
        if (catchUpCheckTokenRef.current === token) {
          updateCatchUpDirectionsForSlide(liveIndex);
        }
      }, 480);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [liveIndex, slides]);

  useEffect(() => {
    const token = catchUpCheckTokenRef.current;
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
      sorterProgrammaticScrollUntilRef.current = Date.now() + 900;
      railProgrammaticScrollUntilRef.current = Date.now() + 900;
      scrollItemIntoOperatorView(
        slideGridRef.current,
        sorterTargetForSlide(activeSlide),
      );
      scrollItemIntoOperatorView(sectionRailListRef.current, railTargetForSlide(activeSlide));
    });
  }, [liveIndex, sections, slides]);

  useEffect(() => {
    if (!active) return undefined;
    if (!searchOverlayOpen && !servicePickerOpen && !editingSongId) {
      keyCaptureRef.current?.focus({ preventScroll: true });
    }
    return undefined;
  }, [active, editingSongId, plan?.id, searchOverlayOpen, servicePickerOpen]);

  useEffect(() => {
    if (!slideshowStartMenuOpen) {
      return;
    }

    function closeSlideshowStartMenu(event: PointerEvent) {
      if (!slideshowStartControlRef.current?.contains(event.target as Node)) {
        setSlideshowStartMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", closeSlideshowStartMenu);
    return () => window.removeEventListener("pointerdown", closeSlideshowStartMenu);
  }, [slideshowStartMenuOpen]);

  useEffect(() => {
    if (!active) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.type !== "keydown") {
        return;
      }
      if (event.repeat) {
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
      if (event.key === "Escape" && servicePickerOpen) {
        event.preventDefault();
        setServicePickerOpen(false);
        return;
      }
      if (event.key === "Escape" && slideshowStartMenuOpen) {
        event.preventDefault();
        setSlideshowStartMenuOpen(false);
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
        setSlideshowStartMenuOpen(false);
        void startSlideshow(openSlideshowWindowOnStart);
        return;
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        clearHotkeyButtonFocus();
        void toggleOutputFullscreen();
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
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [
    active,
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
    slideshowOpen,
    googleDriveLoading,
    customProviderLoading,
    customProviderSelectionLoading,
    songSearchResults,
    bibleSearchResults,
    googleDriveFiles,
    selectedScreenIndex,
    servicePickerOpen,
    slideshowStartMenuOpen,
    openSlideshowWindowOnStart,
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
    const requestId = ++bibleSearchRequestIdRef.current;
    try {
      const referenceQuery = normalizeBibleReferenceSearchQuery(query, bibleBooks);
      const [referenceMatches, keywordMatches] = await Promise.all([
        searchBible({
          q: referenceQuery,
          version_code: bibleVersion || "ASV",
          search_type: "reference",
          limit: 8,
        }).catch(() => []),
        searchBible({
          q: query,
          version_code: bibleVersion || "ASV",
          search_type: "keyword",
          limit: 50,
          offset: 0,
        }).catch(() => []),
      ]);

      const merged = [...referenceMatches, ...keywordMatches].filter((result, index, all) => {
        const key = `${result.version}:${result.reference}:${result.verse_from}:${result.verse_to}`;
        return all.findIndex((candidate) => (
          `${candidate.version}:${candidate.reference}:${candidate.verse_from}:${candidate.verse_to}` === key
        )) === index;
      });

      if (requestId !== bibleSearchRequestIdRef.current) return [];
      setBibleSearchResults(merged);
      bibleSearchKeywordOffsetRef.current = keywordMatches.length;
      setBibleSearchHasMore(keywordMatches.length === 50);
      setMessage(null);
      return merged;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not search Bible.");
      if (requestId === bibleSearchRequestIdRef.current) setBibleSearchResults([]);
      return [];
    } finally {
      if (requestId === bibleSearchRequestIdRef.current) setSearchLoading(false);
    }
  }

  async function loadMoreBibleSearchResults() {
    if (bibleSearchLoadingMore || !bibleSearchHasMore || searchMode !== "bible") return;
    const query = searchQuery.trim();
    if (!query) return;
    const requestId = bibleSearchRequestIdRef.current;
    setBibleSearchLoadingMore(true);
    try {
      const nextResults = await searchBible({
        q: query,
        version_code: bibleVersion || "ASV",
        search_type: "keyword",
        limit: 50,
        offset: bibleSearchKeywordOffsetRef.current,
      });
      if (requestId !== bibleSearchRequestIdRef.current) return;
      setBibleSearchResults((current) => [...current, ...nextResults].filter((result, index, all) => {
        const key = `${result.version}:${result.reference}:${result.verse_from}:${result.verse_to}`;
        return all.findIndex((candidate) => `${candidate.version}:${candidate.reference}:${candidate.verse_from}:${candidate.verse_to}` === key) === index;
      }));
      bibleSearchKeywordOffsetRef.current += nextResults.length;
      setBibleSearchHasMore(nextResults.length === 50);
    } finally {
      setBibleSearchLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!searchOverlayOpen || searchMode !== "bible") {
      return;
    }

    const query = searchQuery.trim();
    bibleSearchRequestIdRef.current += 1;
    setBibleSearchHasMore(false);
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
    const target = bibleSearchLoadMoreRef.current;
    if (!target || !bibleSearchHasMore || bibleSearchLoadingMore) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void loadMoreBibleSearchResults();
    }, { rootMargin: "160px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [bibleSearchHasMore, bibleSearchLoadingMore, bibleSearchResults.length, searchMode, searchQuery]);

  useEffect(() => {
    if (!searchOverlayOpen || (searchMode !== "deck" && searchMode !== "video")) {
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
    if (!searchOverlayOpen || (searchMode !== "deck" && searchMode !== "video") || !googleDriveStatus?.connected) {
      return;
    }

    if (searchMode === "video" && extractYouTubeId(searchQuery)) {
      setGoogleDriveFiles([]);
      setGoogleDriveLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setGoogleDriveLoading(true);
      setGoogleDriveError("");
      void searchGoogleDriveFiles(searchQuery.trim(), undefined, searchMode === "video" ? "video" : "deck")
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

  async function loadMoreYoutubeResults() {
    if (youtubeLoadingMore || !youtubeNextPageToken || searchMode !== "video") return;
    const query = searchQuery.trim();
    if (!query || extractYouTubeId(query)) return;
    const requestId = youtubeSearchRequestIdRef.current;
    setYoutubeLoadingMore(true);
    try {
      const result = await searchYouTubeVideos(query, youtubeNextPageToken);
      if (requestId !== youtubeSearchRequestIdRef.current) return;
      setYoutubeResults((current) => [...current, ...result.items].filter((video, index, all) =>
        all.findIndex((candidate) => candidate.id === video.id) === index,
      ));
      setYoutubeNextPageToken(result.next_page_token);
    } catch (error) {
      if (requestId === youtubeSearchRequestIdRef.current) {
        setYoutubeError(error instanceof Error ? error.message : "Could not search YouTube.");
        setYoutubeNextPageToken(null);
      }
    } finally {
      setYoutubeLoadingMore(false);
    }
  }

  useEffect(() => {
    youtubeSearchRequestIdRef.current += 1;
    const requestId = youtubeSearchRequestIdRef.current;
    setYoutubeResults([]);
    setYoutubeNextPageToken(null);
    setYoutubeError("");
    if (
      !searchOverlayOpen ||
      searchMode !== "video" ||
      !googleDriveStatus?.connected ||
      !searchQuery.trim() ||
      extractYouTubeId(searchQuery)
    ) {
      setYoutubeLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setYoutubeLoading(true);
      void searchYouTubeVideos(searchQuery.trim())
        .then((result) => {
          if (requestId !== youtubeSearchRequestIdRef.current) return;
          setYoutubeResults(result.items);
          setYoutubeNextPageToken(result.next_page_token);
        })
        .catch((error: unknown) => {
          if (requestId !== youtubeSearchRequestIdRef.current) return;
          setYoutubeError(error instanceof Error ? error.message : "Could not search YouTube.");
        })
        .finally(() => {
          if (requestId === youtubeSearchRequestIdRef.current) setYoutubeLoading(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [googleDriveStatus?.connected, searchMode, searchOverlayOpen, searchQuery]);

  useEffect(() => {
    const target = youtubeLoadMoreRef.current;
    if (!target || !youtubeNextPageToken || youtubeLoadingMore) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void loadMoreYoutubeResults();
    }, { rootMargin: "160px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [youtubeLoadingMore, youtubeNextPageToken, youtubeResults.length]);

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
      {confirmationDialog}
      {archivedServiceUndo && archivedServiceToastVisible ? (
        <div className="archive-undo-banner" role="status">
          <span>Archived “{archivedServiceUndo.title}”</span>
          <button className="text-button" onClick={() => void undoArchivedService()} type="button">Undo</button>
        </div>
      ) : null}
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
      {active && topbarSlot
        ? createPortal(
            <div className="presentation-topbar-tools">
              <DateNavigator
                historyContent={serviceHistoryContent()}
                historyDisabled={(!plan && !archivedServiceUndo) || serviceHistoryLoading}
                historyExpanded={serviceHistoryOpen}
                historyLabel="Service edit history"
                label={plan ? formatNavigatorDate(plan.service_date) : emptyServiceDate ? formatNavigatorDate(serviceIsoFromDateInput(emptyServiceDate)) : "Choose service"}
                nextDisabled={loading || !nextPlannedService}
                nextLabel="Next service"
                onHistory={() => void openServiceHistory()}
                onNext={() => void stepService("next")}
                onOpenPicker={openServicePicker}
                onPrevious={() => void stepService("previous")}
                pickerLabel="Choose service"
                pickerDisabled={loading}
                previousDisabled={loading || !previousPlannedService}
                previousLabel="Previous service"
              />
            </div>,
            topbarSlot,
          )
        : null}
      <CalendarPopup
        isOpen={servicePickerOpen}
        onClose={() => setServicePickerOpen(false)}
        title="Services"
        eyebrow="Calendar"
        allDays={allCalendarDates.map(serviceCalendarDay)}
        sundayDays={sundayCalendarDates.map(serviceCalendarDay)}
        selectedDate={serviceDraftDate}
        resolveDay={serviceCalendarDay}
        onDateSelect={(dateInput) => void openServiceDate(dateInput)}
        dayContent={(day) => {
          const date = new Date(`${day.date}T12:00:00`);
          return <span>{date.getDate()}</span>;
        }}
      />
      {pendingServiceDate ? (
        <div className="app-dialog-backdrop confirmation-dialog-backdrop" onMouseDown={() => { if (!creatingService) setPendingServiceDate(null); }} role="presentation">
          <section aria-labelledby="create-service-title" aria-modal="true" className="app-dialog create-service-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <div>
              <p className="dialog-eyebrow">{pendingServiceMode === "edit" ? "Service setup" : "New service"}</p>
              <h2 id="create-service-title">{pendingServiceMode === "edit" ? "Service outline ·" : "Prepare"} {formatNavigatorDate(pendingServiceDate)}</h2>
              <p>Choose a template or create one. Applying adds missing sections and keeps existing content.</p>
            </div>
            <label>
              Service template
              <select disabled={creatingService} onChange={(event) => setPendingServiceTypeId(event.target.value)} value={pendingServiceTypeId}>
                {planTypes.filter((type) => type.active && type.name !== "Worship Set").map((type) => (
                  <option key={type.id} value={type.id}>{type.name}</option>
                ))}
              </select>
            </label>
            {pendingServiceMode === "edit" && pendingServiceTypeId === plan?.plan_type_id ? <details className="item-editor-disclosure"><summary>Update this template</summary>
              <p>Replace its outline with this service’s section order and configuration. Songs, uploads and dated announcement content stay with this service.</p>
              <button className="text-button" disabled={creatingService} onClick={() => void saveCurrentOutline()} type="button">Save current outline to template</button>
            </details> : null}
            <details className="item-editor-disclosure"><summary>Create a service template</summary>
              <label>Name<input maxLength={120} value={newTemplateName} onChange={(event) => setNewTemplateName(event.target.value)} placeholder="e.g. Wednesday prayer" /></label>
              <button className="text-button" disabled={creatingService || !newTemplateName.trim()} onClick={() => void createAndUseTemplate()} type="button">Create and select</button>
            </details>
            <div className="create-service-outline-preview">
              <strong>{pendingServiceType?.name ?? "Service"} outline</strong>
              {pendingServiceType?.default_outline.length ? (
                <span>{pendingServiceType.default_outline.map((item) => item.title).join(" · ")}</span>
              ) : (
                <span>{pendingServiceType?.name === "Sunday Service" ? "Welcome · Worship · Open time · Sermon · Announcements" : "No automatic sections configured"}</span>
              )}

            </div>
            <div className="app-dialog-actions">
              <button className="text-button" disabled={creatingService} onClick={() => setPendingServiceDate(null)} type="button">Cancel</button>
              <button className="primary-button" disabled={creatingService || !pendingServiceType} onClick={() => void createServiceForDate(pendingServiceDate, pendingServiceTypeId)} type="button">
                {creatingService ? "Saving…" : pendingServiceMode === "edit" ? "Use template" : "Prepare service"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {!canEditPlan ? (
        <p className="empty-state presentation-readonly-note">
          {completedPlanLocked
            ? "This service has finished. Its historical plan can only be changed by an administrator."
            : "Presenter mode is live, but this account is read-only for plan changes."}
        </p>
      ) : null}
      {localAudioUrl ? (
        <iframe
          allow="autoplay; encrypted-media"
          aria-hidden="true"
          className="youtube-audio-frame"
          onLoad={() => {
            localAudioFrameRef.current?.contentWindow?.postMessage(
              JSON.stringify({ event: "command", func: "playVideo", args: [] }),
              "*",
            );
          }}
          ref={localAudioFrameRef}
          src={localAudioUrl}
          tabIndex={-1}
          title="Local YouTube audio"
        />
      ) : null}

      <div className="presenter-console">
        <div className="presenter-stage-column">
          <div
            className={`stage-shell stage-shell-live presenter-current stage-theme-${slideTheme} ${
              liveSlide ? presentationTypeClass(liveSlide.itemType) : "type-generic"
            }`}
          >
            <div className="stage-meta">
              {stageContextTitle ? (
                <span className="stage-context-label">
                  <span className="stage-context-title">{stageContextTitle}</span>
                  {stageContextCounter ? <span className="stage-context-count">{stageContextCounter}</span> : null}
                </span>
              ) : null}
              <div className="stage-meta-actions">
                <label className="stage-audio-switch stage-toggle-switch" title="Enable YouTube audio buttons">
                  <span className="stage-toggle-label" data-short="A"><Volume2 size={13} aria-hidden="true" />Audio</span>
                  <input
                    aria-label="Enable YouTube audio buttons"
                    checked={audioControlsEnabled}
                    onChange={(event) => setAudioControlsEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  <span className="stage-theme-slider" aria-hidden="true" />
                </label>
                <label className="stage-theme-switch stage-toggle-switch" title="Toggle slide theme">
                  <span className="stage-toggle-label" data-short="D"><Moon size={13} aria-hidden="true" />Dark</span>
                  <input
                    aria-label="Use dark slide theme"
                    checked={slideTheme === "dark"}
                    onChange={(event) => setSlideTheme(event.target.checked ? "dark" : "light")}
                    type="checkbox"
                  />
                  <span className="stage-theme-slider" aria-hidden="true" />
                </label>
                <label className="stage-recording-switch stage-toggle-switch" title="Show sermon recording controls">
                  <span className="stage-toggle-label" data-short="R"><Mic size={13} aria-hidden="true" />Recording</span>
                  <input
                    aria-label="Show sermon recording controls"
                    checked={recordingControlsEnabled}
                    onChange={(event) => setRecordingControlsEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  <span className="stage-theme-slider" aria-hidden="true" />
                </label>
                <label className="stage-blank-switch stage-toggle-switch" title="Blank live output">
                  <span className="stage-toggle-label" data-short="B"><EyeOff size={13} aria-hidden="true" />Blank</span>
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
            <div className={`presentation-stage ${liveSlide?.montageImageUrls || liveSlide?.backgroundImageUrl || liveSlide?.imageUrl || liveSlide?.videoUrl ? "presentation-stage-image" : ""} ${liveBlanked ? "stage-preview-blanked" : ""}`}>
              {liveBlanked ? null : liveSlide?.montageImageUrls || liveSlide?.backgroundImageUrl || liveSlide?.imageUrl || liveSlide?.videoUrl || liveSlide?.itemType === "song" || liveSlide?.itemType === "reading" ? null : (
                <div className="stage-title">
                  <span>{liveSlide?.title ?? "Ready"}</span>
                </div>
              )}
              <div className={`slide-visual-transition transition-${liveSlide?.transition ?? "fade"}`} key={liveBlanked ? "blank" : liveSlide?.id ?? "ready"}>
              {liveBlanked ? (
                <div
                  className="blank-stage lcf-background-surface"
                  aria-label="LCF background preview"
                  style={{ backgroundImage: `url(${LCF_BACKGROUND_URL})` }}
                />
              ) : liveSlide?.montageImageUrls && plan ? (
                <PreServiceSlide backgroundImageUrl={LCF_BACKGROUND_URL} dwellSeconds={liveSlide.dwellSeconds} imageUrls={liveSlide.montageImageUrls} random={liveSlide.montageRandom} serviceDate={plan.service_date} timed={Boolean(liveSlide.preServiceTimed) && presentationSessionActive} phase={liveSlide.preServiceStage ?? currentLiveStateRef.current?.preServicePhase} phaseStartedAt={currentLiveStateRef.current?.updatedAt} schedule={serviceScheduleForPlan(serviceSchedules, plan.service_date, plan.plan_type)} />
              ) : liveSlide?.countdownSeconds ? (
                <CountdownSlide
                  durationSeconds={liveSlide.countdownSeconds}
                  running={presentationSessionActive}
                  startAt={currentLiveStateRef.current?.updatedAt}
                />
              ) : liveSlide?.backgroundImageUrl ? (
                <div
                  className="lcf-background-slide"
                  style={{ backgroundImage: `url(${liveSlide.backgroundImageUrl})` }}
                  aria-label={liveSlide.title}
                />
              ) : liveSlide?.imageUrl ? (
                <ScaledSlideImage alt={liveSlide.title} className="stage-image-frame-preview" fitMode={liveSlide.fitMode} src={liveSlide.imageUrl} />
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
                <SlideTextBlock
                  className={liveSlide?.slideKind === "title" ? "is-title-slide" : undefined}
                  maxFontSize={liveTextFontCap}
                  text={liveSlide?.text ?? "No live slide selected"}
                />
              )}
              {!liveBlanked && liveSlide ? <SlideOverlay running={presentationSessionActive} slide={liveSlide} startAt={currentLiveStateRef.current?.updatedAt} /> : null}
              </div>
            </div>
          </div>

          <div className="presenter-controls" aria-label="Slide controls">
            <div className="action-row presenter-mobile-command-row">
              <div className="slideshow-split-control" ref={slideshowStartControlRef}>
                <button
                  aria-label={slideshowOpen || (presentationSessionActive && !presentationAutoStarted) ? "Stop service" : "Start slideshow"}
                  className={`slideshow-start-button ${slideshowOpen || presentationSessionActive ? "primary-button" : "text-button"}`}
                  disabled={loading || !plan}
                  onClick={() => {
                    setSlideshowStartMenuOpen(false);
                    void (slideshowOpen || (presentationSessionActive && !presentationAutoStarted)
                      ? closeActiveSlideshow()
                      : startServiceFromMenu());
                  }}
                  title={
                    slideshowOpen
                      ? "Stop slideshow on every display"
                      : presentationAutoStarted
                        ? "Take control of the automatically started service"
                      : presentationSessionActive
                        ? "Stop the active service on every display"
                      : openSlideshowWindowOnStart
                        ? "Start slideshow and open it in a new window"
                        : "Start slideshow without opening a new window"
                  }
                  type="button"
                >
                  {slideshowOpen || (presentationSessionActive && !presentationAutoStarted) ? <CircleStop size={16} aria-hidden="true" /> : <MonitorUp size={16} aria-hidden="true" />}
                  <span className="mobile-button-label">{presentationAutoStarted && !slideshowOpen ? "Start service" : slideshowOpen || presentationSessionActive ? "Stop" : "Start"}</span>
                </button>
                <button
                  aria-expanded={slideshowStartMenuOpen}
                  aria-haspopup="menu"
                  aria-label="Choose how the slideshow starts"
                  className={`slideshow-start-menu-button ${slideshowOpen || presentationSessionActive ? "primary-button" : "text-button"}`}
                  disabled={loading || !plan}
                  onClick={() => setSlideshowStartMenuOpen((open) => !open)}
                  title="Choose how the slideshow starts"
                  type="button"
                >
                  <ChevronDown size={15} aria-hidden="true" />
                </button>
                {slideshowStartMenuOpen ? (
                  <div aria-label="Slideshow start options" className="slideshow-start-menu" role="menu">
                    <button
                      aria-checked={!openSlideshowWindowOnStart}
                      className={!openSlideshowWindowOnStart ? "selected" : undefined}
                      onClick={() => {
                        setOpenSlideshowWindowOnStart(false);
                        setSlideshowStartMenuOpen(false);
                      }}
                      role="menuitemradio"
                      type="button"
                    >
                      <span aria-hidden="true">{!openSlideshowWindowOnStart ? "✓" : ""}</span>
                      Don&apos;t open slideshow window
                    </button>
                    <button
                      aria-checked={openSlideshowWindowOnStart}
                      className={openSlideshowWindowOnStart ? "selected" : undefined}
                      onClick={() => {
                        setOpenSlideshowWindowOnStart(true);
                        setSlideshowStartMenuOpen(false);
                      }}
                      role="menuitemradio"
                      type="button"
                    >
                      <span aria-hidden="true">{openSlideshowWindowOnStart ? "✓" : ""}</span>
                      Open slideshow in new window
                    </button>
                    {canSimulateService ? (
                      <>
                        <div className="slideshow-start-menu-divider" role="separator" />
                        <span className="slideshow-start-menu-label">Test service flow</span>
                        <button onClick={() => void showPreServiceRehearsalPhase("montage")} role="menuitem" type="button">
                          <span aria-hidden="true">1</span>
                          Welcome montage
                        </button>
                        <button onClick={() => void showPreServiceRehearsalPhase("countdown")} role="menuitem" type="button">
                          <span aria-hidden="true">2</span>
                          Countdown
                        </button>
                        <button onClick={() => void showPreServiceRehearsalPhase("complete")} role="menuitem" type="button">
                          <span aria-hidden="true">3</span>
                          End countdown
                        </button>
                        <div className="slideshow-start-menu-divider" role="separator" />
                        <button onClick={() => void startServiceFromMenu()} role="menuitem" type="button">
                          <span aria-hidden="true">▶</span>
                          Start service
                        </button>
                        <button onClick={() => void stopServiceTest()} role="menuitem" type="button">
                          <span aria-hidden="true">■</span>
                          Stop service
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
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
            {activeSermonRecording?.pending_stop_at ? (
              <div className="recording-grace-countdown" role="status">
                <Clock size={17} aria-hidden="true" />
                <span>
                  <strong>Recording continues — ending in {recordingGraceCountdown(activeSermonRecording.pending_stop_at, recordingClock)}</strong>
                  <small>{activeSermonRecording.pending_stop_reason ?? "Left sermon"}. Return to a sermon slide to keep this recording, or end it now.</small>
                </span>
                <button className="danger-button icon-text-button" disabled={recordingAction} onClick={() => void runRecordingAction("stop")} type="button">
                  <CircleStop size={15} aria-hidden="true" /> End now
                </button>
              </div>
            ) : null}
            {recordingControlsEnabled && (currentPlanItem?.item_type === "sermon" || activeSermonRecording) ? (
              <div className="action-row sermon-recording-controls is-open" aria-label="Sermon recording controls">
                {!activeSermonRecording ? (
                  <button
                    className="text-button"
                    disabled={recordingAction || currentPlanItem?.item_type !== "sermon"}
                    onClick={() => void runRecordingAction("start")}
                    title="Start sermon recording"
                    type="button"
                  >
                    <Mic size={16} aria-hidden="true" />
                    Start recording
                  </button>
                ) : (
                  <>
                    <button
                      className="text-button"
                      disabled={recordingAction}
                      onClick={() => void runRecordingAction(activeSermonRecording.status === "paused" ? "resume" : "pause")}
                      type="button"
                    >
                      {activeSermonRecording.status === "paused" ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
                      {activeSermonRecording.status === "paused" ? "Resume" : "Pause"}
                    </button>
                    <button className="text-button" disabled={recordingAction} onClick={() => void runRecordingAction("stop")} type="button">
                      <CircleStop size={16} aria-hidden="true" />
                      Stop recording
                    </button>
                  </>
                )}
              </div>
            ) : null}
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
              <div className="slide-notes-editor">
                <textarea
                  disabled={!currentPlanItem || slideNotesSaving}
                  onBlur={() => void saveSlideNotes()}
                  onChange={(event) => setSlideNotesDraft(event.target.value)}
                  placeholder={currentPlanItem ? "Notes for this sermon slide..." : "Select a sermon slide to add notes."}
                  value={slideNotesDraft}
                />
                <button
                  className="text-button compact-button"
                  disabled={!currentPlanItem || slideNotesSaving || !slideNotesDirty}
                  onClick={() => void saveSlideNotes()}
                  type="button"
                >
                  {slideNotesSaving ? "Saving…" : slideNotesDirty ? "Save" : "Saved"}
                </button>
              </div>
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
              const sorterTarget = sorterTargetForSlide(activeSlide);
              const nextDirection = slideVisibilityDirection(slideGridRef.current, sorterTarget);
              sorterCatchUpDirectionRef.current = nextDirection;
              setSorterCatchUpDirection(nextDirection);
              if (nextDirection && Date.now() > sorterProgrammaticScrollUntilRef.current) {
                sorterFollowingRef.current = false;
              }
            }}
            ref={slideGridRef}
          >
            {sections.map((section) => {
              const sectionStart = slides.findIndex((slide) => slide.sectionId === section.id);
              const visibleSectionSlides = sorterSlidesForSection(section.slides);
              const sectionItem = sectionPlanItem(section.id);
              const sectionFileIds = sectionItem?.item_type === "video"
                ? []
                : sectionItem?.files
                    ?.filter(
                      (file) =>
                        !file.content_type?.startsWith("video/") &&
                        !file.content_type?.startsWith("image/"),
                    )
                    .map((file) => file.file_id) ?? [];
              const canEditSectionSong = canEditSong && sectionItem?.song_id;
              const deckStatus = describeDeckStatus(
                sectionFileIds,
                renderedSlidesByFileId,
                renderingFileIds,
                renderErrorsByFileId,
              );
              const sectionRenderError = sectionItem?.item_type === "video" ? undefined : sectionItem?.files
                ?.filter((file) => !file.content_type?.startsWith("video/"))
                ?.map((file) => renderErrorsByFileId[file.file_id])
                .find(Boolean);
              const hasNestedItems = visibleSectionSlides.some((slide) => slide.planItemId !== section.id);
              const autoCollapseSectionItems = Boolean(sectionItem?.auto_collapse_items);
              const canCollapseSection = !autoCollapseSectionItems && !hasNestedItems && visibleSectionSlides.length > 1;
              const sectionExpanded = expandedSorterSectionIds.has(section.id) || liveSlide?.sectionId === section.id;
              const showSlideTiles =
                !canCollapseSection ||
                sectionExpanded;
              return (
                <div
                  className={`section-slide-group ${presentationTypeClass(section.itemType)}`}
                  key={section.id}
                  ref={(element) => {
                    sorterSectionRefs.current[section.id] = element;
                  }}
                >
                  {section.itemType !== "end" ? <div className="section-jump-row">
                    <button
                      className={`section-jump ${presentationTypeClass(section.itemType)} ${
                        liveSlide?.sectionId === section.id ? "active" : ""
                      }`}
                      onClick={() => selectSlideFromOperator(sectionStart)}
                      type="button"
                    >
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
                    {canEditPlan && INLINE_EDIT_ITEM_TYPES.has(section.itemType) ? (
                      <button
                        aria-label={`Edit ${section.title}`}
                        className="section-icon-button section-edit-button"
                        disabled={fillerMediaBusy}
                        onClick={() => sectionItem && openPlanItemEditor(sectionItem)}
                        title={`Edit ${section.title}`}
                        type="button"
                      >
                        <Pencil size={14} aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                    ) : null}
                  </div> : null}
                  {sectionRenderError ? <p className="render-error-message">{sectionRenderError}</p> : null}
                  {showSlideTiles ? (
                    <div className="section-slide-list">
                      {visibleSectionSlides.map((slide) => {
                        const itemSlides = visibleSectionSlides.filter((candidate) => candidate.planItemId === slide.planItemId);
                        const item = sectionPlanItem(slide.planItemId);
                        const firstItemSlide = itemSlides[0]?.id === slide.id;
                        const itemCanCollapse = itemSlides.length > 1;
                        const itemExpanded = expandedSorterSectionIds.has(slide.planItemId) || liveSlide?.planItemId === slide.planItemId;
                        const itemContracted = autoCollapseSectionItems && !itemExpanded;
                        const slideIndex = slides.findIndex((candidate) => candidate.id === slide.id);
                        const matchesLiveBuild =
                          Boolean(slide.imageUrl && liveSlide?.imageUrl) &&
                          deckBuildGroupKey(slide) === deckBuildGroupKey(liveSlide);
                        const tileRefIds = matchesLiveBuild && liveSlide ? [slide.id, liveSlide.id] : [slide.id];
                        if (itemContracted) {
                          if (!firstItemSlide) return null;
                          return (
                            <div className="sorter-item-heading-row is-contracted" key={`contracted:${slide.planItemId}`}>
                              <button className="sorter-item-heading" onClick={() => toggleSorterSection(slide.planItemId)} type="button"><strong>{item?.title ?? slide.sectionTitle}</strong><ChevronDown size={13} aria-hidden="true" /></button>
                              {item && (item.song_id ? canEditSong : canEditPlan && INLINE_EDIT_ITEM_TYPES.has(item.item_type)) ? <button aria-label={`Edit ${item.title}`} className="section-icon-button sorter-item-inline-edit" disabled={fillerMediaBusy} onClick={() => openPlanItemEditor(item)} title={`Edit ${item.title}`} type="button"><Pencil size={12} aria-hidden="true" /></button> : null}
                            </div>
                          );
                        }
                        if (itemCanCollapse && !itemExpanded) {
                          if (!firstItemSlide) return null;
                          const canEditNestedItem = Boolean(item && (item.song_id ? canEditSong : canEditPlan && INLINE_EDIT_ITEM_TYPES.has(item.item_type)));
                          if (slide.itemType === "song") {
                            return (
                              <div className="sorter-item-summary-row" key={`summary:${slide.planItemId}`}>
                                <button aria-label={`Expand ${item?.title ?? slide.title} slides`} className="song-slide-summary sorter-song-item-summary" onClick={() => toggleSorterSection(slide.planItemId)} type="button">
                                  <span className="song-slide-leaf" aria-hidden="true">{renderMiniSlide(slide, "Song", slideTheme, compactPlanTextFontCap)}</span>
                                  <span className="sorter-song-item-details"><strong>{item?.title ?? slide.title}</strong><small>{itemSlides.length} slides · Expand</small></span>
                                </button>
                                {canEditNestedItem && item ? <button aria-label={`Edit ${item.title}`} className="section-icon-button sorter-item-inline-edit" onClick={() => openPlanItemEditor(item)} title={`Edit ${item.title}`} type="button"><Pencil size={12} aria-hidden="true" /></button> : null}
                              </div>
                            );
                          }
                          return (
                            <div className="sorter-item-summary-row" key={`summary:${slide.planItemId}`}>
                              <button aria-label={`Expand ${item?.title ?? slide.title} slides`} className={`sorter-item-summary ${slide.itemType === "song" ? "is-song" : ""}`} onClick={() => toggleSorterSection(slide.planItemId)} type="button">
                                <span className="sorter-item-leaf">{renderMiniSlide(slide, "Item", slideTheme, compactPlanTextFontCap)}</span>
                                <span><strong>{item?.title ?? slide.sectionTitle}</strong><small>{itemSlides.length} slides · Expand</small></span>
                              </button>
                              {canEditNestedItem && item ? <button aria-label={`Edit ${item.title}`} className="section-icon-button sorter-item-inline-edit" onClick={() => openPlanItemEditor(item)} title={`Edit ${item.title}`} type="button"><Pencil size={12} aria-hidden="true" /></button> : null}
                            </div>
                          );
                        }
                        return (
                          <div className="sorter-item-tile" key={slide.id}>
                          {firstItemSlide && hasNestedItems ? <div className="sorter-item-heading-row"><button className="sorter-item-heading" onClick={() => autoCollapseSectionItems || itemCanCollapse ? toggleSorterSection(slide.planItemId) : selectSlideFromOperator(slideIndex)} type="button"><strong>{item?.title ?? slide.sectionTitle}</strong>{autoCollapseSectionItems || itemCanCollapse ? <ChevronUp size={13} /> : null}</button>{item && (item.song_id ? canEditSong : canEditPlan && INLINE_EDIT_ITEM_TYPES.has(item.item_type)) ? <button aria-label={`Edit ${item.title}`} className="section-icon-button sorter-item-inline-edit" disabled={fillerMediaBusy} onClick={() => openPlanItemEditor(item)} title={`Edit ${item.title}`} type="button"><Pencil size={12} aria-hidden="true" /></button> : null}</div> : null}
                          <button
                            className={`slide-tile preview-tile ${presentationTypeClass(slide.itemType)} ${
                              slideIndex === liveIndex || matchesLiveBuild ? "active" : ""
                            }`}
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
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    section.itemType === "song" ? (
                      <button
                        aria-label={`Expand ${section.title} slides`}
                        className="song-slide-summary"
                        onClick={() => toggleSorterSection(section.id)}
                        type="button"
                      >
                        <span className="song-slide-leaf" aria-hidden="true">
                          {renderMiniSlide(
                            visibleSectionSlides[0] ?? section.slides[0] ?? null,
                            "Song",
                            slideTheme,
                            compactPlanTextFontCap,
                          )}
                        </span>
                        <small>{visibleSectionSlides.length} slides · Expand</small>
                      </button>
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
                    )
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
          <div className="section-rail-title">
            <span>Sections</span>
            {canEditPlan && plan ? (
              <button
                aria-expanded={pendingServiceMode === "edit" && Boolean(pendingServiceDate)}
                aria-label="Service outline"
                className="section-rail-service-type section-icon-button"
                onClick={() => {
                  setServiceHistoryOpen(false);
                  setPendingServiceMode("edit");
                  setPendingServiceDate(dateInputFromIso(plan.service_date));
                  setPendingServiceTypeId(plan.plan_type_id);
                }}
                title="Service outline"
                type="button"
              >
                <Layers3 size={13} aria-hidden="true" />

              </button>
            ) : null}
          </div>
          <div
            className="section-rail-list"
            onScroll={() => {
              const activeSlide = slides[liveIndex];
              const nextDirection = slideVisibilityDirection(sectionRailListRef.current, railTargetForSlide(activeSlide));
              railCatchUpDirectionRef.current = nextDirection;
              setRailCatchUpDirection(nextDirection);
              if (nextDirection && Date.now() > railProgrammaticScrollUntilRef.current) {
                railFollowingRef.current = false;
              }
            }}
            ref={sectionRailListRef}
          >
            {canEditPlan ? (
              <button
                aria-label="Search or add at the start"
                className="section-insert-button"
                onClick={() => setGroupInsertIndex(-1)}
                type="button"
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            ) : null}
            {sections.filter((section) => section.itemType !== "end").map((section, sectionIndex) => {
              const sectionStart = slides.findIndex((slide) => slide.sectionId === section.id);
              const ownerItems = sectionOwner(section.id) === "worship" ? orderedWorshipSetItems() : orderedPlanItemsWithWorshipAnchor();
              const ownerItemIndex = ownerItems.findIndex((item) => item.id === section.id);
              const sectionAudioSlide = section.slides.find((slide) => slide.youtubeAudioUrl);
              const sectionAudioPlaying = playingAudioSectionId === section.id;
              const sectionItem = sectionPlanItem(section.id);
              const fixedOutlineSection = Boolean(
                section.itemType === WORSHIP_SET_ANCHOR_ITEM_TYPE ||
                (sectionItem && currentPlanType?.default_outline.some(
                  (definition) => definition.item_type === sectionItem.item_type && (definition.item_type !== "custom" || definition.title === sectionItem.title),
                )),
              );
              const sermonDeckAttached = Boolean(
                sectionItem?.item_type === "sermon" && sectionItem.files.some(
                  (file) => !file.content_type?.startsWith("image/") && !file.content_type?.startsWith("video/"),
                ),
              );
              const groupItems = effectivePlanItems
                .filter((item) => item.parent_item_id === section.id)
                .sort((left, right) => Number(left.sequence) - Number(right.sequence));
              const activeGroupItem = groupItems.some((item) => item.id === liveSlide?.planItemId);
              const groupExpanded = expandedRailGroupIds.has(section.id) || activeGroupItem;
              const worshipGroup = section.itemType === WORSHIP_SET_ANCHOR_ITEM_TYPE;
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
                      liveSlide?.planItemId === section.id ? "active" : ""
                    }`}
                  >
                    <button
                      className="section-rail-jump"
                      onClick={() => {
                        selectSlideFromOperator(sectionStart);
                      }}
                      type="button"
                      title={section.title}
                    >
                      <span>{(sectionIndex + 1).toString().padStart(2, "0")}</span>
                      <strong>{section.title}</strong>
                    </button>
                    {groupItems.length ? (
                      <button
                        aria-expanded={groupExpanded}
                        aria-label={`${groupExpanded ? "Collapse" : "Expand"} ${section.title} items`}
                        className="section-icon-button section-collapse-button"
                        onClick={() => toggleRailGroup(section.id)}
                        title={groupExpanded ? "Collapse items" : "Expand items"}
                        type="button"
                      >
                        {groupExpanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                      </button>
                    ) : null}
                    {groupExpanded ? (
                      <div className="section-group-items">
                        {canEditPlan && groupItems.length > 0 && section.itemType !== "pre_service" ? (
                          <button
                            aria-label={`Add item at the start of ${section.title}`}
                            className="section-group-insert-button"
                            onClick={() => openSearchOverlay(sectionIndex, worshipGroup ? "songs" : ["sermon", "announcements"].includes(section.itemType) ? "deck" : "bible", {
                              deckTargetPlanItemId: section.id,
                              parentInsertIndex: -1,
                              parentItemId: section.id,
                              selectInserted: false,
                            })}
                            type="button"
                          ><Plus size={12} aria-hidden="true" /></button>
                        ) : null}
                        {groupItems.map((item, itemIndex) => {
                          const itemSlideIndex = slides.findIndex((slide) => slide.planItemId === item.id);
                          const itemHasOwnAudio = Boolean(item.presentation_options?.backing_audio_id);
                          const itemAudioOwner = {
                            id: item.id,
                            slides: section.slides.filter((slide) => slide.planItemId === item.id),
                          };
                          const itemAudioPlaying = playingAudioSectionId === itemAudioOwner.id;
                          return (
                            <Fragment key={item.id}>
                            <div className={`section-group-item ${liveSlide?.planItemId === item.id ? "active" : ""}`} ref={(element) => { sectionRailRefs.current[item.id] = element; }}>
                              <button onClick={() => itemSlideIndex >= 0 && selectSlideFromOperator(itemSlideIndex)} type="button">
                                <span>{itemIndex + 1}</span><strong>{item.title}</strong>
                              </button>
                              {item.song_id && itemHasOwnAudio && section.slides.some((slide) => slide.planItemId === item.id && slide.youtubeAudioUrl) ? (
                                <button
                                  aria-label={`${itemAudioPlaying ? "Fade out" : "Play"} YouTube audio for ${item.title}`}
                                  aria-pressed={itemAudioPlaying}
                                  className={`section-icon-button section-audio-button ${itemAudioPlaying ? "is-active" : ""}`}
                                  disabled={!audioControlsEnabled && !itemAudioPlaying}
                                  onClick={() => void toggleSectionAudio(itemAudioOwner)}
                                  title={audioControlsEnabled || itemAudioPlaying ? `${itemAudioPlaying ? "Fade out" : "Play"} YouTube audio` : "Enable audio on the preview first"}
                                  type="button"
                                >{itemAudioPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}</button>
                              ) : null}
                              {canEditPlan ? <div className="section-group-item-actions">
                                <button aria-label={`Edit ${item.title}`} className="section-icon-button" title="Item settings" onClick={() => void openPlanItemEditor(item, sectionItem)} type="button"><Pencil size={14} /></button>
                                <button aria-label={`Move ${item.title} up`} className="section-icon-button" disabled={itemIndex === 0} onClick={() => void moveSection(item.id, -1)} title="Move item up" type="button"><ChevronUp size={15} /></button>
                                <button aria-label={`Move ${item.title} down`} className="section-icon-button" disabled={itemIndex === groupItems.length - 1} onClick={() => void moveSection(item.id, 1)} title="Move item down" type="button"><ChevronDown size={15} /></button>
                                <button aria-label={`Remove ${item.title}`} className="section-icon-button section-remove-button" onClick={() => void removeSection(item.id)} title="Remove item" type="button"><Trash2 size={15} /></button>
                              </div> : null}
                            </div>
                            {canEditPlan && section.itemType !== "pre_service" ? (
                              <button
                                aria-label={`Add item after ${item.title}`}
                                className="section-group-insert-button"
                                onClick={() => openSearchOverlay(sectionIndex, worshipGroup ? "songs" : ["sermon", "announcements"].includes(section.itemType) ? "deck" : "bible", {
                                  deckTargetPlanItemId: section.id,
                                  parentInsertIndex: itemIndex,
                                  parentItemId: section.id,
                                  selectInserted: false,
                                })}
                                type="button"
                              ><Plus size={12} aria-hidden="true" /></button>
                            ) : null}
                            </Fragment>
                          );
                        })}
                      </div>
                    ) : null}
                    {canEditPlan && !groupItems.length && section.itemType !== WORSHIP_SET_ANCHOR_ITEM_TYPE && section.itemType !== "pre_service" ? (
                      <button
                        aria-label={`Add item to ${section.title}`}
                        className="section-group-insert-button section-group-empty-insert"
                        onClick={() => openSearchOverlay(
                          sectionIndex,
                          ["sermon", "announcements"].includes(section.itemType) ? "deck" : "bible",
                          { deckTargetPlanItemId: section.id, parentInsertIndex: -1, parentItemId: section.id, selectInserted: false },
                        )}
                        type="button"
                      ><Plus size={14} aria-hidden="true" /></button>
                    ) : null}
                    {canEditPlan || sectionAudioSlide || (canManagePreServiceMedia && section.itemType === "pre_service") ? (
                      <div className="section-actions">
                        {sectionAudioSlide ? (
                          <button
                            aria-label={`${sectionAudioPlaying ? "Fade out" : "Play"} YouTube audio for ${section.title}`}
                            aria-pressed={sectionAudioPlaying}
                            className={`section-icon-button section-audio-button ${sectionAudioPlaying ? "is-active" : ""}`}
                            disabled={!audioControlsEnabled && !sectionAudioPlaying}
                            onClick={() => toggleSectionAudio(section)}
                            title={audioControlsEnabled || sectionAudioPlaying ? `${sectionAudioPlaying ? "Fade out" : "Play"} YouTube audio` : "Enable audio on the preview first"}
                            type="button"
                          >
                            {sectionAudioPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                          </button>
                        ) : null}
                        {canEditPlan ? (
                          <>
                            {sectionItem ? <button aria-label={`Edit ${section.title}`} className="section-icon-button" title="Section settings" onClick={() => void openPlanItemEditor(sectionItem)} type="button"><Pencil size={14} /></button> : null}
                            {sermonDeckAttached && sectionItem ? (
                              <button
                                aria-label={`Remove ${section.title} deck`}
                                className="section-icon-button section-remove-button"
                                onClick={() => void removeSermonDeck(sectionItem)}
                                title="Remove deck and keep the Sermon outline slide"
                                type="button"
                              >
                                <Trash2 size={14} aria-hidden="true" />
                              </button>
                            ) : null}
                            {!fixedOutlineSection || canAccessAdminTools ? <>
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
                            </> : null}
                          </>
                        ) : null}
                        {canEditPlan && sectionItem && (!fixedOutlineSection || canAccessAdminTools) ? (
                          <button
                            aria-label={`Remove ${section.title}`}
                            className="section-icon-button section-remove-button"
                            onClick={() => void removeSection(section.id)}
                            type="button"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {canEditPlan ? (
                    <button
                      aria-label={`Search or add after ${section.title}`}
                      className="section-insert-button"
                      onClick={() => setGroupInsertIndex(sectionIndex)}
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

      {groupInsertIndex !== null ? (
        <div className="app-dialog-backdrop" role="presentation">
          <form aria-label="Add section" aria-modal="true" role="dialog" className="app-dialog compact-template-dialog" onSubmit={(event) => { event.preventDefault(); void addOutlineGroup(); }}>
            <h2>Add section</h2>
            <label>Section template<select disabled={addingSection} value={sectionTemplateKey} onChange={(event) => {
              setSectionTemplateKey(event.target.value);
              const source = sectionTemplates.find((entry) => entry.key === event.target.value);
              setGroupTitleDraft(source?.item.title ?? "");
            }}><option value="">Create a new section template</option>{sectionTemplates.map(({ type, item, key }) => <option key={key} value={key}>{type.name} · {item.title}</option>)}</select></label>
            <label>Section name<input autoFocus onChange={(event) => setGroupTitleDraft(event.target.value)} placeholder="e.g. Announcements" value={groupTitleDraft} /></label>
            <label className="inline-checkbox"><input type="checkbox" checked={saveSectionTemplate} onChange={(event) => setSaveSectionTemplate(event.target.checked)} /><span>Keep in {currentPlanType?.name ?? "this service template"} for future services</span></label>
            <div className="app-dialog-actions">
              <button disabled={addingSection} className="text-button" onClick={() => { setGroupInsertIndex(null); setGroupTitleDraft(""); }} type="button">Cancel</button>
              <button className="primary-button" disabled={addingSection || !groupTitleDraft.trim()} type="submit">{addingSection ? "Adding…" : "Add section"}</button>
            </div>
          </form>
        </div>
      ) : null}

      {searchOverlayOpen ? (
        <div className="app-dialog-backdrop" role="presentation">
          <div aria-labelledby="search-overlay-title" aria-modal="true" className="app-dialog app-dialog-wide search-dialog" role="dialog">
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
                  setVideoFile(null);
                }}
                type="button"
              >
                Video
              </button>
              <button
                className={`text-button ${searchMode === "images" ? "active-choice" : ""}`}
                onClick={() => { setSearchMode("images"); setImageFiles([]); setSearchSelectInserted(false); }}
                type="button"
              >
                Images
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

            {searchMode !== "deck" && searchMode !== "images" ? <div className="dialog-form-grid">
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
              <label>
                Search
                <input
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={suppressSearchEnterKeyDown}
                  onKeyUp={handleSearchEnterKeyUp}
                  ref={searchInputRef}
                  placeholder={
                    searchMode === "bible"
                      ? "John 3 16 or shepherd"
                      : searchMode === "video"
                        ? "YouTube link, video ID, or Drive video name"
                        : "Amazing Grace"
                  }
                  value={searchQuery}
                />
              </label>
            </div> : null}

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
                <p className={`search-empty ${googleDriveError ? "error-text" : ""}`}>
                  {googleDriveError
                    ? googleDriveError
                    : googleDriveStatus?.connected
                      ? `Drive videos available from ${googleDriveStatus.account_name || googleDriveStatus.account_email || "Google Drive"}.`
                      : googleDriveStatus?.configured
                        ? "Connect Google Drive in Admin to import MP4 files."
                        : "Google Drive is not configured on this server."}
                </p>
              </div>
            ) : null}

            {searchMode === "images" ? (
              <div className="dialog-form-grid">
                <label className="wide-field">
                  Image files
                  <input
                    accept="image/*"
                    disabled={!canAttachDeck}
                    multiple
                    onChange={(event) => setImageFiles(Array.from(event.target.files ?? []))}
                    type="file"
                  />
                </label>
                {imageFiles.length ? (
                  <button className="primary-button" onClick={() => void addImageItem()} type="button">
                    Add {imageFiles.length} {imageFiles.length === 1 ? "image" : "images"}
                  </button>
                ) : <p className="search-empty">Choose one or more images for a single sortable item.</p>}
              </div>
            ) : null}

            {searchMode === "deck" ? (
              <>
                <div className="dialog-form-grid">
                  <label className="wide-field">
                    Drive Search
                    <input
                      disabled={!googleDriveStatus?.connected || Boolean(importingDriveFileId)}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={suppressSearchEnterKeyDown}
                      onKeyUp={handleSearchEnterKeyUp}
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
              {searchMode === "video" ? (
                <button
                  className="primary-button"
                  disabled={
                    !canEditPlan ||
                    (!extractYouTubeId(searchQuery) &&
                      !videoFile &&
                      youtubeResults.length === 0 &&
                      !(googleDriveStatus?.connected && googleDriveFiles.length > 0))
                  }
                  onClick={() => void selectTopSearchResult()}
                  type="button"
                >
                  Add Video
                </button>
              ) : null}
            </div>
            {searchMode === "deck" ? (
              <label className="checkbox-label">
                <input
                  checked={deckFlattenBuilds}
                  disabled={!canAttachDeck || Boolean(importingDriveFileId)}
                  onChange={(event) => setDeckFlattenBuilds(event.target.checked)}
                  type="checkbox"
                />
                Preserve transitions/animations
              </label>
            ) : null}

            <div className="search-results-list">
              {searchLoading ? <p className="search-empty">Searching…</p> : null}
              {(searchMode === "deck" || searchMode === "video") && googleDriveLoading ? <p className="search-empty">Searching Google Drive…</p> : null}
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
              {searchMode === "bible" && bibleSearchLoadingMore ? <p className="search-empty">Loading more…</p> : null}
              {searchMode === "bible" && bibleSearchHasMore ? <div aria-hidden="true" ref={bibleSearchLoadMoreRef} /> : null}
              {!searchLoading && searchMode === "video" && videoFile ? (
                <button
                  className="search-result-card"
                  disabled={!canEditPlan || !canAttachDeck}
                  onClick={() => void addVideoSearchResult()}
                  type="button"
                >
                  <strong>{videoFile.name.replace(/\.[^.]+$/, "")}</strong>
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
                    <strong>YouTube Video</strong>
                    <span>{extractYouTubeId(searchQuery)}</span>
                  </button>
                ) : !googleDriveStatus?.connected && !googleDriveLoading ? (
                  <p className="search-empty">Paste a valid YouTube link or 11-character video ID.</p>
                ) : null
              ) : null}
              {searchMode === "video" && youtubeLoading ? <p className="search-empty">Searching YouTube…</p> : null}
              {searchMode === "video" && !extractYouTubeId(searchQuery)
                ? youtubeResults.map((video) => (
                    <button
                      className="search-result-card video-search-result-card"
                      disabled={!canEditPlan}
                      key={`youtube:${video.id}`}
                      onClick={() => void addVideoSearchResult(video)}
                      type="button"
                    >
                      {video.thumbnail_url ? <img alt="" src={video.thumbnail_url} /> : null}
                      <span>
                        <strong>{video.title}</strong>
                        <small>{video.channel_title} · YouTube</small>
                      </span>
                    </button>
                  ))
                : null}
              {searchMode === "video" && youtubeError ? <p className="search-empty error-text">{youtubeError}</p> : null}
              {searchMode === "video" && youtubeLoadingMore ? <p className="search-empty">Loading more YouTube results…</p> : null}
              {searchMode === "video" && youtubeNextPageToken ? <div aria-hidden="true" ref={youtubeLoadMoreRef} /> : null}
              {!googleDriveLoading && searchMode === "video" && googleDriveStatus?.connected && !extractYouTubeId(searchQuery)
                ? googleDriveFiles.map((file) => {
                    const importingThisFile = importingDriveFileId === file.id;
                    return (
                      <button
                        className={`search-result-card ${importingThisFile ? "active-import-match" : ""}`}
                        disabled={!canEditPlan || !canAttachDeck || Boolean(importingDriveFileId)}
                        key={file.id}
                        onClick={() => {
                          void attachImportedDriveVideo(file);
                        }}
                        type="button"
                      >
                        <strong>{importingThisFile ? "Importing..." : file.name}</strong>
                        <span>{importingThisFile ? "Downloading MP4 from Google Drive." : "Google Drive video"}</span>
                      </button>
                    );
                  })
                : null}
              {!googleDriveLoading && searchMode === "deck" && googleDriveStatus?.connected
                ? googleDriveFiles.map((file) => {
                    const importingThisFile = importingDriveFileId === file.id;
                    return (
                    <button
                      className={`search-result-card ${importingThisFile ? "active-import-match" : ""}`}
                      disabled={!canEditPlan || !canAttachDeck || Boolean(importingDriveFileId)}
                      key={file.id}
                      onClick={() => {
                        void attachImportedDriveDeck(file);
                      }}
                      type="button"
                    >
                      <strong>{importingThisFile ? "Importing..." : file.name}</strong>
                      <span>{importingThisFile ? "Please wait; this can take a moment." : file.source_kind === "google_slides" ? "Google Slides" : file.mime_type}</span>
                    </button>
                    );
                  })
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
                (searchMode === "video" &&
                  !searchQuery.trim() &&
                  !videoFile &&
                  (!googleDriveStatus?.connected || (googleDriveFiles.length === 0 && !googleDriveLoading)))) ? (
                <p className="search-empty">No matches yet.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {fillerMediaEditorLoading ? (
        <div className="app-dialog-backdrop" role="presentation">
          <div aria-modal="true" className="app-dialog pre-service-media-dialog" role="dialog">
            <h2>Loading editor…</h2>
            <p>Loading item details and attached images.</p>
          </div>
        </div>
      ) : null}

      {fillerMediaPlanItem && !fillerMediaEditorLoading ? (
        <div className="app-dialog-backdrop" role="presentation">
          <div aria-labelledby="filler-media-title" aria-modal="true" className="app-dialog app-dialog-wide pre-service-media-dialog" role="dialog">
            <div>
              <h2 id="filler-media-title">Edit {fillerMediaSectionItem?.id === fillerMediaPlanItem.id ? "section" : "item"}: {fillerMediaPlanItem.title}</h2>
              <p>Configure this service, then choose whether to update its template.</p>
            </div>
            <div className="form-grid item-details-grid">
              <label>
                <span>Item name</span>
                <input disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, title: event.target.value }))} value={itemEditDraft.title} />
              </label>
              {fillerMediaPlanItem.item_type === "announcements" ? <label className="wide-field"><span>Announcement text <small>(optional)</small></span><textarea disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, comment: event.target.value }))} rows={3} value={itemEditDraft.comment} /></label> : null}
            </div>
            <details className="item-editor-fieldset item-editor-disclosure" open={itemEditorSection === "playback"}>
              <summary onClick={(event) => { event.preventDefault(); setItemEditorSection((current) => current === "playback" ? null : "playback"); }}>Timing</summary>
              <div className="form-grid item-details-grid">
                {fillerMediaSectionItem?.id === fillerMediaPlanItem.id && fillerMediaPlanItem.id === effectivePlanItems.find((item) => !item.parent_item_id)?.id ? <><label className="inline-checkbox wide-field"><input type="checkbox" checked={Boolean(itemEditDraft.planned_start)} disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, planned_start: event.target.checked ? (currentPlanType?.automation_start ?? currentPlanType?.starts_at ?? "10:30") : "" }))} /><span>Queue this service to start automatically</span></label>
                {itemEditDraft.planned_start ? <label>Queued start<input type="time" required disabled={fillerMediaBusy} value={itemEditDraft.planned_start} onChange={(event) => setItemEditDraft((current) => ({ ...current, planned_start: event.target.value }))} /></label> : null}</> : null}
                {fillerMediaSectionItem?.id === fillerMediaPlanItem.id && fillerMediaPlanItem.id === effectivePlanItems.filter((item) => !item.parent_item_id).slice(-1)[0]?.id ? <label className="inline-checkbox wide-field"><input checked={itemEditDraft.end_after_section} disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, end_after_section: event.target.checked }))} type="checkbox" /><span>End the service when this section's final auto-advancing slide finishes</span></label> : null}
                <label className="inline-checkbox"><input checked={itemEditDraft.auto_advance} disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, auto_advance: event.target.checked }))} type="checkbox" /><span>Advance automatically</span></label>
                {itemEditDraft.auto_advance ? <label><span>Advance after (seconds)</span><input disabled={fillerMediaBusy} min="1" onChange={(event) => setItemEditDraft((current) => ({ ...current, auto_advance_seconds: Number(event.target.value) }))} type="number" value={itemEditDraft.auto_advance_seconds} /></label> : null}
                {fillerMediaPlanItem.item_type === "open_time" ? <label className="inline-checkbox"><input checked={itemEditDraft.repeat} disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, repeat: event.target.checked }))} type="checkbox" /><span>Repeat montage</span></label> : null}
              </div>
            </details>
            <details className="item-editor-fieldset item-editor-disclosure" open={itemEditorSection === "visual"}>
              <summary onClick={(event) => { event.preventDefault(); setItemEditorSection((current) => current === "visual" ? null : "visual"); }}>Visuals</summary>
              <div className="form-grid item-details-grid">
                {fillerMediaSectionItem ? <label className="inline-checkbox wide-field"><input checked={itemEditDraft.auto_collapse_items} disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, auto_collapse_items: event.target.checked }))} type="checkbox" /><span>Auto-contract this section’s items</span></label> : null}
                <label><span>Image fit</span><select disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, fit_mode: event.target.value as "contain" | "cover" }))} value={itemEditDraft.fit_mode}><option value="contain">Fit whole image</option><option value="cover">Fill and crop</option></select></label>
                <label><span>Transition</span><select disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, transition: event.target.value as "fade" | "cut" | "slide" }))} value={itemEditDraft.transition}><option value="fade">Fade</option><option value="cut">Cut</option><option value="slide">Slide</option></select></label>
                <label><span>Image dwell (seconds)</span><input disabled={fillerMediaBusy} min="1" onChange={(event) => setItemEditDraft((current) => ({ ...current, dwell_seconds: Number(event.target.value) }))} type="number" value={itemEditDraft.dwell_seconds} /></label>
              </div>
            </details>
            <details className="item-editor-fieldset item-editor-disclosure" open={itemEditorSection === "routing"}>
              <summary onClick={(event) => { event.preventDefault(); setItemEditorSection((current) => current === "routing" ? null : "routing"); }}>Audio</summary>
              <div className="form-grid item-details-grid">
                <div className="wide-field"><span>Backing audio</span>
                  {inheritedSectionBackingAudioId ? <>
                    <small>YouTube backing audio inherited from {fillerMediaSectionItem?.title}. It continues through this section.</small>
                    <div className="action-row"><button className="text-button" disabled={fillerMediaBusy || !fillerMediaSectionItem} type="button" onClick={() => fillerMediaSectionItem && void openPlanItemEditor(fillerMediaSectionItem)}>Edit section audio</button></div>
                  </> : <>
                    <div className="action-row"><button className="text-button" disabled={fillerMediaBusy} type="button" onClick={() => setAudioSearchOpen((current) => !current)}>{itemEditDraft.backing_audio_id ? "Change YouTube audio" : "Search YouTube"}</button>
                    {itemEditDraft.backing_audio_id ? <button className="text-button" disabled={fillerMediaBusy} type="button" onClick={() => setItemEditDraft((current) => ({ ...current, backing_audio_id: "" }))}>Remove audio</button> : null}</div>
                    {itemEditDraft.backing_audio_id ? <small>YouTube backing audio selected</small> : null}
                  </>}
                </div>
                {audioSearchOpen && !inheritedSectionBackingAudioId ? <SongYouTubeSearch context="section" initialQuery="" value={itemEditDraft.backing_audio_id || null} canEdit={!fillerMediaBusy} onClose={() => setAudioSearchOpen(false)} onSelect={(id) => { setItemEditDraft((current) => ({ ...current, backing_audio_id: id })); setAudioSearchOpen(false); }} /> : null}
                <label className="inline-checkbox wide-field"><input type="checkbox" disabled={fillerMediaBusy} checked={itemEditDraft.stop_backing_audio} onChange={(event) => setItemEditDraft((current) => ({ ...current, stop_backing_audio: event.target.checked }))} /><span>Fade out backing audio when this item starts</span></label>
                <label><span>Audio scene</span><select disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, audio_scene_id: event.target.value }))} value={itemEditDraft.audio_scene_id}><option value="">{automaticAudioSceneLabel} (automatic)</option>{audioScenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.label}</option>)}</select></label>
                <label className="inline-checkbox"><input checked={itemEditDraft.display_targets.includes("church")} disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, display_targets: event.target.checked ? [...new Set([...current.display_targets, "church" as const])] : current.display_targets.filter((target) => target !== "church") }))} type="checkbox" /><span>Show on church displays</span></label>
                <label className="inline-checkbox"><input checked={itemEditDraft.display_targets.includes("livestream")} disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, display_targets: event.target.checked ? [...new Set([...current.display_targets, "livestream" as const])] : current.display_targets.filter((target) => target !== "livestream") }))} type="checkbox" /><span>Show on livestream</span></label>
              </div>
            </details>
            {FIXED_WELCOME_STAGE_TYPES.has(fillerMediaPlanItem.item_type) || FILLER_MEDIA_ITEM_TYPES.has(fillerMediaPlanItem.item_type) ? <details className="item-editor-fieldset item-editor-disclosure" open={itemEditorSection === "overlay"}>
              <summary onClick={(event) => { event.preventDefault(); setItemEditorSection((current) => current === "overlay" ? null : "overlay"); }}>Text overlay</summary>
              <button className="text-button compact-button" disabled={fillerMediaBusy} onClick={() => setItemEditDraft((current) => ({ ...current, overlay_mode: "countdown", overlay_text: "Service begins in", overlay_position: "centre", overlay_size: "large", overlay_font: "display", overlay_panel_opacity: 0, overlay_background_dim: 50 }))} type="button">Use welcome countdown style</button>
              <div className="form-grid item-details-grid">
                <label><span>Overlay type</span><select disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, overlay_mode: event.target.value as "none" | "static" | "countdown" }))} value={itemEditDraft.overlay_mode}><option value="none">None</option><option value="static">Static text</option><option value="countdown">Text and countdown</option></select></label>
                <label><span>Position</span><select disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, overlay_position: event.target.value as typeof current.overlay_position }))} value={itemEditDraft.overlay_position}><option value="top-left">Top left</option><option value="top">Top centre</option><option value="top-right">Top right</option><option value="left">Centre left</option><option value="centre">Centre</option><option value="right">Centre right</option><option value="bottom-left">Bottom left</option><option value="bottom">Bottom centre</option><option value="bottom-right">Bottom right</option></select></label>
                <label className="wide-field"><span>Overlay text</span><input disabled={fillerMediaBusy || itemEditDraft.overlay_mode === "none"} onChange={(event) => setItemEditDraft((current) => ({ ...current, overlay_text: event.target.value }))} value={itemEditDraft.overlay_text} /></label>
                <label><span>Text size</span><select disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, overlay_size: event.target.value as "small" | "medium" | "large" }))} value={itemEditDraft.overlay_size}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
                <label><span>Font</span><select disabled={fillerMediaBusy} onChange={(event) => setItemEditDraft((current) => ({ ...current, overlay_font: event.target.value as typeof current.overlay_font }))} value={itemEditDraft.overlay_font}><option value="sans">Clean sans</option><option value="display">Welcome display</option><option value="serif">Serif</option><option value="mono">Monospace</option></select></label>
                <label><span>Text box transparency ({100 - itemEditDraft.overlay_panel_opacity}%)</span><input disabled={fillerMediaBusy} max="100" min="0" onChange={(event) => setItemEditDraft((current) => ({ ...current, overlay_panel_opacity: Number(event.target.value) }))} type="range" value={itemEditDraft.overlay_panel_opacity} /></label>
                <label><span>Background dimming ({itemEditDraft.overlay_background_dim}%)</span><input disabled={fillerMediaBusy} max="80" min="0" onChange={(event) => setItemEditDraft((current) => ({ ...current, overlay_background_dim: Number(event.target.value) }))} type="range" value={itemEditDraft.overlay_background_dim} /></label>
                {itemEditDraft.overlay_mode === "countdown" ? <label><span>Countdown seconds</span><input min="1" onChange={(event) => setItemEditDraft((current) => ({ ...current, overlay_countdown_seconds: Number(event.target.value) }))} type="number" value={itemEditDraft.overlay_countdown_seconds} /></label> : null}
              </div>
            </details> : null}
            {fillerMediaPlanItem.item_type === "announcements" ? <details className="item-editor-fieldset item-editor-disclosure" open={itemEditorSection === "announcement"}>
              <summary onClick={(event) => { event.preventDefault(); setItemEditorSection((current) => current === "announcement" ? null : "announcement"); }}>Announcement details</summary>
              <div className="form-grid item-details-grid">
                <label><span>Layout</span><select onChange={(event) => setItemEditDraft((current) => ({ ...current, announcement_layout: event.target.value as "image" | "text" | "split" | "background" }))} value={itemEditDraft.announcement_layout}><option value="split">Split image and text</option><option value="image">Image-led</option><option value="text">Text-led</option><option value="background">Full background</option></select></label>
                <label><span>Date / time</span><input onChange={(event) => setItemEditDraft((current) => ({ ...current, announcement_date: event.target.value }))} value={itemEditDraft.announcement_date} /></label>
                <label><span>Location</span><input onChange={(event) => setItemEditDraft((current) => ({ ...current, announcement_location: event.target.value }))} value={itemEditDraft.announcement_location} /></label>
                <label><span>Contact</span><input onChange={(event) => setItemEditDraft((current) => ({ ...current, announcement_contact: event.target.value }))} value={itemEditDraft.announcement_contact} /></label>
                <label className="wide-field"><span>URL / QR destination</span><input onChange={(event) => setItemEditDraft((current) => ({ ...current, announcement_url: event.target.value }))} type="url" value={itemEditDraft.announcement_url} /></label>
              </div>
            </details> : null}
            <details className="item-editor-fieldset item-editor-disclosure" open={itemEditorSection === "media"}>
            <summary onClick={(event) => { event.preventDefault(); setItemEditorSection((current) => current === "media" ? null : "media"); }}>Images and montage</summary>
            <p>Add one image to replace the default slide background, or add several to rotate them as a montage.</p>
            {canAttachDeck ? <label className="pre-service-upload-control">
              Add images
              <input
                accept="image/*"
                disabled={fillerMediaBusy}
                multiple
                onChange={(event) => {
                  void addFillerMedia(event.target.files);
                  event.target.value = "";
                }}
                type="file"
              />
            </label> : null}
            <label className="inline-checkbox">
              <input checked={Boolean(fillerMediaPlanItem.montage_random)} disabled={fillerMediaBusy} onChange={(event) => void setMontageRandom(fillerMediaPlanItem, event.target.checked)} type="checkbox" />
              <span>Randomise montage order</span>
            </label>
            <div className="pre-service-media-grid">
              {fillerMediaImageFiles.map((file) => (
                <article key={file.id}>
                  <img
                    alt={file.display_name}
                    onError={() => setLoadedFillerMediaFileIds((current) => new Set(current).add(file.file_id))}
                    onLoad={() => setLoadedFillerMediaFileIds((current) => new Set(current).add(file.file_id))}
                    src={storedFileDownloadUrl(file.file_id)}
                  />
                  <span>{file.display_name}</span>
                  <label className="media-persistence-control">
                    <input
                      checked={Boolean(file.persistent)}
                      disabled={fillerMediaBusy || file.id.startsWith("pre-service:")}
                      onChange={(event) => void setMediaPersistence(file, event.target.checked)}
                      type="checkbox"
                    />
                    <small>{file.persistent ? "Kept for future services" : "This service only"}</small>
                  </label>
                  <button
                    className="danger-button"
                    disabled={fillerMediaBusy}
                    onClick={() => void removeFillerMedia(file)}
                    type="button"
                  >
                    Remove
                  </button>
                </article>
              ))}
              {!fillerMediaImageFiles.length ? (
                <p className="empty-state">The standard LCF background is currently used.</p>
              ) : null}
              {!fillerMediaEditorReady ? <p className="search-empty">Loading attached image previews…</p> : null}
            </div>
            </details>
            <label className="inline-checkbox template-save-choice"><input type="checkbox" disabled={fillerMediaBusy} checked={saveItemTemplate} onChange={(event) => setSaveItemTemplate(event.target.checked)} /><span>Save configuration to {currentPlanType?.name ?? "service"} template <small>{saveItemTemplate ? "Future services use these settings." : "This service only."}</small></span></label>
            <div className="app-dialog-actions">
              <button
                className="text-button"
                disabled={fillerMediaBusy}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  closePlanItemEditor();
                }}
                type="button"
              >Cancel</button>
              <button
                className="primary-button"
                disabled={fillerMediaBusy || !(itemEditDraft.title.trim() || itemEditDraft.overlay_text.trim())}
                onClick={() => void savePlanItemDetails()}
                type="button"
              >{fillerMediaBusy ? "Saving…" : "Save"}</button>
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
