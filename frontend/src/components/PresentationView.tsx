import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MonitorUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  createPlanItem,
  attachItemFile,
  deletePlanItem,
  getFileSlides,
  getBibleBooks,
  getBiblePassage,
  searchBible,
  getBibleVersions,
  getPlan,
  getPlans,
  getPresentationLiveState,
  getSongs,
  uploadStoredFile,
  updatePresentationLiveState,
  updatePlanItem,
  type BibleBook,
  type BibleSearchHit,
  type BibleVersion,
  type PresentationLiveSyncState,
  type RenderedSlide,
  type PlanDetail,
  type PlanSummary,
  type Song,
} from "../api";
import {
  PRESENTATION_CHANNEL,
  PRESENTATION_STORAGE_KEY,
  buildPresentationSections,
  buildPresentationSlides,
  presentationTypeClass,
  resolveLiveIndex,
  type PresentationSlide,
  type PresentationLiveState,
  type PresentationTheme,
} from "../presentation";
import { ScaledSlideImage } from "./ScaledSlideImage";

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

type InsertDialogMode = "choose" | "song" | "deck" | "bible";
type SearchOverlayMode = "reference" | "keyword" | "songs";
type LoadOptions = {
  preserveLocation?: {
    planItemId: string;
    slideOffset: number;
  };
  silent?: boolean;
};

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

function FittedSlideText({ text, compact = false }: { text: string; compact?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLPreElement>(null);
  const [fontSize, setFontSize] = useState(compact ? 9 : 28);

  useLayoutEffect(() => {
    const textElement = textRef.current;
    const container = containerRef.current;
    if (!textElement || !container) {
      return;
    }

    function fit() {
      if (!textElement || !container) {
        return;
      }

      let low = compact ? 5 : 12;
      let high = compact ? 16 : 52;

      for (let step = 0; step < 10; step += 1) {
        const mid = (low + high) / 2;
        textElement.style.fontSize = `${mid}px`;

        if (
          textElement.scrollHeight <= container.clientHeight &&
          textElement.scrollWidth <= container.clientWidth
        ) {
          low = mid;
        } else {
          high = mid;
        }
      }

      setFontSize(Math.floor(low));
    }

    const frame = window.requestAnimationFrame(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [compact, text]);

  return (
    <div className="fit-slide-box" ref={containerRef}>
      <pre className="fit-slide-text" ref={textRef} style={{ fontSize }}>
        {text}
      </pre>
    </div>
  );
}

function renderMiniSlide(slide: PresentationSlide | null, fallback: string, theme: PresentationTheme) {
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
      ) : (
        <FittedSlideText compact text={slide.text} />
      )}
    </div>
  );
}

