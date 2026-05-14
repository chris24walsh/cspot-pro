import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ListPlus, MonitorUp, Music2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createPlanItem,
  createPlan,
  deletePlan,
  deletePlanItem,
  getPlan,
  getPlanTypes,
  getPlans,
  getSongs,
  updatePlan,
  updatePlanItem,
  type PlanDetail,
  type PlanItem,
  type PlanSummary,
  type PlanType,
  type Song,
} from "../api";
import { buildPresentationSections, suggestSlideGroupFontCap } from "../presentation";
import { dateKey, isWorshipSetPlan, worshipSetType } from "../worshipSets";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { MusicianLiveView } from "./MusicianLiveView";

const SELECTED_WORSHIP_SET_SESSION_KEY = "cspot.selectedWorshipSetPlanId";

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
      await load(openAfterSave ? saved.id : selectedPlanId || saved.id);
      setSetDraftPlanId(saved.id);
      setSetPickerOpen(!openAfterSave);
      setMessage(setDraftPlanId ? "Worship set saved." : "Worship set created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save worship set.");
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
    </section>
  );
}
