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
  Plus,
  RefreshCw,
  Save,
  Scissors,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  createSundaySchoolLesson,
  getSundaySchoolLessons,
  getSundaySchoolResources,
  importSundaySchoolResources,
  sundaySchoolResourceFileUrl,
  updateSundaySchoolLesson,
  type SundaySchoolLesson,
  type SundaySchoolLessonPayload,
  type SundaySchoolResource,
} from "../api";

type SundaySchoolPane = "library" | "set";
type LessonElementKey = "passage" | "craft" | "activity" | "game" | "resources";

type LessonElement = {
  key: LessonElementKey;
  label: string;
  icon: typeof FileText;
  resourceTypes: string[];
};

const LESSON_ELEMENTS: LessonElement[] = [
  { key: "passage", label: "Passage / Story", icon: FileText, resourceTypes: ["bible_story"] },
  { key: "craft", label: "Craft", icon: Scissors, resourceTypes: ["craft"] },
  { key: "activity", label: "Printout / Activity", icon: Library, resourceTypes: ["coloring", "worksheet", "media"] },
  { key: "game", label: "Game", icon: Gamepad2, resourceTypes: ["game"] },
  { key: "resources", label: "All Resources", icon: Library, resourceTypes: ["lesson_packet", "bible_story", "craft", "game", "coloring", "worksheet", "media"] },
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
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: "numeric", month: "long", weekday: "long" });
}

function shortDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
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

function resourceMeta(resource: SundaySchoolResource) {
  const pages = resource.page_start
    ? resource.page_start === resource.page_end
      ? `p${resource.page_start}`
      : `p${resource.page_start}-${resource.page_end}`
    : "";
  return [RESOURCE_LABELS[resource.resource_type] || resource.resource_type, resource.age_group, resource.bible_reference, pages]
    .filter(Boolean)
    .join(" | ");
}

function resourceAssignment(resource: SundaySchoolResource) {
  return [resource.title, resource.summary].filter(Boolean).join("\n");
}

function firstLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

