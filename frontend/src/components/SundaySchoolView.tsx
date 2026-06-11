import {
  CalendarDays,
  CheckCircle2,
  FileText,
  Gamepad2,
  Music2,
  Plus,
  Save,
  Scissors,
  StickyNote,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  createSundaySchoolLesson,
  getSongs,
  getSundaySchoolLessons,
  updateSundaySchoolLesson,
  type Song,
  type SundaySchoolLesson,
  type SundaySchoolLessonPayload,
} from "../api";

type LessonField = {
  key: keyof Pick<SundaySchoolLessonPayload, "bible_story" | "crafts" | "songs" | "games" | "source_notes" | "teacher_notes">;
  label: string;
  hint: string;
  icon: typeof FileText;
};

const LESSON_FIELDS: LessonField[] = [
  {
    key: "bible_story",
    label: "Bible Story",
    hint: "Short story to read, or a passage summary with the exact reference.",
    icon: FileText,
  },
  {
    key: "crafts",
    label: "Crafts",
    hint: "Simple printout/craft instructions, materials, and prep notes.",
    icon: Scissors,
  },
  {
    key: "songs",
    label: "Songs",
    hint: "Two or three child-friendly songs, with links or simple cue notes.",
    icon: Music2,
  },
  {
    key: "games",
    label: "Games",
    hint: "Simple games for ages 5-10, including lower-energy fallback choices.",
    icon: Gamepad2,
  },
  {
    key: "source_notes",
    label: "Source Materials",
    hint: "Google Drive PDF/resource references and what to print or ignore.",
    icon: StickyNote,
  },
  {
    key: "teacher_notes",
    label: "Cover Notes",
    hint: "Anything a last-minute cover teacher needs to know before starting.",
    icon: CheckCircle2,
  },
];

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
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return dateInputFromDate(date);
}

function nextSundayDateInput(from = new Date()) {
  const date = new Date(from);
  const daysUntilSunday = (7 - date.getDay()) % 7;
  date.setDate(date.getDate() + daysUntilSunday);
  return dateInputFromDate(date);
}

function longDate(value: string) {
  if (!value) {
    return "No date";
  }
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    weekday: "long",
  });
}

function shortDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function calendarDaysForMonth(monthInput: string) {
  const [year, month] = monthInput.split("-").map(Number);
  const first = new Date(year, (month || 1) - 1, 1);
  const days: Array<{ date: string; muted: boolean }> = [];
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  for (let index = 0; index < 42; index += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    days.push({
      date: dateInputFromDate(day),
      muted: day.getMonth() !== first.getMonth(),
    });
  }
  return days;
}

