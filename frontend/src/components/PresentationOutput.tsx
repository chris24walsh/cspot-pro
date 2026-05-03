import { Maximize2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getFileSlides, getPlan, getSongs, type PlanDetail, type RenderedSlide, type Song } from "../api";
import {
  PRESENTATION_CHANNEL,
  PRESENTATION_STORAGE_KEY,
  buildPresentationSlides,
  presentationTypeClass,
  type PresentationLiveState,
} from "../presentation";
import { ScaledSlideImage } from "./ScaledSlideImage";

function readLiveState(): PresentationLiveState | null {
  const value = localStorage.getItem(PRESENTATION_STORAGE_KEY);
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as PresentationLiveState;
  } catch {
    return null;
  }
}

export function PresentationOutput() {
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [liveState, setLiveState] = useState<PresentationLiveState | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const planId = params.get("planId");
    const index = Number(params.get("index") ?? "0");
    return planId ? { planId, index, updatedAt: Date.now() } : readLiveState();
  });
  const [message, setMessage] = useState<string | null>(null);
  const [fullscreenReady, setFullscreenReady] = useState(true);
  const [renderedSlidesByFileId, setRenderedSlidesByFileId] = useState<Record<string, RenderedSlide[]>>({});
  const [blanked, setBlanked] = useState(false);

  const slides = useMemo(
    () => buildPresentationSlides(plan?.items ?? [], songs, renderedSlidesByFileId),
    [plan, songs, renderedSlidesByFileId],
  );
  const liveSlide = slides[liveState?.index ?? 0] ?? null;

  const load = useCallback(async (state: PresentationLiveState | null) => {
    if (!state?.planId) {
      return;
    }

    try {
      const [nextPlan, nextSongs] = await Promise.all([getPlan(state.planId), getSongs()]);
      setPlan(nextPlan);
      setSongs(nextSongs);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load slideshow output.");
    }
  }, []);

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
      setFullscreenReady(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Use the browser fullscreen control for this display.");
    }
  }

  async function exitFullscreen() {
    if (!document.fullscreenElement) {
      setFullscreenReady(true);
      return;
    }
    try {
      await document.exitFullscreen();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not exit fullscreen.");
    } finally {
      setFullscreenReady(true);
    }
  }

  useEffect(() => {
    void load(liveState);
  }, [liveState?.planId, load]);

  useEffect(() => {
    setBlanked(Boolean(liveState?.blanked));
  }, [liveState?.blanked]);

  useEffect(() => {
    async function loadRenderedDecks() {
      const files = (plan?.items ?? []).flatMap((item) => item.files ?? []);
      const uniqueFiles = Array.from(new Map(files.map((file) => [file.file_id, file])).values());
      const nextSlides: Record<string, RenderedSlide[]> = {};

      await Promise.all(
        uniqueFiles.map(async (file) => {
          try {
            nextSlides[file.file_id] = await getFileSlides(file.file_id);
          } catch {
            nextSlides[file.file_id] = [];
          }
        }),
      );

      setRenderedSlidesByFileId(nextSlides);
    }

    void loadRenderedDecks();
  }, [plan]);

  useEffect(() => {
    const channel = new BroadcastChannel(PRESENTATION_CHANNEL);

    channel.onmessage = (event: MessageEvent<PresentationLiveState>) => {
      setLiveState(event.data);
    };

    function onStorage(event: StorageEvent) {
      if (event.key === PRESENTATION_STORAGE_KEY) {
        setLiveState(readLiveState());
      }
    }

    window.addEventListener("storage", onStorage);
    return () => {
      channel.close();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    function onFullscreenChange() {
      setFullscreenReady(!document.fullscreenElement);
    }

    async function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (editing) {
        return;
      }

      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        if (document.fullscreenElement) {
          await exitFullscreen();
        } else {
          await enterFullscreen();
        }
        return;
      }

      if (event.key === "Escape") {
        if (blanked) {
          event.preventDefault();
          setBlanked(false);
        }
        if (document.fullscreenElement) {
          event.preventDefault();
          await exitFullscreen();
        }
        return;
      }

      if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        setBlanked((current) => !current);
      }
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [blanked]);

  useEffect(() => {
    async function syncFullscreenMode() {
      if (liveState?.fullscreen) {
        if (!document.fullscreenElement) {
          await enterFullscreen();
        }
        return;
      }

      if (document.fullscreenElement) {
        await exitFullscreen();
      }
    }

    void syncFullscreenMode();
  }, [liveState?.fullscreen]);

  return (
    <main className="slideshow-output" aria-label="Live slideshow output">
      {fullscreenReady ? (
        <button className="slideshow-fullscreen" onClick={() => void enterFullscreen()} type="button">
          <Maximize2 size={18} aria-hidden="true" />
          Fullscreen
        </button>
      ) : null}

      {message ? <p className="slideshow-message">{message}</p> : null}

      <section
        className={`slideshow-stage ${liveSlide?.imageUrl ? "slideshow-stage-image" : ""} stage-theme-${
          liveState?.theme ?? "light"
        } ${liveSlide ? presentationTypeClass(liveSlide.itemType) : "type-generic"} ${blanked ? "stage-blanked" : ""}`}
      >
        {blanked ? null : !liveSlide?.imageUrl && liveSlide?.itemType !== "song" ? (
          <div className="stage-title">
            <span>{liveSlide?.title ?? "Ready"}</span>
          </div>
        ) : null}
        {blanked ? (
          <div className="blank-stage" aria-label="Blank live output" />
        ) : liveSlide?.imageUrl ? (
          <ScaledSlideImage alt={liveSlide.title} src={liveSlide.imageUrl} />
        ) : (
          <pre>{liveSlide?.text ?? "Waiting for slideshow"}</pre>
        )}
      </section>
    </main>
  );
}