export function SundaySchoolView({ canEdit }: { canEdit: boolean }) {
  const [lessons, setLessons] = useState<SundaySchoolLesson[]>([]);
  const [resources, setResources] = useState<SundaySchoolResource[]>([]);
  const [selectedDate, setSelectedDate] = useState(nextSundayDateInput());
  const [calendarMonth, setCalendarMonth] = useState(monthInputFromDate(new Date()));
  const [draft, setDraft] = useState<SundaySchoolLessonPayload>(() => blankLesson(nextSundayDateInput()));
  const [mobilePane, setMobilePane] = useState<SundaySchoolPane>("library");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedElementKey, setSelectedElementKey] = useState<LessonElementKey>("passage");
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
  const [resourceQuery, setResourceQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lessonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const lessonsByDate = useMemo(
    () => new Map(lessons.map((lesson) => [dateInputFromIso(lesson.lesson_date), lesson])),
    [lessons],
  );
  const selectedLesson = lessonsByDate.get(selectedDate) ?? null;
  const selectedElement = LESSON_ELEMENTS.find((element) => element.key === selectedElementKey) ?? LESSON_ELEMENTS[0];
  const calendarDays = useMemo(() => calendarDaysForMonth(calendarMonth), [calendarMonth]);
  const scheduleDates = useMemo(() => {
    const center = new Date(`${nextSundayDateInput()}T12:00:00`);
    return Array.from({ length: 53 }, (_value, index) => {
      const date = new Date(center);
      date.setDate(center.getDate() + (index - 26) * 7);
      return dateInputFromDate(date);
    });
  }, []);
  const selectedResources = useMemo(
    () => resources.filter((resource) => dateInputFromIso(resource.lesson_date) === selectedDate),
    [resources, selectedDate],
  );
  const elementResources = useMemo(
    () => selectedResources.filter((resource) => selectedElement.resourceTypes.includes(resource.resource_type)),
    [selectedElement, selectedResources],
  );
  const pickerResources = useMemo(() => {
    const query = resourceQuery.trim().toLowerCase();
    return resources
      .filter((resource) => selectedElement.resourceTypes.includes(resource.resource_type))
      .filter((resource) => {
        if (!query) {
          return true;
        }
        return [resource.title, resource.theme, resource.bible_reference, resource.summary, resource.file_name]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((left, right) => {
        const leftSelected = dateInputFromIso(left.lesson_date) === selectedDate ? 0 : 1;
        const rightSelected = dateInputFromIso(right.lesson_date) === selectedDate ? 0 : 1;
        return leftSelected - rightSelected || left.title.localeCompare(right.title);
      });
  }, [resourceQuery, resources, selectedDate, selectedElement]);

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const from = new Date();
      from.setDate(from.getDate() - 210);
      const to = new Date();
      to.setDate(to.getDate() + 210);
      const [nextLessons, nextResources] = await Promise.all([
        getSundaySchoolLessons({ from_date: dateInputFromDate(from), to_date: dateInputFromDate(to) }),
        getSundaySchoolResources(),
      ]);
      setLessons(nextLessons);
      setResources(nextResources);
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

  useEffect(() => {
    window.setTimeout(() => lessonRefs.current[selectedDate]?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
  }, [selectedDate]);

  function updateDraft<K extends keyof SundaySchoolLessonPayload>(key: K, value: SundaySchoolLessonPayload[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function chooseDate(date: string) {
    setSelectedDate(date);
    setCalendarMonth(date.slice(0, 7));
    setCalendarOpen(false);
    setMobilePane("set");
  }

  function elementSummary(element: LessonElement) {
    if (element.key === "passage") {
      return draft.bible_reference || firstLine(draft.bible_story) || "Choose passage";
    }
    if (element.key === "craft") {
      return firstLine(draft.crafts) || "Choose craft";
    }
    if (element.key === "activity") {
      return firstLine(draft.source_notes) || "Choose activity";
    }
    if (element.key === "game") {
      return firstLine(draft.games) || "Choose game";
    }
    return selectedResources.length ? `${selectedResources.length} resources` : "No dated resources";
  }

  function assignResource(resource: SundaySchoolResource) {
    const assignment = resourceAssignment(resource);
    setDraft((current) => {
      if (selectedElement.key === "passage") {
        return {
          ...current,
          theme: current.theme || resource.theme || "",
          bible_reference: resource.bible_reference || current.bible_reference,
          bible_story: assignment,
        };
      }
      if (selectedElement.key === "craft") {
        return { ...current, crafts: assignment };
      }
      if (selectedElement.key === "game") {
        return { ...current, games: assignment };
      }
      return { ...current, source_notes: assignment };
    });
    setResourcePickerOpen(false);
  }

  function applyMatchedResources() {
    const packet = selectedResources.find((resource) => resource.resource_type === "lesson_packet");
    const passage = selectedResources.find((resource) => resource.resource_type === "bible_story") ?? packet;
    const craft = selectedResources.find((resource) => ["craft", "coloring", "worksheet"].includes(resource.resource_type));
    const game = selectedResources.find((resource) => resource.resource_type === "game");
    setDraft((current) => ({
      ...current,
      theme: current.theme || packet?.theme || passage?.theme || "",
      bible_reference: current.bible_reference || passage?.bible_reference || "",
      bible_story: current.bible_story || (passage ? resourceAssignment(passage) : ""),
      crafts: current.crafts || (craft ? resourceAssignment(craft) : ""),
      games: current.games || (game ? resourceAssignment(game) : ""),
      source_notes: current.source_notes || selectedResources.map((resource) => resource.title).join("\n"),
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
      setResources(await getSundaySchoolResources());
      setMessage(`Imported ${result.imported} new resources from ${result.scanned} files.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import resources.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className={`worship-builder sunday-school-as-worship worship-builder-pane-${mobilePane}`} aria-label="Sunday School lessons">
      <div className="worship-mobile-pane-tabs" aria-label="Sunday School panels">
        <button className={mobilePane === "library" ? "active" : ""} onClick={() => setMobilePane("library")} type="button">
          Lessons <span>{scheduleDates.length}</span>
        </button>
        <button className={mobilePane === "set" ? "active" : ""} onClick={() => setMobilePane("set")} type="button">
          Elements <span>{LESSON_ELEMENTS.length}</span>
        </button>
      </div>

      <aside className={`worship-song-browser ${mobilePane === "library" ? "is-mobile-active" : ""}`}>
        <div className="worship-library-search-row">
          <button className="text-button topbar-service-button" onClick={() => setCalendarOpen(true)} type="button">
            <CalendarDays size={16} aria-hidden="true" />
            <span>{shortDate(selectedDate)}</span>
          </button>
          <button className="text-button" disabled={!canEdit || importing} onClick={() => void importResources()} type="button">
            <RefreshCw size={14} aria-hidden="true" />
            {importing ? "Importing..." : "Import"}
          </button>
        </div>
        <div className="worship-song-list sunday-school-lesson-list">
          {scheduleDates.map((date) => {
            const lesson = lessonsByDate.get(date);
            const resourcesCount = resources.filter((resource) => dateInputFromIso(resource.lesson_date) === date).length;
            return (
              <div className={`song-library-row ${selectedDate === date ? "selected" : ""} ${teacherColor(lesson?.teacher_name || "")}`} key={date}>
                <button
                  className="song-library-main"
                  onClick={() => chooseDate(date)}
                  ref={(node) => {
                    lessonRefs.current[date] = node;
                  }}
                  type="button"
                >
                  <span>
                    <strong>{lesson?.theme || "Unplanned"}</strong>
                    <small>
                      {shortDate(date)}
                      {lesson?.teacher_name ? ` | ${lesson.teacher_name}` : " | No teacher"}
                      {resourcesCount ? ` | ${resourcesCount} resources` : ""}
                    </small>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      <main className={`worship-set-builder ${mobilePane === "set" ? "is-mobile-active" : ""}`}>
        <div className="worship-set-toolbar sunday-school-set-toolbar">
          <div>
            <p className="eyebrow">Selected Lesson</p>
            <h2>{longDate(selectedDate)}</h2>
          </div>
          <div className="worship-set-toolbar-actions sunday-school-toolbar-actions">
            <button className="text-button" disabled={!canEdit || !selectedResources.length} onClick={applyMatchedResources} type="button">
              <CheckCircle2 size={14} aria-hidden="true" />
              Use matched
            </button>
            <button className="primary-button" disabled={!canEdit || saving} onClick={() => void saveLesson()} type="button">
              {selectedLesson ? <Save size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
              {saving ? "Saving..." : selectedLesson ? "Save" : "Create"}
            </button>
          </div>
        </div>
        {message ? <p className="status-message">{message}</p> : null}
        {loading ? <p className="empty-state">Loading lessons...</p> : null}
        <div className="sunday-school-core-fields">
          <label>
            <span>Teacher</span>
            <input disabled={!canEdit} onChange={(event) => updateDraft("teacher_name", event.target.value)} placeholder="Scheduled teacher" value={draft.teacher_name} />
          </label>
          <label>
            <span>Theme</span>
            <input disabled={!canEdit} onChange={(event) => updateDraft("theme", event.target.value)} placeholder="Theme from plan" value={draft.theme} />
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
        <div className="worship-set-layout sunday-school-element-layout">
          <section className="worship-set-list" aria-label="Sunday School lesson elements">
            <div className="worship-section-list">
              {LESSON_ELEMENTS.map((element, index) => {
                const Icon = element.icon;
                const isSelected = selectedElementKey === element.key;
                const count = selectedResources.filter((resource) => element.resourceTypes.includes(resource.resource_type)).length;
                return (
                  <article
                    className={`worship-set-item sunday-school-element-item ${isSelected ? "is-selected" : ""}`}
                    key={element.key}
                    onClick={() => setSelectedElementKey(element.key)}
                    role="button"
                    tabIndex={0}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div className="worship-set-item-body">
                      <strong>
                        <Icon size={14} aria-hidden="true" />
                        {element.label}
                      </strong>
                      <small>{elementSummary(element)}</small>
                    </div>
                    <em>{count}</em>
                    {isSelected ? (
                      <div className="sunday-school-mobile-resource-panel">
                        <button className="text-button" disabled={!canEdit || element.key === "resources"} onClick={() => setResourcePickerOpen(true)} type="button">
                          <Search size={14} aria-hidden="true" />
                          Choose alternative
                        </button>
                        {elementResources.slice(0, 5).map((resource) => (
                          <a href={sundaySchoolResourceFileUrl(resource.id)} key={resource.id} rel="noreferrer" target="_blank">
                            <span>{resourceMeta(resource)}</span>
                            <strong>{resource.title}</strong>
                          </a>
                        ))}
                        {!elementResources.length ? <p>No linked resources for this Sunday.</p> : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="worship-slide-review sunday-school-resource-review" aria-label="Sunday School resources">
            <div className="worship-sorter-heading">
              <button className="section-jump readonly" type="button">
                <strong>{selectedElement.label}</strong>
              </button>
              {selectedElement.key !== "resources" ? (
                <button
                  aria-label="Choose alternative resource"
                  className="section-icon-button"
                  disabled={!canEdit}
                  onClick={() => setResourcePickerOpen(true)}
                  type="button"
                >
                  <Search size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className="sunday-school-resource-review-list">
              {elementResources.map((resource) => (
                <article className="sunday-school-resource-review-card" key={resource.id}>
                  <div>
                    <span>{resourceMeta(resource)}</span>
                    <strong>{resource.title}</strong>
                    <p>{resource.summary || resource.file_name}</p>
                  </div>
                  <a className="text-button" href={sundaySchoolResourceFileUrl(resource.id)} rel="noreferrer" target="_blank">
                    <ExternalLink size={14} aria-hidden="true" />
                    {resource.page_start ? "Open pages" : "Open"}
                  </a>
                </article>
              ))}
              {!elementResources.length ? <p className="empty-state compact-empty">No linked resources for this Sunday.</p> : null}
            </div>
          </section>
        </div>
      </main>

      {calendarOpen ? (
        <div className="app-dialog-backdrop" role="presentation" onMouseDown={() => setCalendarOpen(false)}>
          <section className="app-dialog app-dialog-wide service-picker-dialog sunday-school-calendar-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Calendar</p>
                <h2>Sunday School</h2>
              </div>
              <button className="text-button" onClick={() => setCalendarOpen(false)} type="button">Close</button>
            </div>
            <div className="service-picker-grid sunday-school-picker-grid">
              <section className="service-picker-panel service-calendar-panel">
                <div className="service-calendar-heading">
                  <button aria-label="Previous month" className="text-button" onClick={() => {
                    const [year, month] = calendarMonth.split("-").map(Number);
                    setCalendarMonth(monthInputFromDate(new Date(year, month - 2, 1)));
                  }} type="button">
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <strong>{new Date(`${calendarMonth}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
                  <button aria-label="Next month" className="text-button" onClick={() => {
                    const [year, month] = calendarMonth.split("-").map(Number);
                    setCalendarMonth(monthInputFromDate(new Date(year, month, 1)));
                  }} type="button">
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
                <div className="service-calendar-grid" aria-label="Sunday School calendar">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span className="service-calendar-weekday" key={day}>{day}</span>)}
                  {calendarDays.map((day) => {
                    const lesson = lessonsByDate.get(day.date);
                    const date = new Date(`${day.date}T12:00:00`);
                    return (
                      <button
                        className={`service-calendar-day ${day.muted ? "is-muted" : ""} ${lesson ? "has-service" : ""} ${selectedDate === day.date ? "is-selected" : ""} ${teacherColor(lesson?.teacher_name || "")}`}
                        key={day.date}
                        onClick={() => chooseDate(day.date)}
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
                <div className="service-panel-heading"><h3>Nearby Sundays</h3></div>
                <div className="stack-list compact service-date-list">
                  {scheduleDates.slice(20, 34).map((date) => {
                    const lesson = lessonsByDate.get(date);
                    return (
                      <button className={`stack-row ${selectedDate === date ? "selected" : ""} ${teacherColor(lesson?.teacher_name || "")}`} key={date} onClick={() => chooseDate(date)} type="button">
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

      {resourcePickerOpen ? (
        <div className="app-dialog-backdrop" role="presentation" onMouseDown={() => setResourcePickerOpen(false)}>
          <section className="app-dialog app-dialog-wide sunday-school-alternative-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Choose Alternative</p>
                <h2>{selectedElement.label}</h2>
              </div>
              <button className="text-button" onClick={() => setResourcePickerOpen(false)} type="button">Close</button>
            </div>
            <label className="sunday-school-alternative-search">
              <Search size={15} aria-hidden="true" />
              <input autoFocus onChange={(event) => setResourceQuery(event.target.value)} placeholder="Search resources" value={resourceQuery} />
            </label>
            <div className="sunday-school-alternative-list">
              {pickerResources.map((resource) => (
                <article className="sunday-school-alternative-row" key={resource.id}>
                  <div>
                    <span>{resourceMeta(resource)}</span>
                    <strong>{resource.title}</strong>
                    <small>{resource.summary || resource.file_name}</small>
                  </div>
                  <a className="text-button" href={sundaySchoolResourceFileUrl(resource.id)} rel="noreferrer" target="_blank">
                    <ExternalLink size={14} aria-hidden="true" />
                    {resource.page_start ? "Open pages" : "Open"}
                  </a>
                  <button className="primary-button" disabled={!canEdit} onClick={() => assignResource(resource)} type="button">Use</button>
                </article>
              ))}
              {!pickerResources.length ? <p className="empty-state">No matching resources.</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
