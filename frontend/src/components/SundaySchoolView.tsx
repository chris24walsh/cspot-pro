import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Gamepad2,
  Library,
  Music2,
  Plus,
  RefreshCw,
  Save,
  Scissors,
  Search,
  StickyNote,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  createSundaySchoolLesson,
  getSongs,
  getSundaySchoolLessons,
  getSundaySchoolResources,
  importSundaySchoolResources,
  sundaySchoolResourceFileUrl,
  updateSundaySchoolLesson,
  type Song,
  type SundaySchoolLesson,
  type SundaySchoolLessonPayload,
  type SundaySchoolResource,
} from "../api";

type LessonField = {
  key: keyof Pick<SundaySchoolLessonPayload, "bible_story" | "crafts" | "songs" | "games" | "source_notes" | "teacher_notes">;
  label: string;
  icon: typeof FileText;
};

type SundaySchoolTab = "plan" | "resources";

const LESSON_FIELDS: LessonField[] = [
  { key: "bible_story", label: "Bible Story", icon: FileText },
  { key: "crafts", label: "Crafts / Printouts", icon: Scissors },
  { key: "songs", label: "Songs", icon: Music2 },
  { key: "games", label: "Games", icon: Gamepad2 },
  { key: "source_notes", label: "Source Materials", icon: Library },
  { key: "teacher_notes", label: "Cover Notes", icon: StickyNote },
];

const RESOURCE_LABELS: Record<string, string> = {
  lesson_packet: "Packet",
  bible_story: "Bible",
  craft: "Craft",
  game: "Game",
  coloring: "Coloring",
  worksheet: "Sheet",
  media: "Video",
};

const TEACHER_COLORS = ["teacher-a", "teacher-b", "teacher-c", "teacher-d", "teacher-e", "teacher-f"];

function dateInputFromDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function monthInputFromDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function dateInputFromIso(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateInputFromDate(date);
}

function nextSundayDateInput(from = new Date()) {
  const date = new Date(from);
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7));
  return dateInputFromDate(date);
}

function longDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value || "No date";
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", weekday: "long" });
}

function shortDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function calendarDaysForMonth(monthInput: string) {
  const [year, month] = monthInput.split("-").map(Number);
  const first = new Date(year, (month || 1) - 1, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_value, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return { date: dateInputFromDate(day), muted: day.getMonth() !== first.getMonth() };
  });
}

function blankLesson(date: string): SundaySchoolLessonPayload {
  return {
    lesson_date: date,
    status: "draft",
    teacher_name: "",
    theme: "",
    bible_reference: "",
    bible_story: "",
    crafts: "",
    songs: "",
    games: "",
    source_notes: "",
    teacher_notes: "",
  };
}

function draftFromLesson(lesson: SundaySchoolLesson): SundaySchoolLessonPayload {
  return {
    lesson_date: dateInputFromIso(lesson.lesson_date),
    status: lesson.status,
    teacher_name: lesson.teacher_name,
    theme: lesson.theme,
    bible_reference: lesson.bible_reference,
    bible_story: lesson.bible_story,
    crafts: lesson.crafts,
    songs: lesson.songs,
    games: lesson.games,
    source_notes: lesson.source_notes,
    teacher_notes: lesson.teacher_notes,
  };
}

function lessonReadiness(lesson: SundaySchoolLessonPayload) {
  return [
    lesson.theme.trim(),
    lesson.bible_reference.trim() || lesson.bible_story.trim(),
    lesson.crafts.trim(),
    lesson.songs.trim(),
    lesson.games.trim(),
  ].filter(Boolean).length;
}

function teacherColor(name: string) {
  const value = name.trim().toLowerCase();
  if (!value) {
    return "";
  }
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return TEACHER_COLORS[hash % TEACHER_COLORS.length];
}