function blankLesson(date: string): SundaySchoolLessonPayload {
  return {
    lesson_date: date,
    status: "draft",
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

export function SundaySchoolView({ canEdit }: { canEdit: boolean }) {
  const [lessons, setLessons] = useState<SundaySchoolLesson[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedDate, setSelectedDate] = useState(nextSundayDateInput());
  const [calendarMonth, setCalendarMonth] = useState(monthInputFromDate(new Date()));
  const [draft, setDraft] = useState<SundaySchoolLessonPayload>(() => blankLesson(nextSundayDateInput()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [songQuery, setSongQuery] = useState("");

  const lessonsByDate = useMemo(
    () => new Map(lessons.map((lesson) => [dateInputFromIso(lesson.lesson_date), lesson])),
    [lessons],
  );
  const selectedLesson = lessonsByDate.get(selectedDate) ?? null;
  const calendarDays = useMemo(() => calendarDaysForMonth(calendarMonth), [calendarMonth]);
  const upcomingSundays = useMemo(() => {
    const first = new Date(`${nextSundayDateInput()}T12:00:00`);
    return Array.from({ length: 8 }, (_value, index) => {
      const date = new Date(first);
      date.setDate(first.getDate() + index * 7);
      return dateInputFromDate(date);
    });
  }, []);
  const filteredSongs = useMemo(() => {
    const query = songQuery.trim().toLowerCase();
    return songs
      .filter((song) => {
        if (!query) {
          return true;
        }
        return [song.title, song.alternate_title, song.theme_tags].filter(Boolean).join(" ").toLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [songQuery, songs]);
  const readyCount = lessonReadiness(draft);

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const from = new Date();
      from.setDate(from.getDate() - 28);
      const to = new Date();
      to.setDate(to.getDate() + 120);
      const [nextLessons, nextSongs] = await Promise.all([
        getSundaySchoolLessons({
          from_date: dateInputFromDate(from),
          to_date: dateInputFromDate(to),
        }),
        getSongs(),
      ]);
      setLessons(nextLessons);
      setSongs(nextSongs);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Sunday School lessons.");
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
  }

  function appendSong(title: string) {
    const lines = draft.songs
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.some((line) => line.toLowerCase() === title.toLowerCase())) {
      return;
    }
    updateDraft("songs", [...lines, title].join("\n"));
  }

  async function saveLesson() {
    if (!canEdit) {
      setMessage("You do not have permission to edit Sunday School lessons.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const saved = selectedLesson
        ? await updateSundaySchoolLesson(selectedLesson.id, draft)
        : await createSundaySchoolLesson(draft);
      setLessons((current) => {
        const withoutSaved = current.filter((lesson) => lesson.id !== saved.id);
        return [...withoutSaved, saved].sort((left, right) => left.lesson_date.localeCompare(right.lesson_date));
      });
      setSelectedDate(dateInputFromIso(saved.lesson_date));
      setMessage("Lesson saved.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setMessage("There is already a lesson for this date. Refresh and edit that lesson.");
      } else {
        setMessage(error instanceof Error ? error.message : "Could not save lesson.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="sunday-school-workspace" aria-label="Sunday School lessons">
      <aside className="sunday-school-sidebar" aria-label="Lesson dates">
        <div className="sunday-school-calendar-tools">
          <button
            className="text-button compact-button"
            onClick={() => {
              const [year, month] = calendarMonth.split("-").map(Number);
              setCalendarMonth(monthInputFromDate(new Date(year, month - 2, 1)));
            }}
            type="button"
          >
            {"<"}
          </button>
          <strong>{new Date(`${calendarMonth}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
          <button
            className="text-button compact-button"
            onClick={() => {
              const [year, month] = calendarMonth.split("-").map(Number);
              setCalendarMonth(monthInputFromDate(new Date(year, month, 1)));
            }}
            type="button"
          >
            {">"}
          </button>
        </div>
        <div className="sunday-school-calendar-grid" aria-label="Sunday School calendar">
          {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
            <span className="sunday-school-weekday" key={`${day}-${index}`}>{day}</span>
          ))}
          {calendarDays.map((day) => {
            const lesson = lessonsByDate.get(day.date);
            const date = new Date(`${day.date}T12:00:00`);
            const isSunday = date.getDay() === 0;
            return (
              <button
                className={`sunday-school-day ${day.muted ? "is-muted" : ""} ${isSunday ? "is-sunday" : ""} ${
                  selectedDate === day.date ? "is-selected" : ""
                } ${lesson ? "has-lesson" : ""}`}
                key={day.date}
                onClick={() => chooseDate(day.date)}
                type="button"
              >
                <span>{date.getDate()}</span>
              </button>
            );
          })}
        </div>
        <div className="sunday-school-next-list" aria-label="Upcoming Sundays">
          {upcomingSundays.map((date) => {
            const lesson = lessonsByDate.get(date);
            return (
              <button
                className={`sunday-school-next-row ${selectedDate === date ? "active" : ""}`}
                key={date}
                onClick={() => chooseDate(date)}
                type="button"
              >
                <span>{shortDate(date)}</span>
                <strong>{lesson?.theme || "Unplanned"}</strong>
                <small>{lesson ? lesson.status : "new"}</small>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="sunday-school-editor">
        <div className="sunday-school-header">
          <div>
            <p className="eyebrow">Sunday School</p>
            <h2>{longDate(selectedDate)}</h2>
          </div>
          <div className="sunday-school-actions">
            <span className={`sunday-school-readiness readiness-${readyCount}`}>
              {readyCount}/5 ready
            </span>
            <button
              className="primary-button"
              disabled={!canEdit || saving}
              onClick={() => void saveLesson()}
              type="button"
            >
              {selectedLesson ? <Save size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
              {saving ? "Saving..." : selectedLesson ? "Save" : "Create"}
            </button>
          </div>
        </div>

        {message ? <p className="status-message">{message}</p> : null}
        {loading ? <p className="empty-state">Loading lessons...</p> : null}

        <div className="sunday-school-core-fields">
          <label>
            <span>Theme</span>
            <input
              disabled={!canEdit}
              onChange={(event) => updateDraft("theme", event.target.value)}
              placeholder="Theme from the Sunday School plan"
              value={draft.theme}
            />
          </label>
          <label>
            <span>Bible Reference</span>
            <input
              disabled={!canEdit}
              onChange={(event) => updateDraft("bible_reference", event.target.value)}
              placeholder="e.g. Luke 15:11-32"
              value={draft.bible_reference}
            />
          </label>
          <label>
            <span>Status</span>
            <select
              disabled={!canEdit}
              onChange={(event) => updateDraft("status", event.target.value)}
              value={draft.status}
            >
              <option value="draft">Draft</option>
              <option value="ready">Ready</option>
              <option value="printed">Printed</option>
            </select>
          </label>
        </div>

        <div className="sunday-school-section-grid">
          {LESSON_FIELDS.map((field) => {
            const Icon = field.icon;
            return (
              <label className="sunday-school-section" key={field.key}>
                <span>
                  <Icon size={15} aria-hidden="true" />
                  {field.label}
                </span>
                <textarea
                  disabled={!canEdit}
                  onChange={(event) => updateDraft(field.key, event.target.value)}
                  placeholder={field.hint}
                  value={draft[field.key]}
                />
              </label>
            );
          })}
        </div>
      </main>

      <aside className="sunday-school-kit" aria-label="Quick lesson kit">
        <div className="sunday-school-kit-panel">
          <h3>Emergency Kit</h3>
          <ul>
            <li>Theme and Bible reference visible at the top.</li>
            <li>Read the Bible story before craft setup.</li>
            <li>Pick two songs, then one quiet game and one movement game.</li>
            <li>Use source notes only to find/print the pared-down material.</li>
          </ul>
        </div>

        <div className="sunday-school-kit-panel">
          <h3>Song Catalog</h3>
          <input
            onChange={(event) => setSongQuery(event.target.value)}
            placeholder="Search songs"
            value={songQuery}
          />
          <div className="sunday-school-song-list">
            {filteredSongs.map((song) => (
              <button
                disabled={!canEdit}
                key={song.id}
                onClick={() => appendSong(song.title)}
                type="button"
              >
                <Music2 size={13} aria-hidden="true" />
                <span>{song.title}</span>
              </button>
            ))}
            {!filteredSongs.length ? <p className="search-empty">No matching songs.</p> : null}
          </div>
        </div>

        <div className="sunday-school-kit-panel">
          <h3>Drive Source</h3>
          <p>
            Use the existing Google Drive Sunday School folder as source material, then paste only the pared-down printable/readable parts into this lesson.
          </p>
          <button
            className="text-button"
            onClick={() => updateDraft("source_notes", `${draft.source_notes}${draft.source_notes ? "\n" : ""}Google Drive: Sunday School folder`)}
            type="button"
            disabled={!canEdit}
          >
            <CalendarDays size={14} aria-hidden="true" />
            Add folder note
          </button>
        </div>
      </aside>
    </section>
  );
}