export function PresentationView({
  canAttachDeck,
  canEditPlan,
}: {
  canAttachDeck: boolean;
  canEditPlan: boolean;
}) {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveIndex, setLiveIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [screens, setScreens] = useState<PresentationScreen[]>([]);
  const [selectedScreenIndex, setSelectedScreenIndex] = useState(0);
  const [deckTitle, setDeckTitle] = useState("Sermon");
  const [deckType, setDeckType] = useState("sermon");
  const [deckFile, setDeckFile] = useState<File | null>(null);
  const [selectedSongId, setSelectedSongId] = useState("");
  const [insertDialog, setInsertDialog] = useState<{ afterIndex: number; mode: InsertDialogMode } | null>(null);
  const [pendingRemoveSection, setPendingRemoveSection] = useState<{ id: string; title: string } | null>(null);
  const [renderedSlidesByFileId, setRenderedSlidesByFileId] = useState<Record<string, RenderedSlide[]>>({});
  const [renderingFileIds, setRenderingFileIds] = useState<string[]>([]);
  const [renderErrorsByFileId, setRenderErrorsByFileId] = useState<Record<string, string>>({});
  const [bibleVersions, setBibleVersions] = useState<BibleVersion[]>([]);
  const [bibleBooks, setBibleBooks] = useState<BibleBook[]>([]);
  const [bibleVersion, setBibleVersion] = useState("KJV");
  const [bibleBook, setBibleBook] = useState("John");
  const [bibleChapter, setBibleChapter] = useState("3");
  const [bibleVerseFrom, setBibleVerseFrom] = useState("16");
  const [bibleVerseTo, setBibleVerseTo] = useState("");
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchOverlayMode>("reference");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BibleSearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [slideTheme, setSlideTheme] = useState<PresentationTheme>("light");
  const [liveBlanked, setLiveBlanked] = useState(false);
  const [liveFullscreen, setLiveFullscreen] = useState(false);
  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const outputWindowRef = useRef<Window | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const thumbnailRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const currentLiveStateRef = useRef<PresentationLiveState | null>(null);
  const lastLiveStateRef = useRef<number>(0);
  const suppressPublishRef = useRef(false);

  const sections = useMemo(
    () => buildPresentationSections(plan?.items ?? [], songs, renderedSlidesByFileId),
    [plan, songs, renderedSlidesByFileId],
  );
  const slides = useMemo(
    () => buildPresentationSlides(plan?.items ?? [], songs, renderedSlidesByFileId),
    [plan, songs, renderedSlidesByFileId],
  );
  const liveSlide = slides[liveIndex] ?? null;
  const currentPlanItem = (plan?.items ?? []).find((item) => item.id === liveSlide?.planItemId) ?? null;

  function clearHotkeyButtonFocus() {
    const active = document.activeElement;
    if (!(active instanceof HTMLButtonElement)) {
      return;
    }
    if (active.closest(".presenter-controls")) {
      active.blur();
    }
  }

  function buildLiveState(nextIndex: number, overrides: Partial<PresentationLiveState> = {}): PresentationLiveState | null {
    if (!plan) {
      return null;
    }

    const slide = slides[Math.min(Math.max(nextIndex, 0), Math.max(slides.length - 1, 0))] ?? null;
    const slideOffset = slide
      ? slides.filter((candidate) => candidate.planItemId === slide.planItemId).findIndex((candidate) => candidate.id === slide.id)
      : 0;

    return {
      planId: plan.id,
      index: nextIndex,
      updatedAt: overrides.updatedAt ?? Date.now(),
      planItemId: overrides.planItemId ?? slide?.planItemId ?? null,
      slideOffset: overrides.slideOffset ?? Math.max(slideOffset, 0),
      theme: overrides.theme ?? slideTheme,
      blanked: overrides.blanked ?? liveBlanked,
      fullscreen: overrides.fullscreen ?? liveFullscreen,
    };
  }

  function applyRemoteLiveState(state: PresentationLiveState) {
    currentLiveStateRef.current = state;
    suppressPublishRef.current = true;
    lastLiveStateRef.current = state.updatedAt;
    setSlideTheme(state.theme ?? "light");
    setLiveBlanked(Boolean(state.blanked));
    setLiveFullscreen(Boolean(state.fullscreen));
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
      const [nextPlans, nextSongs] = await Promise.all([getPlans(), getSongs()]);
      const requestedPlanId = planId || selectedPlanId;
      const targetPlanId = nextPlans.some((candidate) => candidate.id === requestedPlanId)
        ? requestedPlanId
        : nextPlans[0]?.id ?? "";
      const [targetPlan, liveState] = await Promise.all([
        targetPlanId ? getPlan(targetPlanId) : Promise.resolve(null),
        targetPlanId ? getPresentationLiveState(targetPlanId) : Promise.resolve(null),
      ]);
      setPlans(nextPlans);
      setSongs(nextSongs);
      setSelectedPlanId(targetPlanId);
      setPlan(targetPlan);
      const nextSlides = buildPresentationSlides(targetPlan?.items ?? [], nextSongs, renderedSlidesByFileId);
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
        setLiveFullscreen(Boolean(preservedState.fullscreen));
        localStorage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify(preservedState));
      }
      setLiveIndex(preservedIndex >= 0 ? preservedIndex : 0);
    } catch (error) {
      setPlan(null);
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

  async function publishLiveState(nextIndex: number, overrides: Partial<PresentationLiveState> = {}) {
    const state = buildLiveState(nextIndex, overrides);
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
      });
      lastLiveStateRef.current = synced.updated_at;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sync presentation state.");
    }
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
    setSlideshowOpen(true);
    outputWindow.focus();
  }

  async function selectPlan(planId: string) {
    await load(planId);
  }

  function orderedPlanItems() {
    return [...(plan?.items ?? [])].sort((first, second) => {
      const firstSequence = Number.parseFloat(first.sequence) || 0;
      const secondSequence = Number.parseFloat(second.sequence) || 0;
      return firstSequence - secondSequence;
    });
  }

  function sequenceForInsert(afterIndex: number) {
    const orderedItems = orderedPlanItems();
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

  function activeSectionInsertIndex() {
    if (!liveSlide) {
      return sections.length - 1;
    }
    return sections.findIndex((section) => section.id === liveSlide.sectionId);
  }

  function openInsertDialog(afterIndex: number) {
    if (!canEditPlan) {
      setMessage("You can present this plan, but only service leaders and worship leaders can change the running order.");
      return;
    }
    setSelectedSongId((current) => current || songs[0]?.id || "");
    setInsertDialog({ afterIndex, mode: "choose" });
  }

  function closeInsertDialog() {
    setInsertDialog(null);
  }

  function closeSearchOverlay() {
    setSearchOverlayOpen(false);
    setSearchLoading(false);
    setSearchResults([]);
    setSearchQuery("");
  }

  async function insertSongById(songId: string, afterIndex: number) {
    if (!plan) {
      setMessage("Select a plan before adding a song.");
      return;
    }
    if (!canEditPlan) {
      setMessage("Only service leaders and worship leaders can add songs to the running order.");
      return;
    }

    const song = songs.find((candidate) => candidate.id === songId);
    if (!song) {
      setMessage("Choose a song first.");
      return;
    }

    await createPlanItem(plan.id, {
      item_type: "song",
      sequence: sequenceForInsert(afterIndex),
      title: song.title,
      comment: null,
      key_signature: null,
      song_id: song.id,
    });
  }

  async function insertBibleResult(result: BibleSearchHit, afterIndex: number) {
    if (!plan) {
      setMessage("Select a plan before adding Scripture.");
      return;
    }
    if (!canEditPlan) {
      setMessage("Only service leaders and worship leaders can add Scripture to the running order.");
      return;
    }
    await createPlanItem(plan.id, {
      item_type: "reading",
      sequence: sequenceForInsert(afterIndex),
      title: result.reference,
      comment: result.text,
      key_signature: result.version,
      song_id: null,
    });
  }

  async function navigateBibleReading(mode: "verse" | "chapter", delta: -1 | 1) {
    if (!plan || !currentPlanItem || currentPlanItem.item_type !== "reading") {
      return;
    }
    if (!canEditPlan) {
      setMessage("Bible passage navigation updates the plan, so it is only available to service leaders and worship leaders.");
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

      const preferredStarts = [currentReference.verseFrom, 1];
      for (const verseFrom of preferredStarts) {
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
      setBibleVersion(versionCode);
      await load(plan.id, {
        preserveLocation: {
          planItemId: currentPlanItem.id,
          slideOffset: currentSlideOffset,
        },
        silent: true,
      });
      void publishLiveState(liveIndex);
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
      const stored = await uploadStoredFile({
        file: deckFile,
        display_name: deckTitle || deckFile.name,
      });
      const item = await createPlanItem(plan.id, {
        item_type: deckType,
        sequence: sequenceForInsert(insertDialog?.afterIndex ?? sections.length - 1),
        title: deckTitle || deckFile.name,
        comment: `Attached slide deck: ${stored.display_name}`,
        key_signature: null,
        song_id: null,
      });
      await attachItemFile(item.id, { file_id: stored.id, sort_order: 0 });
      setDeckFile(null);
      closeInsertDialog();
      await load(plan.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not attach slide deck.");
    }
  }

  async function addSongToPlan() {
    if (!plan || !canEditPlan) {
      return;
    }
    try {
      await insertSongById(selectedSongId, insertDialog?.afterIndex ?? sections.length - 1);
      closeInsertDialog();
      await load(plan.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add song.");
    }
  }

  async function removeSection(sectionId: string) {
    if (!plan || !canEditPlan) {
      return;
    }

    try {
      await deletePlanItem(sectionId);
      setPendingRemoveSection(null);
      await load(plan.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove section.");
    }
  }

  async function moveSection(sectionId: string, delta: -1 | 1) {
    if (!plan || !canEditPlan) {
      return;
    }

    const orderedItems = orderedPlanItems();
    const itemIndex = orderedItems.findIndex((item) => item.id === sectionId);
    const target = orderedItems[itemIndex + delta];
    const item = orderedItems[itemIndex];
    if (!item || !target) {
      return;
    }

    try {
      await Promise.all([
        updatePlanItem(item.id, { sequence: target.sequence }),
        updatePlanItem(target.id, { sequence: item.sequence }),
      ]);
      await load(plan.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reorder section.");
    }
  }

  async function addBiblePassageSlide() {
    if (!plan) {
      setMessage("Select a plan before adding Scripture.");
      return;
    }
    if (!canEditPlan) {
      setMessage("Only service leaders and worship leaders can add Scripture slides.");
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
      await insertBibleResult(
        {
          version: passage.version,
          reference: passage.reference,
          text: passage.text,
          book: bibleBook,
          chapter: Number(bibleChapter),
          verse_from: Number(bibleVerseFrom),
          verse_to: bibleVerseTo ? Number(bibleVerseTo) : Number(bibleVerseFrom),
        },
        insertDialog?.afterIndex ?? sections.length - 1,
      );
      await load(plan.id);
      closeInsertDialog();
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
    void load();
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
    async function loadRenderedDecks() {
      const files = (plan?.items ?? []).flatMap((item) => item.files ?? []);
      const uniqueFiles = Array.from(new Map(files.map((file) => [file.file_id, file])).values());
      const nextSlides: Record<string, RenderedSlide[]> = {};
      const nextErrors: Record<string, string> = {};
      setRenderingFileIds(uniqueFiles.map((file) => file.file_id));

      await Promise.all(
        uniqueFiles.map(async (file) => {
          try {
            nextSlides[file.file_id] = await getFileSlides(file.file_id);
          } catch (error) {
            nextSlides[file.file_id] = [];
            nextErrors[file.file_id] = error instanceof Error ? error.message : "Could not render this slide deck.";
          }
        }),
      );

      setRenderedSlidesByFileId(nextSlides);
      setRenderErrorsByFileId(nextErrors);
      setRenderingFileIds([]);
    }

    void loadRenderedDecks();
  }, [plan]);

  useEffect(() => {
    if (!message) {
      return;
    }
    const timer = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    channelRef.current = new BroadcastChannel(PRESENTATION_CHANNEL);
    return () => channelRef.current?.close();
  }, []);

  useEffect(() => {
    if (!selectedPlanId) {
      return;
    }

    const timer = window.setInterval(() => {
      void (async () => {
        try {
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
          });
        } catch {
          // Keep local presentation usable even if sync polling fails briefly.
        }
      })();
    }, 1200);

    return () => window.clearInterval(timer);
  }, [selectedPlanId, slides]);

  useEffect(() => {
    if (!currentLiveStateRef.current || currentLiveStateRef.current.planId !== selectedPlanId) {
      return;
    }

    setLiveIndex(resolveLiveIndex(slides, currentLiveStateRef.current));
  }, [selectedPlanId, slides]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (outputWindowRef.current && outputWindowRef.current.closed) {
        outputWindowRef.current = null;
        setSlideshowOpen(false);
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (suppressPublishRef.current) {
      suppressPublishRef.current = false;
      return;
    }
    void publishLiveState(liveIndex);
  }, [liveBlanked, liveFullscreen, slideTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const activeSlide = slides[liveIndex];
    if (!activeSlide) {
      return;
    }

    thumbnailRefs.current[activeSlide.id]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [liveIndex, slides]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (event.key === "Escape" && searchOverlayOpen) {
        event.preventDefault();
        closeSearchOverlay();
        return;
      }
      if ((event.key === "s" || event.key === "S") && !editing) {
        event.preventDefault();
        setSearchOverlayOpen(true);
        return;
      }
      if (editing || searchOverlayOpen) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        clearHotkeyButtonFocus();
        moveLive(1);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        clearHotkeyButtonFocus();
        moveLive(-1);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        clearHotkeyButtonFocus();
        if (currentPlanItem?.item_type === "reading" && canEditPlan) {
          void navigateBibleReading("verse", 1);
        } else {
          moveLive(1);
        }
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        clearHotkeyButtonFocus();
        if (currentPlanItem?.item_type === "reading" && canEditPlan) {
          void navigateBibleReading("verse", -1);
        } else {
          moveLive(-1);
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
        setLiveFullscreen((current) => !current);
        return;
      }
      if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        clearHotkeyButtonFocus();
        setLiveBlanked((current) => !current);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clearHotkeyButtonFocus();
        setLiveBlanked(false);
        setLiveFullscreen(false);
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

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEditPlan, currentPlanItem, liveIndex, plan, screens, searchOverlayOpen, selectedScreenIndex, slides, sections]);

  async function runBibleSearch(mode: "reference" | "keyword") {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    try {
      const results = await searchBible({
        q: query,
        version_code: bibleVersion || "KJV",
        search_type: mode,
        limit: mode === "keyword" ? 20 : 5,
      });
      setSearchResults(results);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not search Bible.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  return (
    <section className="presentation-workspace" aria-label="Presentation preview">
      {message ? <p className="form-message presentation-message">{message}</p> : null}
      {!canEditPlan ? (
        <p className="empty-state presentation-readonly-note">
          Presenter mode is live, but this account is read-only for plan changes.
        </p>
      ) : null}

      <div className="presenter-console">
        <div className="presenter-stage-column">
          <label className="presenter-plan-picker">
            Plan
            <select
              disabled={loading || !plans.length}
              onChange={(event) => void selectPlan(event.target.value)}
              value={selectedPlanId}
            >
              {!plans.length ? <option value="">No plans available</option> : null}
              {plans.map((planSummary) => (
                <option key={planSummary.id} value={planSummary.id}>
                  {planSummary.title}
                </option>
              ))}
            </select>
          </label>

          <div
            className={`stage-shell stage-shell-live presenter-current stage-theme-${slideTheme} ${
              liveSlide ? presentationTypeClass(liveSlide.itemType) : "type-generic"
            }`}
          >
            <div className="stage-meta">
              <span>Current · {plan?.title ?? "Presentation"}</span>
              <div className="stage-meta-actions">
                <label className="stage-theme-switch" title="Toggle slide theme">
                  <input
                    checked={slideTheme === "light"}
                    onChange={(event) => setSlideTheme(event.target.checked ? "light" : "dark")}
                    type="checkbox"
                  />
                  <span className="stage-theme-slider" aria-hidden="true" />
                </label>
                <span>
                  {(liveIndex + 1).toString().padStart(2, "0")} / {slides.length.toString().padStart(2, "0")}
                </span>
              </div>
            </div>
            <div className={`presentation-stage ${liveSlide?.imageUrl ? "presentation-stage-image" : ""}`}>
              {liveSlide?.imageUrl || liveSlide?.itemType === "song" ? null : (
                <div className="stage-title">
                  <span>{liveSlide?.title ?? "Ready"}</span>
                </div>
              )}
              {liveSlide?.imageUrl ? (
                <ScaledSlideImage alt={liveSlide.title} src={liveSlide.imageUrl} />
              ) : (
                <FittedSlideText text={liveSlide?.text ?? "No live slide selected"} />
              )}
            </div>
          </div>

          <div className="presenter-controls">
            <div className="action-row">
              <button className="text-button" disabled={loading || !plan} onClick={() => moveLive(-1)} type="button">
                <ChevronLeft size={16} aria-hidden="true" />
                Previous
              </button>
              <button className="text-button" disabled={loading || !plan} onClick={() => moveLive(1)} type="button">
                Next
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <button className="primary-button" disabled={loading || !plan} onClick={() => void startSlideshow()} type="button">
                <MonitorUp size={16} aria-hidden="true" />
                {slideshowOpen ? "Close Slideshow" : "Start Slideshow"}
              </button>
            </div>
            {currentPlanItem?.item_type === "reading" ? (
              <div className="action-row bible-nav-row">
                <button className="text-button" disabled={!canEditPlan} onClick={() => void navigateBibleReading("verse", -1)} type="button">
                  Prev Verse
                </button>
                <button className="text-button" disabled={!canEditPlan} onClick={() => void navigateBibleReading("verse", 1)} type="button">
                  Next Verse
                </button>
                <button className="text-button" disabled={!canEditPlan} onClick={() => void navigateBibleReading("chapter", -1)} type="button">
                  Prev Chapter
                </button>
                <button className="text-button" disabled={!canEditPlan} onClick={() => void navigateBibleReading("chapter", 1)} type="button">
                  Next Chapter
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="presenter-sidebar" aria-label="Slide context">
          <div className="slide-grid" aria-label="All slides">
            {sections.map((section) => {
              const sectionStart = slides.findIndex((slide) => slide.sectionId === section.id);
              const sectionItem = (plan?.items ?? []).find((item) => item.id === section.id);
              const sectionRenderError = sectionItem?.files
                ?.map((file) => renderErrorsByFileId[file.file_id])
                .find(Boolean);
              return (
                <div className="section-slide-group" key={section.id}>
                  <div className="section-jump-row">
                    <button
                      className={`section-jump ${presentationTypeClass(section.itemType)} ${
                        liveSlide?.sectionId === section.id ? "active" : ""
                      }`}
                      onClick={() => setLiveSlide(sectionStart)}
                      type="button"
                    >
                      <span>{section.itemType}</span>
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
                  </div>
                  {sectionRenderError ? <p className="render-error-message">{sectionRenderError}</p> : null}
                  <div className="section-slide-list">
                    {section.slides.map((slide) => {
                      const slideIndex = slides.findIndex((candidate) => candidate.id === slide.id);
                      return (
                        <button
                          className={`slide-tile preview-tile ${presentationTypeClass(slide.itemType)} ${
                            slideIndex === liveIndex ? "active" : ""
                          }`}
                          key={slide.id}
                          onClick={() => setLiveSlide(slideIndex)}
                          ref={(element) => {
                            thumbnailRefs.current[slide.id] = element;
                          }}
                          type="button"
                          title={`${slideIndex + 1}. ${slide.title}`}
                        >
                          <span>{(slideIndex + 1).toString().padStart(2, "0")}</span>
                          {renderMiniSlide(slide, "Empty", slideTheme)}
                          <div className="thumbnail-menu">
                            <span>Go</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <aside className="section-rail" aria-label="Sections">
          <div className="section-rail-title">Sections</div>
          <div className="section-rail-list">
            <button
              aria-label="Add section at the start"
              className="section-insert-button"
              disabled={!canEditPlan}
              onClick={() => openInsertDialog(-1)}
              type="button"
            >
              <Plus size={14} aria-hidden="true" />
            </button>
            {sections.map((section, sectionIndex) => {
              const sectionStart = slides.findIndex((slide) => slide.sectionId === section.id);
              return (
                <div key={section.id} className="section-rail-block">
                  <div
                    className={`section-rail-item ${presentationTypeClass(section.itemType)} ${
                      liveSlide?.sectionId === section.id ? "active" : ""
                    }`}
                  >
                    <button
                      className="section-rail-jump"
                      onClick={() => setLiveSlide(sectionStart)}
                      type="button"
                      title={section.title}
                    >
                      <span>{(sectionIndex + 1).toString().padStart(2, "0")}</span>
                      <strong>{section.title}</strong>
                    </button>
                    <div className="section-actions">
                      <button
                        aria-label={`Move ${section.title} up`}
                        className="section-icon-button"
                        disabled={!canEditPlan || sectionIndex === 0}
                        onClick={() => void moveSection(section.id, -1)}
                        type="button"
                      >
                        <ChevronUp size={14} aria-hidden="true" />
                      </button>
                      <button
                        aria-label={`Move ${section.title} down`}
                        className="section-icon-button"
                        disabled={!canEditPlan || sectionIndex === sections.length - 1}
                        onClick={() => void moveSection(section.id, 1)}
                        type="button"
                      >
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                      <button
                        aria-label={`Remove ${section.title}`}
                        className="section-icon-button section-remove-button"
                        disabled={!canEditPlan}
                        onClick={() => setPendingRemoveSection({ id: section.id, title: section.title })}
                        type="button"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <button
                    aria-label={`Add section after ${section.title}`}
                    className="section-insert-button"
                    disabled={!canEditPlan}
                    onClick={() => openInsertDialog(sectionIndex)}
                    type="button"
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
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
              <h2 id="search-overlay-title">Search</h2>
              <p>Reference, keyword, or song search. Press `Esc` to close.</p>
            </div>

            <div className="insert-choice-grid search-mode-grid">
              <button
                className={`text-button ${searchMode === "reference" ? "active-choice" : ""}`}
                onClick={() => {
                  setSearchMode("reference");
                  setSearchResults([]);
                }}
                type="button"
              >
                Reference
              </button>
              <button
                className={`text-button ${searchMode === "keyword" ? "active-choice" : ""}`}
                onClick={() => {
                  setSearchMode("keyword");
                  setSearchResults([]);
                }}
                type="button"
              >
                Keyword
              </button>
              <button
                className={`text-button ${searchMode === "songs" ? "active-choice" : ""}`}
                onClick={() => {
                  setSearchMode("songs");
                  setSearchResults([]);
                }}
                type="button"
              >
                Songs
              </button>
            </div>

            <div className="dialog-form-grid">
              {searchMode !== "songs" ? (
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
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && searchMode !== "songs") {
                      event.preventDefault();
                      void runBibleSearch(searchMode);
                    }
                  }}
                  placeholder={
                    searchMode === "reference" ? "John 3 16" : searchMode === "keyword" ? "shepherd" : "Amazing Grace"
                  }
                  value={searchQuery}
                />
              </label>
            </div>

            {searchMode !== "songs" ? (
              <div className="app-dialog-actions">
                <button className="text-button" onClick={closeSearchOverlay} type="button">
                  Close
                </button>
                <button className="primary-button" onClick={() => void runBibleSearch(searchMode)} type="button">
                  Search
                </button>
              </div>
            ) : null}

            <div className="search-results-list">
              {searchLoading ? <p className="search-empty">Searching…</p> : null}
              {!searchLoading && searchMode === "songs"
                ? songs
                    .filter((song) =>
                      !searchQuery.trim()
                        ? true
                        : `${song.title} ${song.author ?? ""}`.toLowerCase().includes(searchQuery.trim().toLowerCase()),
                    )
                    .slice(0, 20)
                    .map((song) => (
                      <button
                        className="search-result-card"
                        disabled={!canEditPlan}
                        key={song.id}
                        onClick={() => {
                          void insertSongById(song.id, activeSectionInsertIndex())
                            .then(async () => {
                              await load(plan?.id);
                              closeSearchOverlay();
                            })
                            .catch((error: unknown) => {
                              setMessage(error instanceof Error ? error.message : "Could not add song.");
                            });
                        }}
                        type="button"
                      >
                        <strong>{song.title}</strong>
                        <span>{song.author ?? "Song"}</span>
                      </button>
                    ))
                : null}
              {!searchLoading && searchMode !== "songs"
                ? searchResults.map((result) => (
                    <button
                      className="search-result-card"
                      disabled={!canEditPlan}
                      key={`${result.version}:${result.reference}:${result.verse_from}`}
                      onClick={() => {
                        void insertBibleResult(result, activeSectionInsertIndex())
                          .then(async () => {
                            await load(plan?.id);
                            closeSearchOverlay();
                          })
                          .catch((error: unknown) => {
                            setMessage(error instanceof Error ? error.message : "Could not add Scripture.");
                          });
                      }}
                      type="button"
                    >
                      <strong>{result.reference}</strong>
                      <span>{result.text}</span>
                    </button>
                  ))
                : null}
              {!searchLoading &&
              ((searchMode === "songs" &&
                songs.filter((song) =>
                  !searchQuery.trim()
                    ? true
                    : `${song.title} ${song.author ?? ""}`.toLowerCase().includes(searchQuery.trim().toLowerCase()),
                ).length === 0) ||
                (searchMode !== "songs" && searchQuery.trim() && searchResults.length === 0)) ? (
                <p className="search-empty">No matches yet.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {insertDialog ? (
        <div className="app-dialog-backdrop" role="presentation">
          <div
            aria-labelledby="insert-section-title"
            aria-modal="true"
            className="app-dialog app-dialog-wide"
            role="dialog"
          >
            <div>
              <h2 id="insert-section-title">Add To Service</h2>
              <p>Choose what to insert at this point in the order.</p>
            </div>

            {insertDialog.mode === "choose" ? (
              <div className="insert-choice-grid">
                <button className="text-button" onClick={() => setInsertDialog({ ...insertDialog, mode: "song" })} type="button">
                  Song
                </button>
                <button className="text-button" onClick={() => setInsertDialog({ ...insertDialog, mode: "bible" })} type="button">
                  Bible Passage
                </button>
                <button className="text-button" onClick={() => setInsertDialog({ ...insertDialog, mode: "deck" })} type="button">
                  Slide Deck
                </button>
              </div>
            ) : null}

            {insertDialog.mode === "song" ? (
              <div className="dialog-form-grid">
                <label>
                  Song
                  <select onChange={(event) => setSelectedSongId(event.target.value)} value={selectedSongId}>
                    {!songs.length ? <option value="">No songs available</option> : null}
                    {songs.map((song) => (
                      <option key={song.id} value={song.id}>
                        {song.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            {insertDialog.mode === "bible" ? (
              <div className="scripture-grid dialog-scripture-grid">
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
                <label>
                  Book
                  <select onChange={(event) => setBibleBook(event.target.value)} value={bibleBook}>
                    {bibleBooks.map((book) => (
                      <option key={book.id} value={book.name}>
                        {book.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Ch
                  <input onChange={(event) => setBibleChapter(event.target.value)} type="number" value={bibleChapter} />
                </label>
                <label>
                  From
                  <input onChange={(event) => setBibleVerseFrom(event.target.value)} type="number" value={bibleVerseFrom} />
                </label>
                <label>
                  To
                  <input onChange={(event) => setBibleVerseTo(event.target.value)} type="number" value={bibleVerseTo} />
                </label>
              </div>
            ) : null}

            {insertDialog.mode === "deck" ? (
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
                  <input disabled={!canAttachDeck} onChange={(event) => setDeckTitle(event.target.value)} value={deckTitle} />
                </label>
                <label>
                  Type
                  <select disabled={!canAttachDeck} onChange={(event) => setDeckType(event.target.value)} value={deckType}>
                    <option value="sermon">Sermon</option>
                    <option value="welcome">Welcome</option>
                    <option value="reading">Reading</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>
              </div>
            ) : null}

            <div className="app-dialog-actions">
              {insertDialog.mode !== "choose" ? (
                <button className="text-button" onClick={() => setInsertDialog({ ...insertDialog, mode: "choose" })} type="button">
                  Back
                </button>
              ) : null}
              <button className="text-button" onClick={closeInsertDialog} type="button">
                Cancel
              </button>
              {insertDialog.mode === "song" ? (
                <button className="primary-button" disabled={!canEditPlan || !selectedSongId} onClick={() => void addSongToPlan()} type="button">
                  Add Song
                </button>
              ) : null}
              {insertDialog.mode === "bible" ? (
                <button className="primary-button" disabled={!canEditPlan} onClick={() => void addBiblePassageSlide()} type="button">
                  Add Passage
                </button>
              ) : null}
              {insertDialog.mode === "deck" ? (
                <button className="primary-button" disabled={!canAttachDeck} onClick={() => void attachDeckToPlan()} type="button">
                  Add Deck
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {pendingRemoveSection ? (
        <div className="app-dialog-backdrop" role="presentation">
          <div
            aria-labelledby="remove-section-title"
            aria-modal="true"
            className="app-dialog"
            role="dialog"
          >
            <div>
              <h2 id="remove-section-title">Remove Section</h2>
              <p>Remove "{pendingRemoveSection.title}" from this plan?</p>
            </div>
            <div className="app-dialog-actions">
              <button
                className="text-button"
                onClick={() => setPendingRemoveSection(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="danger-button"
                onClick={() => void removeSection(pendingRemoveSection.id)}
                type="button"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
