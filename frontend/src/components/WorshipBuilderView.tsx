import { ChevronDown, ChevronUp, ListPlus, MonitorUp, Music2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createPlanItem,
  deletePlanItem,
  getPlan,
  getPlans,
  getSongs,
  updatePlanItem,
  type PlanDetail,
  type PlanItem,
  type PlanSummary,
  type Song,
} from "../api";
import { buildPresentationSections, suggestSlideGroupFontCap } from "../presentation";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { MusicianLiveView } from "./MusicianLiveView";

interface WorshipBuilderViewProps {
  canEditPlan: boolean;
}

function formatServiceDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "No date"
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" });
}

function songStatus(song: Pick<Song, "lyrics" | "chords"> | null | undefined) {
  if (!song?.lyrics?.trim()) {
    return "needs lyrics";
  }
  if (!song.chords?.trim()) {
    return "lyrics ready";
  }
  return "lyrics + chords";
}

function nextSongSequence(items: PlanItem[]) {
  const highest = items.reduce((max, item) => Math.max(max, Number.parseFloat(item.sequence) || 0), 0);
  return (highest + 1).toFixed(2);
}

function compactSongTitle(song: Song) {
  return song.author ? `${song.title} · ${song.author}` : song.title;
}

export function WorshipBuilderView({ canEditPlan }: WorshipBuilderViewProps) {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"builder" | "live">("builder");

  const sortedPlans = useMemo(
    () =>
      [...plans].sort((left, right) => {
        const leftTime = new Date(left.service_date).getTime();
        const rightTime = new Date(right.service_date).getTime();
        return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
      }),
    [plans],
  );

  const worshipItems = useMemo(
    () =>
      [...(plan?.items ?? [])]
        .filter((item) => item.item_type === "song" && item.song_id)
        .sort((left, right) => (Number.parseFloat(left.sequence) || 0) - (Number.parseFloat(right.sequence) || 0)),
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
      const [nextPlans, nextSongs] = await Promise.all([getPlans(), getSongs()]);
      const resolvedPlanId = targetPlanId || selectedPlanId || nextPlans[0]?.id || "";
      const nextPlan = resolvedPlanId ? await getPlan(resolvedPlanId) : null;
      setPlans(nextPlans);
      setSongs(nextSongs);
      setSelectedPlanId(resolvedPlanId);
      setPlan(nextPlan);
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

  async function selectPlan(planId: string) {
    setSelectedPlanId(planId);
    await load(planId);
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
        sequence: nextSongSequence(plan.items),
        title: song.title,
        comment: null,
        key_signature: null,
        song_id: song.id,
      });
      await load(plan.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add song.");
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
            Service
            <select
              disabled={loading}
              onChange={(event) => void selectPlan(event.target.value)}
              value={selectedPlanId}
            >
              {sortedPlans.map((service) => (
                <option key={service.id} value={service.id}>
                  {formatServiceDate(service.service_date)} · {service.title}
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
              className="worship-song-row"
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
            Service
            <select
              disabled={loading}
              onChange={(event) => void selectPlan(event.target.value)}
              value={selectedPlanId}
            >
              {sortedPlans.map((service) => (
                <option key={service.id} value={service.id}>
                  {formatServiceDate(service.service_date)} · {service.title}
                </option>
              ))}
            </select>
          </label>
          <div className="worship-set-summary">
            <strong>{worshipItems.length}</strong>
            <span>worship songs</span>
          </div>
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
                <h2>{plan?.title ?? "No service selected"}</h2>
              </div>
            </div>
            <div className="worship-section-list">
              {worshipItems.map((item, index) => {
                const song = songs.find((candidate) => candidate.id === item.song_id);
                return (
                  <article className="worship-set-item" key={item.id}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{song ? compactSongTitle(song) : item.title}</strong>
                      <small>{songStatus(song)}</small>
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

          <section className="worship-slide-review" aria-label="Worship song slides">
            {worshipSections.map((section) => (
              <div className="section-slide-group" key={section.id}>
                <div className={`section-jump type-song readonly`}>
                  <span>{section.itemType}</span>
                  <strong>{section.title}</strong>
                </div>
                <div className="section-slide-list worship-slide-list">
                  {section.slides.map((slide, index) => (
                    <div className="slide-tile preview-tile type-song readonly" key={slide.id}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div className="mini-slide-surface stage-theme-light">
                        <AutoFitSlideText
                          className="fit-slide-text-compact"
                          maxFontSize={compactFontCap}
                          text={slide.text || "No lyrics"}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </div>
      </main>
    </section>
  );
}