function uniqueLines(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function resourceText(resources: SundaySchoolResource[], type: string) {
  return resources
    .filter((resource) => resource.resource_type === type)
    .map((resource) => `${resource.title}${resource.summary ? ` - ${resource.summary}` : ""}`)
    .join("\n");
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return <ChevronDown className={open ? "is-open" : ""} size={16} aria-hidden="true" />;
}

export function SundaySchoolView({ canEdit }: { canEdit: boolean }) {
  const [lessons, setLessons] = useState<SundaySchoolLesson[]>([]);
  const [resources, setResources] = useState<SundaySchoolResource[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedDate, setSelectedDate] = useState(nextSundayDateInput());
  const [calendarMonth, setCalendarMonth] = useState(monthInputFromDate(new Date()));
  const [draft, setDraft] = useState<SundaySchoolLessonPayload>(() => blankLesson(nextSundayDateInput()));
  const [activeTab, setActiveTab] = useState<SundaySchoolTab>("plan");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [openLessonField, setOpenLessonField] = useState<LessonField["key"]>("bible_story");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [resourceQuery, setResourceQuery] = useState("");
  const [resourceAge, setResourceAge] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [songQuery, setSongQuery] = useState("");

  const lessonsByDate = useMemo(
    () => new Map(lessons.map((lesson) => [dateInputFromIso(lesson.lesson_date), lesson])),
    [lessons],
  );
  const selectedLesson = lessonsByDate.get(selectedDate) ?? null;
  const calendarDays = useMemo(() => calendarDaysForMonth(calendarMonth), [calendarMonth]);
  const upcomingSundays = useMemo(() => {
    const first = new Date(`${nextSundayDateInput()}T12:00:00`);
    return Array.from({ length: 10 }, (_value, index) => {
      const date = new Date(first);
      date.setDate(first.getDate() + index * 7);
      return dateInputFromDate(date);
    });
  }, []);
  const selectedResources = useMemo(
    () => resources.filter((resource) => dateInputFromIso(resource.lesson_date) === selectedDate),
    [resources, selectedDate],
  );
  const filteredResources = useMemo(() => {
    const query = resourceQuery.trim().toLowerCase();
    return resources.filter((resource) => {
      const matchesQuery =
        !query ||
        [resource.title, resource.theme, resource.bible_reference, resource.summary, resource.file_name]
          .join(" ")
          .toLowerCase()
          .includes(query);
      return (
        matchesQuery &&
        (!resourceAge || resource.age_group === resourceAge) &&
        (!resourceType || resource.resource_type === resourceType)
      );
    });
  }, [resourceAge, resourceQuery, resourceType, resources]);
  const filteredSongs = useMemo(() => {
    const query = songQuery.trim().toLowerCase();
    return songs
      .filter(
        (song) =>
          !query ||
          [song.title, song.alternate_title, song.theme_tags, song.lyrics]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query),
      )
      .slice(0, 8);
  }, [songQuery, songs]);
  const readyCount = lessonReadiness(draft);

  const resourcesByType = useMemo(() => {
    const grouped = new Map<string, SundaySchoolResource[]>();
    for (const resource of selectedResources) {
      const current = grouped.get(resource.resource_type) ?? [];
      current.push(resource);
      grouped.set(resource.resource_type, current);
    }
    return grouped;
  }, [selectedResources]);

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const from = new Date();
      from.setDate(from.getDate() - 42);
      const to = new Date();
      to.setDate(to.getDate() + 180);
      const [nextLessons, nextResources, nextSongs] = await Promise.all([
        getSundaySchoolLessons({ from_date: dateInputFromDate(from), to_date: dateInputFromDate(to) }),
        getSundaySchoolResources(),
        getSongs(),
      ]);
      setLessons(nextLessons);
      setResources(nextResources);
      setSongs(nextSongs);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Sunday School.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const lesson = lessonsByDate.get(selectedDate);
    setDraft(lesson ? draftFromLesson(lesson) : blankLesson(selectedDate));
  }, [lessonsByDate, selectedDate]);

  function updateDraft<K extends keyof SundaySchoolLessonPayload>(key: K, value: SundaySchoolLessonPayload[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function chooseDate(date: string) {
    setSelectedDate(date);
    setCalendarMonth(date.slice(0, 7));
    setCalendarOpen(false);
  }

  function appendSong(title: string) {
    const lines = uniqueLines([...draft.songs.split(/\r?\n/), title]);
    updateDraft("songs", lines.join("\n"));
  }

  function applySuggestedPlan() {
    const firstPacket = selectedResources.find((resource) => resource.resource_type === "lesson_packet");
    const sourceLines = selectedResources
      .filter((resource) => resource.resource_type === "lesson_packet")
      .map((resource) => `${resource.age_group || "All"}: ${resource.file_name}`);
    setDraft((current) => ({
      ...current,
      theme: current.theme || firstPacket?.theme || "",
      bible_reference: current.bible_reference || firstPacket?.bible_reference || "",
      bible_story: current.bible_story || resourceText(selectedResources, "bible_story"),
      crafts: current.crafts || [resourceText(selectedResources, "craft"), resourceText(selectedResources, "coloring"), resourceText(selectedResources, "worksheet")]
        .filter(Boolean)
        .join("\n"),
      games: current.games || resourceText(selectedResources, "game"),
      source_notes: uniqueLines([...current.source_notes.split(/\r?\n/), ...sourceLines]).join("\n"),
    }));
  }

  async function saveLesson() {
    if (!canEdit) {
      setMessage("You do not have permission to edit Sunday School lessons.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const saved = selectedLesson ? await updateSundaySchoolLesson(selectedLesson.id, draft) : await createSundaySchoolLesson(draft);
      setLessons((current) => {
        const withoutSaved = current.filter((lesson) => lesson.id !== saved.id);
        return [...withoutSaved, saved].sort((left, right) => left.lesson_date.localeCompare(right.lesson_date));
      });
      setSelectedDate(dateInputFromIso(saved.lesson_date));
      setMessage("Lesson saved.");
    } catch (error) {
      setMessage(error instanceof ApiError && error.status === 409 ? "There is already a lesson for this date." : error instanceof Error ? error.message : "Could not save lesson.");
    } finally {
      setSaving(false);
    }
  }

  async function importResources() {
    if (!canEdit || importing) {
      return;
    }
    setImporting(true);
    setMessage("Importing Sunday School resources...");
    try {
      const result = await importSundaySchoolResources();
      const nextResources = await getSundaySchoolResources();
      setResources(nextResources);
      setMessage(`Imported ${result.imported} new resources from ${result.scanned} files.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import resources.");
    } finally {
      setImporting(false);
    }
  }

  function resourcesForField(fieldKey: LessonField["key"]) {
    if (fieldKey === "bible_story") {
      return [
        ...(resourcesByType.get("bible_story") ?? []),
        ...(resourcesByType.get("lesson_packet") ?? []),
      ];
    }
    if (fieldKey === "crafts") {
      return [
        ...(resourcesByType.get("craft") ?? []),
        ...(resourcesByType.get("coloring") ?? []),
        ...(resourcesByType.get("worksheet") ?? []),
      ];
    }
    if (fieldKey === "games") {
      return resourcesByType.get("game") ?? [];
    }
    if (fieldKey === "source_notes") {
      return selectedResources;
    }
    return [];
  }

  return (
    <section className="sunday-school-workspace" aria-label="Sunday School lessons">
      <main className="sunday-school-editor">
        <div className="sunday-school-header">
          <div>
            <p className="eyebrow">Sunday School</p>
            <h2>{longDate(selectedDate)}</h2>
          </div>
          <div className="sunday-school-actions">
            <button className="text-button" onClick={() => setCalendarOpen(true)} type="button">
              <CalendarDays size={15} aria-hidden="true" />
              {shortDate(selectedDate)}
            </button>
            <div className="segmented-control compact-segmented" role="tablist" aria-label="Sunday School tabs">
              <button className={activeTab === "plan" ? "is-active" : ""} onClick={() => setActiveTab("plan")} type="button">Plan</button>
              <button className={activeTab === "resources" ? "is-active" : ""} onClick={() => setActiveTab("resources")} type="button">Resources</button>
            </div>
            <span className={`sunday-school-readiness readiness-${readyCount}`}>{readyCount}/5</span>
            <button className="primary-button" disabled={!canEdit || saving} onClick={() => void saveLesson()} type="button">
              {selectedLesson ? <Save size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
              {saving ? "Saving..." : selectedLesson ? "Save" : "Create"}
            </button>
          </div>
        </div>

        {message ? <p className="status-message">{message}</p> : null}
        {loading ? <p className="empty-state">Loading lessons...</p> : null}

        {calendarOpen ? (
          <div className="app-dialog-backdrop" role="presentation" onMouseDown={() => setCalendarOpen(false)}>
            <section
              aria-labelledby="sunday-school-calendar-title"
              className="app-dialog app-dialog-wide service-picker-dialog sunday-school-calendar-dialog"
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Calendar</p>
                  <h2 id="sunday-school-calendar-title">Sunday School</h2>
                </div>
                <button className="text-button" onClick={() => setCalendarOpen(false)} type="button">
                  Close
                </button>
              </div>
              <div className="service-picker-grid sunday-school-picker-grid">
                <section className="service-picker-panel service-calendar-panel">
                  <div className="service-calendar-heading">
                    <button
                      aria-label="Previous month"
                      className="text-button"
                      onClick={() => {
                        const [year, month] = calendarMonth.split("-").map(Number);
                        setCalendarMonth(monthInputFromDate(new Date(year, month - 2, 1)));
                      }}
                      type="button"
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <strong>{new Date(`${calendarMonth}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
                    <button
                      aria-label="Next month"
                      className="text-button"
                      onClick={() => {
                        const [year, month] = calendarMonth.split("-").map(Number);
                        setCalendarMonth(monthInputFromDate(new Date(year, month, 1)));
                      }}
                      type="button"
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="service-calendar-grid" aria-label="Sunday School calendar">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                      <span className="service-calendar-weekday" key={day}>{day}</span>
                    ))}
                    {calendarDays.map((day) => {
                      const lesson = lessonsByDate.get(day.date);
                      const date = new Date(`${day.date}T12:00:00`);
                      return (
                        <button
                          className={`service-calendar-day ${day.muted ? "is-muted" : ""} ${lesson ? "has-service" : ""} ${
                            selectedDate === day.date ? "is-selected" : ""
                          } ${teacherColor(lesson?.teacher_name || "")}`}
                          key={day.date}
                          onClick={() => chooseDate(day.date)}
                          title={lesson?.teacher_name || lesson?.theme || undefined}
                          type="button"
                        >
                          <span>{date.getDate()}</span>
                          {lesson ? <small>{lesson.teacher_name || lesson.theme}</small> : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
                <section className="service-picker-panel service-list-panel">
                  <div className="service-panel-heading">
                    <h3>Upcoming</h3>
                  </div>
                  <div className="stack-list compact service-date-list">
                    {upcomingSundays.map((date) => {
                      const lesson = lessonsByDate.get(date);
                      return (
                        <button
                          className={`stack-row ${selectedDate === date ? "selected" : ""} ${teacherColor(lesson?.teacher_name || "")}`}
                          key={date}
                          onClick={() => chooseDate(date)}
                          type="button"
                        >
                          <strong>{shortDate(date)}</strong>
                          <span>{lesson?.theme || "Unplanned"}{lesson?.teacher_name ? ` - ${lesson.teacher_name}` : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === "plan" ? (
          <>
            <div className="sunday-school-core-fields">
              <label>
                <span>Teacher</span>
                <input disabled={!canEdit} onChange={(event) => updateDraft("teacher_name", event.target.value)} placeholder="Scheduled teacher" value={draft.teacher_name} />
              </label>
              <label>
                <span>Theme</span>
                <input disabled={!canEdit} onChange={(event) => updateDraft("theme", event.target.value)} placeholder="Theme from the plan" value={draft.theme} />
              </label>
              <label>
                <span>Bible Reference</span>
                <input disabled={!canEdit} onChange={(event) => updateDraft("bible_reference", event.target.value)} placeholder="e.g. John 6:56-69" value={draft.bible_reference} />
              </label>
              <label>
                <span>Status</span>
                <select disabled={!canEdit} onChange={(event) => updateDraft("status", event.target.value)} value={draft.status}>
                  <option value="draft">Draft</option>
                  <option value="ready">Ready</option>
                  <option value="printed">Printed</option>
                </select>
              </label>
            </div>

            <div className="sunday-school-suggestion">
              <div>
                <strong>Suggested lesson plan</strong>
                <span>{selectedResources.length ? `${selectedResources.length} matched resources` : "No imported resources for this date yet"}</span>
              </div>
              <button className="text-button" disabled={!canEdit || !selectedResources.length} onClick={applySuggestedPlan} type="button">
                <CheckCircle2 size={14} aria-hidden="true" />
                Use suggestion
              </button>
            </div>

            <div className="sunday-school-accordion">
              {LESSON_FIELDS.map((field) => {
                const Icon = field.icon;
                const isOpen = openLessonField === field.key;
                const fieldResources = resourcesForField(field.key);
                const draftValue = draft[field.key].trim();
                return (
                  <section className={`sunday-school-accordion-item ${isOpen ? "is-open" : ""}`} key={field.key}>
                    <button
                      aria-expanded={isOpen}
                      className="sunday-school-accordion-trigger"
                      onClick={() => setOpenLessonField((current) => (current === field.key ? field.key : field.key))}
                      type="button"
                    >
                      <span>
                        <Icon size={15} aria-hidden="true" />
                        {field.label}
                      </span>
                      <small>
                        {draftValue ? "Text" : ""}
                        {draftValue && fieldResources.length ? " + " : ""}
                        {fieldResources.length ? `${fieldResources.length} link${fieldResources.length === 1 ? "" : "s"}` : ""}
                        {!draftValue && !fieldResources.length ? "Empty" : ""}
                      </small>
                      <ChevronDownIcon open={isOpen} />
                    </button>
                    {isOpen ? (
                      <div className="sunday-school-accordion-panel">
                        {field.key !== "songs" ? (
                          <textarea
                            disabled={!canEdit}
                            onChange={(event) => updateDraft(field.key, event.target.value)}
                            value={draft[field.key]}
                          />
                        ) : (
                          <>
                            <textarea
                              disabled={!canEdit}
                              onChange={(event) => updateDraft(field.key, event.target.value)}
                              value={draft[field.key]}
                            />
                            <div className="sunday-school-inline-song-search">
                              <input onChange={(event) => setSongQuery(event.target.value)} placeholder="Search songs" value={songQuery} />
                              <div className="sunday-school-song-list">
                                {filteredSongs.map((song) => (
                                  <button disabled={!canEdit} key={song.id} onClick={() => appendSong(song.title)} type="button">
                                    <Music2 size={13} aria-hidden="true" />
                                    <span>{song.title}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </>
                        )}
                        {fieldResources.length ? (
                          <div className="sunday-school-accordion-links">
                            {fieldResources.map((resource) => (
                              <a href={sundaySchoolResourceFileUrl(resource.id)} key={resource.id} rel="noreferrer" target="_blank">
                                <span>{RESOURCE_LABELS[resource.resource_type] || resource.resource_type}</span>
                                <strong>{resource.title}</strong>
                                <small>{[resource.age_group, resource.bible_reference, resource.translation].filter(Boolean).join(" | ")}</small>
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </>
        ) : (
          <div className="sunday-school-resource-panel">
            <div className="sunday-school-resource-toolbar">
              <label>
                <Search size={14} aria-hidden="true" />
                <input onChange={(event) => setResourceQuery(event.target.value)} placeholder="Search resources" value={resourceQuery} />
              </label>
              <select onChange={(event) => setResourceAge(event.target.value)} value={resourceAge}>
                <option value="">All ages</option>
                <option value="3-5">3-5</option>
                <option value="6-12">6-12</option>
              </select>
              <select onChange={(event) => setResourceType(event.target.value)} value={resourceType}>
                <option value="">All types</option>
                {Object.entries(RESOURCE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <button className="text-button" disabled={!canEdit || importing} onClick={() => void importResources()} type="button">
                <RefreshCw size={14} aria-hidden="true" />
                {importing ? "Importing..." : "Import"}
              </button>
            </div>
            <div className="sunday-school-resource-list">
              {filteredResources.map((resource) => (
                <article className="sunday-school-resource-card" key={resource.id}>
                  <div>
                    <span>{RESOURCE_LABELS[resource.resource_type] || resource.resource_type}</span>
                    <strong>{resource.title}</strong>
                    <small>{[resource.age_group, resource.bible_reference, resource.translation].filter(Boolean).join(" | ")}</small>
                  </div>
                  <p>{resource.summary || resource.file_name}</p>
                  <a className="text-button" href={sundaySchoolResourceFileUrl(resource.id)} rel="noreferrer" target="_blank">
                    <ExternalLink size={14} aria-hidden="true" />
                    Open
                  </a>
                </article>
              ))}
              {!filteredResources.length ? <p className="empty-state">No matching resources.</p> : null}
            </div>
          </div>
        )}
      </main>

      <aside className="sunday-school-kit" aria-label="Lesson resources">
        <div className="sunday-school-kit-panel">
          <h3>For This Date</h3>
          <div className="sunday-school-mini-resource-list">
            {selectedResources.slice(0, 8).map((resource) => (
              <a href={sundaySchoolResourceFileUrl(resource.id)} key={resource.id} rel="noreferrer" target="_blank">
                <span>{RESOURCE_LABELS[resource.resource_type] || resource.resource_type}</span>
                <strong>{resource.title}</strong>
              </a>
            ))}
            {!selectedResources.length ? <p>No resources matched yet.</p> : null}
          </div>
        </div>
        <div className="sunday-school-kit-panel">
          <h3>Song Catalog</h3>
          <input onChange={(event) => setSongQuery(event.target.value)} placeholder="Search songs" value={songQuery} />
          <div className="sunday-school-song-list">
            {filteredSongs.map((song) => (
              <button disabled={!canEdit} key={song.id} onClick={() => appendSong(song.title)} type="button">
                <Music2 size={13} aria-hidden="true" />
                <span>{song.title}</span>
              </button>
            ))}
            {!filteredSongs.length ? <p className="search-empty">No matching songs.</p> : null}
          </div>
        </div>
        <div className="sunday-school-kit-panel">
          <h3>Teacher Overview</h3>
          <div className="sunday-school-teacher-list">
            {Array.from(new Set(lessons.map((lesson) => lesson.teacher_name.trim()).filter(Boolean))).map((teacher) => (
              <span className={teacherColor(teacher)} key={teacher}>
                <CalendarDays size={13} aria-hidden="true" />
                {teacher}
              </span>
            ))}
            {!lessons.some((lesson) => lesson.teacher_name.trim()) ? <p>Add teachers to lessons to shade the calendar.</p> : null}
          </div>
        </div>
      </aside>
    </section>
  );
}
