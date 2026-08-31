import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Gamepad2,
  Library,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Search,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeClose } from "./useEscapeClose";

import {
  ApiError,
  createSundaySchoolLesson,
  getSundaySchoolLessons,
  getSundaySchoolLessonHistory,
  getSundaySchoolResources,
  getMembers,
  importSundaySchoolResources,
  sundaySchoolResourceFileUrl,
  updateSundaySchoolLesson,
  type Member,
  type SundaySchoolLesson,
  type SundaySchoolHistoryEntry,
  type SundaySchoolLessonPayload,
  type SundaySchoolResource,
} from "../api";
import { useDurableChange } from "../changePolling";
import { calendarColors, calendarMarkers } from "../userCalendarStyle";
import { calendarDatesAround, effectiveLeaderIdForDate, sundayDatesAround, unavailabilityForRole, type SundayLeader } from "../leaderSchedule";
import { CalendarPopup } from "./CalendarPopup";
import { DateNavigator, formatNavigatorDate } from "./DateNavigator";
import { LeaderAssignmentDialog } from "./LeaderAssignmentDialog";
import { useConfirmationDialog } from "./ConfirmationDialog";

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
  { key: "activity", label: "Printout / Activity", icon: Library, resourceTypes: ["coloring", "worksheet", "puzzle", "media"] },
  { key: "game", label: "Game", icon: Gamepad2, resourceTypes: ["game"] },
  { key: "resources", label: "All Resources", icon: Library, resourceTypes: ["lesson_packet", "bible_story", "craft", "game", "coloring", "worksheet", "puzzle", "media"] },
];

const RESOURCE_LABELS: Record<string, string> = {
  lesson_packet: "Packet",
  bible_story: "Bible",
  craft: "Craft",
  game: "Game",
  coloring: "Coloring",
  worksheet: "Sheet",
  puzzle: "Puzzle",
  media: "Video",
};

const TEACHER_COLORS = ["teacher-a", "teacher-b", "teacher-c", "teacher-d", "teacher-e", "teacher-f"];

function dateInputFromDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
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

function isPrintableResource(resource: SundaySchoolResource) {
  return Boolean(resource.page_start && ["coloring", "worksheet", "puzzle", "craft"].includes(resource.resource_type));
}

function generatedLessonContent(theme: string, reference: string) {
  const nextTheme = theme.trim() || "Love in Action";
  const nextReference = reference.trim() || "1 John 3:16-18";
  const mainIdea = "God loves us first and helps us show love with our actions.";
  return {
    theme: nextTheme,
    bible_reference: nextReference,
    bible_story: [
      `${nextTheme} (${nextReference})`,
      `Main idea: ${mainIdea}`,
      "Younger story (3-5): Jesus loves us and shows us what love looks like. Love is not only something we say. We can show love by sharing, helping, using gentle hands, and being kind.",
      "Older story (6-12): The Bible teaches that real love shows up in what we do. Jesus gave himself for us, so we can look for people who need help and choose actions that show God's love.",
      "Questions for younger children:\n1. Who loves us first?\n2. What is one kind thing we can do today?\n3. How can our hands show love?",
      "Questions for older children:\n1. Why do actions matter as well as words?\n2. What might stop us from helping someone?\n3. Who could we encourage or serve this week?",
      "Prayer:\nDear God, thank you for loving us first. Thank you for Jesus. Help us love with kind words and helpful actions. Show us someone we can help today. Amen.",
    ].join("\n\n"),
    crafts: "Kindness coupon card: children make a small card with 2-3 coupons for helpful actions, such as tidy up, share a toy, make a drink, or pray for someone.\n\nSimple heart plate: decorate a paper plate with hearts and draw three ways to show love this week.",
    games: "Love in action charades: children act out kind actions such as sharing, helping, listening, welcoming, or praying, while the group guesses.\n\nPass the kindness: pass a soft item around the circle; whoever holds it names one kind action they can do.",
    source_notes: "Printable ideas:\n- Colouring page: Jesus helping and welcoming children.\n- Word search: love, help, share, kind, Jesus, truth, action.\n- Younger activity: match kind actions to pictures.\n- Older activity: write one real action beside three people they can encourage.",
    teacher_notes: "Generated starter plan. Review wording, choose one craft, and add/print any PDF activity pages before Sunday.",
  };
}

function firstLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

export function SundaySchoolView({ active = true, canEdit }: { active?: boolean; canEdit: boolean }) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [lessons, setLessons] = useState<SundaySchoolLesson[]>([]);
  const [resources, setResources] = useState<SundaySchoolResource[]>([]);
  const [users, setUsers] = useState<Member[]>([]);
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  const [selectedDate, setSelectedDate] = useState(nextSundayDateInput());
  const [draft, setDraft] = useState<SundaySchoolLessonPayload>(() => blankLesson(nextSundayDateInput()));
  const [mobilePane, setMobilePane] = useState<SundaySchoolPane>("library");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SundaySchoolHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyApplying, setHistoryApplying] = useState(false);
  const [selectedElementKey, setSelectedElementKey] = useState<LessonElementKey>("passage");
  const [expandedElementKey, setExpandedElementKey] = useState<LessonElementKey | null>(null);
  const [teacherPickerDate, setTeacherPickerDate] = useState<string | null>(null);
  const [teacherSaving, setTeacherSaving] = useState(false);
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
  const [resourceQuery, setResourceQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lessonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEscapeClose(resourcePickerOpen, () => setResourcePickerOpen(false));
  useEscapeClose(historyOpen, () => setHistoryOpen(false));
  useEffect(() => {
    if (!historyOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".sunday-school-history-popover, .date-navigator-history")) setHistoryOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [historyOpen]);

  const lessonsByDate = useMemo(
    () => new Map(lessons.map((lesson) => [dateInputFromIso(lesson.lesson_date), lesson])),
    [lessons],
  );
  const sundaySchoolTeachers = useMemo(
    () => users
      .filter((user) => user.active && (user.roles.includes("sunday_school_teacher") || user.approved_serving_areas.includes("sunday_school")))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [users],
  );
  const sundaySchoolTeacherByName = useMemo(
    () => new Map(sundaySchoolTeachers.map((user) => [user.name.trim().toLocaleLowerCase(), user])),
    [sundaySchoolTeachers],
  );
  const sundaySchoolTeacherMarkers = useMemo(() => calendarMarkers(sundaySchoolTeachers), [sundaySchoolTeachers]);
  const sundaySchoolTeacherColors = useMemo(() => calendarColors(sundaySchoolTeachers), [sundaySchoolTeachers]);
  const teacherRotationLeaders = useMemo<SundayLeader[]>(
    () => sundaySchoolTeachers.map((teacher) => ({
      id: teacher.id,
      name: teacher.name,
      maxSundaysPerMonth: teacher.sunday_school_max_sundays_per_month,
      rotationMode: teacher.serving_rotation_modes.sunday_school ?? "auto",
      unavailable: unavailabilityForRole(teacher.unavailable, "sunday_school"),
    })),
    [sundaySchoolTeachers],
  );
  const explicitTeacherAssignments = useMemo(
    () => new Map(
      lessons.flatMap((lesson) => {
        const teacher = sundaySchoolTeacherByName.get(lesson.teacher_name.trim().toLocaleLowerCase());
        return teacher ? [[dateInputFromIso(lesson.lesson_date), teacher.id] as const] : [];
      }),
    ),
    [lessons, sundaySchoolTeacherByName],
  );
  function teacherIdForDate(date: string) {
    return effectiveLeaderIdForDate(date, teacherRotationLeaders, explicitTeacherAssignments);
  }
  function teacherNameForDate(date: string) {
    const lessonName = lessonsByDate.get(date)?.teacher_name.trim();
    if (lessonName) return lessonName;
    const teacherId = teacherIdForDate(date);
    return sundaySchoolTeachers.find((teacher) => teacher.id === teacherId)?.name ?? "";
  }
  const selectedTeacherName = draft.teacher_name.trim() || teacherNameForDate(selectedDate);
  const selectedElement = LESSON_ELEMENTS.find((element) => element.key === selectedElementKey) ?? LESSON_ELEMENTS[0];
  const allCalendarDates = useMemo(() => calendarDatesAround(selectedDate), [selectedDate]);
  const sundayCalendarDates = useMemo(() => sundayDatesAround(selectedDate), [selectedDate]);
  function sundaySchoolCalendarDay(dateInput: string) {
    const lesson = lessonsByDate.get(dateInput);
    const teacherName = teacherNameForDate(dateInput);
    const teacher = sundaySchoolTeacherByName.get(teacherName.toLocaleLowerCase());
    const isSunday = new Date(`${dateInput}T12:00:00`).getDay() === 0;
    return {
      date: dateInput,
      className: `${lesson || isSunday ? "has-service" : ""} ${teacher ? sundaySchoolTeacherColors.get(teacher.id) ?? "" : teacherColor(teacherName)}`.trim(),
    };
  }
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
  const elementPrintableResources = useMemo(
    () => elementResources.filter(isPrintableResource),
    [elementResources],
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

  async function load(silent = false) {
    if (!silent) {
      setLoading(true);
      setMessage(null);
    }
    try {
      const from = new Date();
      from.setDate(from.getDate() - 210);
      const to = new Date();
      to.setDate(to.getDate() + 210);
      const [nextLessons, nextResources, nextUsers] = await Promise.all([
        getSundaySchoolLessons({ from_date: dateInputFromDate(from), to_date: dateInputFromDate(to) }),
        getSundaySchoolResources(),
        getMembers(),
      ]);
      setLessons(nextLessons);
      setResources(nextResources);
      setUsers(nextUsers);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Sunday School.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useDurableChange(() => {
    void load(true);
  }, active, ["planning", "identity"]);

  useEffect(() => {
    setTopbarSlot(document.getElementById("workspace-topbar-slot"));
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
    setCalendarOpen(false);
    setMobilePane("set");
  }

  function shiftSelectedDate(weeks: number) {
    const date = new Date(`${selectedDate}T12:00:00`);
    if (Number.isNaN(date.getTime())) {
      return;
    }
    date.setDate(date.getDate() + weeks * 7);
    chooseDate(dateInputFromDate(date));
  }

  async function saveLessonDraft(nextDraft: SundaySchoolLessonPayload, date = selectedDate) {
    if (!canEdit) {
      setMessage("You do not have permission to edit Sunday School lessons.");
      return null;
    }
    const existingLesson = lessonsByDate.get(date) ?? null;
    const payload = { ...nextDraft, lesson_date: date };
    const saved = existingLesson ? await updateSundaySchoolLesson(existingLesson.id, payload) : await createSundaySchoolLesson(payload);
    setLessons((current) => {
      const withoutSaved = current.filter((lesson) => lesson.id !== saved.id);
      return [...withoutSaved, saved].sort((left, right) => left.lesson_date.localeCompare(right.lesson_date));
    });
    return saved;
  }

  async function assignTeacher(date: string, teacherId: string | null) {
    const name = sundaySchoolTeachers.find((teacher) => teacher.id === teacherId)?.name ?? "";
    const lesson = lessonsByDate.get(date);
    const nextDraft = lesson ? draftFromLesson(lesson) : blankLesson(date);
    nextDraft.teacher_name = name;
    setTeacherSaving(true);
    try {
      const saved = await saveLessonDraft(nextDraft, date);
      if (saved && date === selectedDate) {
        setDraft(draftFromLesson(saved));
      }
      setMessage(name ? `Teacher set to ${name}.` : "Automatic teacher rotation restored.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not assign teacher.");
    } finally {
      setTeacherSaving(false);
    }
  }

  async function swapTeacherWith(date: string) {
    if (!teacherPickerDate || date === teacherPickerDate) {
      return;
    }
    const sourceLesson = lessonsByDate.get(teacherPickerDate);
    const targetLesson = lessonsByDate.get(date);
    const sourceDraft = sourceLesson ? draftFromLesson(sourceLesson) : blankLesson(teacherPickerDate);
    const targetDraft = targetLesson ? draftFromLesson(targetLesson) : blankLesson(date);
    const sourceTeacher = teacherNameForDate(teacherPickerDate);
    sourceDraft.teacher_name = teacherNameForDate(date);
    targetDraft.teacher_name = sourceTeacher;
    setTeacherSaving(true);
    try {
      const [sourceSaved, targetSaved] = await Promise.all([
        saveLessonDraft(sourceDraft, teacherPickerDate),
        saveLessonDraft(targetDraft, date),
      ]);
      if (sourceSaved && teacherPickerDate === selectedDate) setDraft(draftFromLesson(sourceSaved));
      if (targetSaved && date === selectedDate) setDraft(draftFromLesson(targetSaved));
      setTeacherPickerDate(null);
      setMessage("Teachers swapped.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not swap teachers.");
    } finally {
      setTeacherSaving(false);
    }
  }

  function elementSummary(element: LessonElement) {
    if (element.key === "passage") {
      return draft.bible_reference || firstLine(draft.bible_story) || "Choose passage";
    }
    if (element.key === "craft") {
      return firstLine(draft.crafts) || "Choose craft";
    }
    if (element.key === "activity") {
      const printableCount = selectedResources.filter(
        (resource) => element.resourceTypes.includes(resource.resource_type) && isPrintableResource(resource),
      ).length;
      return firstLine(draft.source_notes) || (printableCount ? `${printableCount} printables` : "Choose activity");
    }
    if (element.key === "game") {
      return firstLine(draft.games) || "Choose game";
    }
    return selectedResources.length ? `${selectedResources.length} resources` : "No dated resources";
  }

  function elementDraftField(element: LessonElement): keyof SundaySchoolLessonPayload | null {
    if (element.key === "passage") return "bible_story";
    if (element.key === "craft") return "crafts";
    if (element.key === "activity") return "source_notes";
    if (element.key === "game") return "games";
    return null;
  }

  function elementTextValue(element: LessonElement) {
    const field = elementDraftField(element);
    return field ? draft[field] : "";
  }

  function updateElementText(element: LessonElement, value: string) {
    const field = elementDraftField(element);
    if (field) {
      updateDraft(field, value);
    }
  }

  function printResource(resource: SundaySchoolResource) {
    const url = sundaySchoolResourceFileUrl(resource.id);
    const printWindow = window.open(url, "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setMessage("Could not open the printable page.");
      return;
    }
    window.setTimeout(() => {
      try {
        printWindow.print();
      } catch {
        // The browser may block script access to the PDF viewer; the page is still open for native print.
      }
    }, 900);
  }

  function printElementResources() {
    if (!elementPrintableResources.length) {
      setMessage("No printable pages for this element.");
      return;
    }
    for (const [index, resource] of elementPrintableResources.entries()) {
      window.setTimeout(() => printResource(resource), index * 650);
    }
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
    const printables = selectedResources.filter(isPrintableResource);
    setDraft((current) => ({
      ...current,
      theme: current.theme || packet?.theme || passage?.theme || "",
      bible_reference: current.bible_reference || passage?.bible_reference || "",
      bible_story: current.bible_story || packet?.summary || (passage ? resourceAssignment(passage) : ""),
      crafts: current.crafts || (craft ? resourceAssignment(craft) : ""),
      games: current.games || (game ? resourceAssignment(game) : ""),
      source_notes: current.source_notes || printables.map((resource) => `${resourceMeta(resource)}\n${resource.title}`).join("\n\n"),
    }));
  }

  function generateLesson() {
    const generated = generatedLessonContent(draft.theme, draft.bible_reference);
    setDraft((current) => ({
      ...current,
      theme: current.theme || generated.theme,
      bible_reference: current.bible_reference || generated.bible_reference,
      bible_story: current.bible_story || generated.bible_story,
      crafts: current.crafts || generated.crafts,
      games: current.games || generated.games,
      source_notes: current.source_notes || generated.source_notes,
      teacher_notes: current.teacher_notes || generated.teacher_notes,
    }));
    setMessage("Generated a starter lesson plan.");
  }

  async function saveLesson() {
    if (!canEdit) {
      setMessage("You do not have permission to edit Sunday School lessons.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveLessonDraft(draft);
      if (!saved) return;
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

  function formatHistoryTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short" });
  }

  async function openLessonHistory() {
    const lesson = lessonsByDate.get(selectedDate);
    if (!lesson || historyApplying) return;
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setCalendarOpen(false);
    setHistoryLoading(true);
    setHistoryOpen(true);
    try {
      setHistory(await getSundaySchoolLessonHistory(lesson.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load lesson history.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function restoreLessonHistory(entry: SundaySchoolHistoryEntry) {
    const lesson = lessonsByDate.get(selectedDate);
    if (!lesson || historyApplying) return;
    const confirmed = await confirm({
      confirmLabel: "Restore version",
      message: "Restore the lesson to this point in time? Changes made after it will be unwound, and this restore will be recorded in history.",
      title: "Restore Lesson Version",
    });
    if (!confirmed) return;
    setHistoryApplying(true);
    try {
      const saved = await updateSundaySchoolLesson(lesson.id, entry.after);
      setLessons((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
      setDraft(draftFromLesson(saved));
      setHistoryOpen(false);
      setMessage("Lesson restored to the selected version.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not restore this lesson version.");
    } finally {
      setHistoryApplying(false);
    }
  }

  async function undoLessonHistoryEntry(entry: SundaySchoolHistoryEntry) {
    const lesson = lessonsByDate.get(selectedDate);
    if (!lesson || historyApplying) return;
    setHistoryApplying(true);
    try {
      const current = draftFromLesson(lesson);
      const target = { ...current };
      for (const field of Object.keys(entry.before) as Array<keyof SundaySchoolLessonPayload>) {
        if (entry.before[field] !== entry.after[field]) target[field] = entry.before[field] as never;
      }
      const saved = await updateSundaySchoolLesson(lesson.id, target);
      setLessons((lessons) => lessons.map((candidate) => candidate.id === saved.id ? saved : candidate));
      setDraft(draftFromLesson(saved));
      setHistory(await getSundaySchoolLessonHistory(lesson.id));
      setMessage(`Undid only: ${entry.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not undo this lesson change.");
    } finally {
      setHistoryApplying(false);
    }
  }

  function lessonHistoryContent() {
    if (!historyOpen) return null;
    return (
      <section className="worship-history-popover sunday-school-history-popover" aria-label="Sunday School edit history">
        <div className="worship-history-popover-heading">
          <strong>Edit History</strong>
          <button aria-label="Close edit history" className="section-icon-button" onClick={() => setHistoryOpen(false)} type="button"><X size={14} aria-hidden="true" /></button>
        </div>
        <div className="worship-history-list">
          {historyLoading ? <p className="search-empty">Loading history...</p> : null}
          {!historyLoading && !history.length ? <p className="search-empty">No lesson edits recorded yet.</p> : null}
          {history[0] ? (
            <div className="worship-history-row">
              <button className="history-version-button" disabled={historyApplying} onClick={() => void restoreLessonHistory({ ...history[0], id: `original-${history[0].id}`, label: "Original lesson", after: history[0].before })} title="Restore the original lesson" type="button">
                <span>Original lesson</span><small>First recorded version</small>
              </button>
            </div>
          ) : null}
          {[...history].reverse().map((entry) => (
            <div className="worship-history-row" key={entry.id}>
              <button className="history-version-button" disabled={historyApplying} onClick={() => void restoreLessonHistory(entry)} title="Restore this point in time" type="button">
                <span>{entry.label}</span>
                <small>{[entry.actor_name, formatHistoryTime(entry.created_at)].filter(Boolean).join(" · ")}</small>
              </button>
              <button aria-label={`Undo only ${entry.label}`} className="history-single-undo-button" disabled={historyApplying} onClick={() => void undoLessonHistoryEntry(entry)} title="Undo only this change" type="button">
                <RotateCcw size={15} aria-hidden="true" /><span>Undo change</span>
              </button>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={`worship-builder sunday-school-as-worship worship-builder-pane-${mobilePane}`} aria-label="Sunday School lessons">
      {confirmationDialog}
      {active && topbarSlot
        ? createPortal(
            <div className="presentation-topbar-tools">
              <DateNavigator
                assignmentDisabled={!canEdit}
                assignmentLabel={selectedTeacherName || "Leader"}
                assignmentTitle={selectedTeacherName ? `Leader: ${selectedTeacherName}` : "Assign leader"}
                historyContent={lessonHistoryContent()}
                historyDisabled={!lessonsByDate.get(selectedDate) || historyApplying}
                historyExpanded={historyOpen}
                historyLabel="Sunday School edit history"
                label={formatNavigatorDate(selectedDate)}
                nextLabel="Next Sunday"
                onHistory={() => void openLessonHistory()}
                onAssignment={() => setTeacherPickerDate(selectedDate)}
                onNext={() => shiftSelectedDate(1)}
                onOpenPicker={() => setCalendarOpen(true)}
                onPrevious={() => shiftSelectedDate(-1)}
                pickerLabel="Choose Sunday School lesson"
                previousLabel="Previous Sunday"
              />
            </div>,
            topbarSlot,
          )
        : null}
      <div className="worship-mobile-pane-tabs" aria-label="Sunday School panels">
        <button className={mobilePane === "library" ? "active" : ""} onClick={() => setMobilePane("library")} type="button">
          Lessons <span>{scheduleDates.length}</span>
        </button>
        <button className={mobilePane === "set" ? "active" : ""} onClick={() => setMobilePane("set")} type="button">
          Elements <span>{LESSON_ELEMENTS.length}</span>
        </button>
      </div>

      <aside className={`worship-song-browser ${mobilePane === "library" ? "is-mobile-active" : ""}`}>
        <div className="worship-library-search-row sunday-school-date-row">
          <button className="text-button" disabled={!canEdit || importing} onClick={() => void importResources()} type="button">
            <RefreshCw size={14} aria-hidden="true" />
            {importing ? "Importing..." : "Import"}
          </button>
        </div>
        <div className="worship-song-list sunday-school-lesson-list">
          {scheduleDates.map((date) => {
            const lesson = lessonsByDate.get(date);
            const teacherName = teacherNameForDate(date);
            const resourcesCount = resources.filter((resource) => dateInputFromIso(resource.lesson_date) === date).length;
            return (
              <div className={`song-library-row ${selectedDate === date ? "selected" : ""} ${teacherColor(teacherName)}`} key={date}>
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
                      {teacherName ? ` | ${teacherName}` : " | No teacher available"}
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
            <button className="text-button sunday-school-use-matched-button" disabled={!canEdit || !selectedResources.length} onClick={applyMatchedResources} type="button">
              <CheckCircle2 size={14} aria-hidden="true" />
              Use matched
            </button>
            <button className="text-button" disabled={!canEdit} onClick={generateLesson} type="button">
              <WandSparkles size={14} aria-hidden="true" />
              Generate
            </button>
            <button className="primary-button" disabled={!canEdit || saving} onClick={() => void saveLesson()} type="button">
              <Save size={16} aria-hidden="true" />
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
        {message ? <p className="status-message">{message}</p> : null}
        {loading ? <p className="empty-state">Loading lessons...</p> : null}
        <div className="sunday-school-core-fields">
          <label>
            <span>Theme</span>
            <input disabled={!canEdit} onChange={(event) => updateDraft("theme", event.target.value)} placeholder="Theme from plan" value={draft.theme} />
          </label>
          <label>
            <span>Bible Reference</span>
            <input disabled={!canEdit} onChange={(event) => updateDraft("bible_reference", event.target.value)} placeholder="e.g. John 6:56-69" value={draft.bible_reference} />
          </label>
        </div>
        <div className="worship-set-layout sunday-school-element-layout">
          <section className="worship-set-list" aria-label="Sunday School lesson elements">
            <div className="worship-section-list">
              {LESSON_ELEMENTS.map((element, index) => {
                const Icon = element.icon;
                const isSelected = selectedElementKey === element.key;
                const isExpanded = expandedElementKey === element.key;
                const count = selectedResources.filter((resource) => element.resourceTypes.includes(resource.resource_type)).length;
                return (
                  <article
                    className={`worship-set-item sunday-school-element-item ${isSelected ? "is-selected" : ""} ${isExpanded ? "slides-expanded" : ""}`}
                    key={element.key}
                    onClick={() => {
                      setSelectedElementKey(element.key);
                      setExpandedElementKey((current) => (current === element.key ? null : element.key));
                    }}
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
                    <button
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "Hide" : "Show"} ${element.label}`}
                      className="section-icon-button worship-set-slide-toggle sunday-school-element-toggle"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedElementKey(element.key);
                        setExpandedElementKey((current) => (current === element.key ? null : element.key));
                      }}
                      type="button"
                    >
                      {isExpanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                    </button>
                    {isExpanded ? (
                      <div className="sunday-school-mobile-resource-panel">
                        {elementDraftField(element) ? (
                          <textarea
                            disabled={!canEdit}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => updateElementText(element, event.target.value)}
                            placeholder={`${element.label} notes`}
                            value={elementTextValue(element)}
                          />
                        ) : null}
                        <button className="text-button" disabled={!canEdit || element.key === "resources"} onClick={() => setResourcePickerOpen(true)} type="button">
                          <Search size={14} aria-hidden="true" />
                          Choose alternative
                        </button>
                        {elementResources.slice(0, 5).map((resource) => (
                          <div className="sunday-school-mobile-resource-row" key={resource.id}>
                            <a href={sundaySchoolResourceFileUrl(resource.id)} rel="noreferrer" target="_blank">
                              <span>{resourceMeta(resource)}</span>
                              <strong>{resource.title}</strong>
                            </a>
                            {isPrintableResource(resource) ? (
                              <button className="section-icon-button" onClick={(event) => { event.stopPropagation(); printResource(resource); }} type="button" aria-label={`Print ${resource.title}`}>
                                <Printer size={14} aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
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
              {elementPrintableResources.length ? (
                <button
                  aria-label={`Print ${elementPrintableResources.length} printable pages`}
                  className="section-icon-button"
                  onClick={printElementResources}
                  type="button"
                >
                  <Printer size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {elementDraftField(selectedElement) ? (
              <textarea
                className="sunday-school-element-textarea"
                disabled={!canEdit}
                onChange={(event) => updateElementText(selectedElement, event.target.value)}
                placeholder={`${selectedElement.label} notes`}
                value={elementTextValue(selectedElement)}
              />
            ) : null}
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
                  {isPrintableResource(resource) ? (
                    <button className="text-button" onClick={() => printResource(resource)} type="button">
                      <Printer size={14} aria-hidden="true" />
                      Print
                    </button>
                  ) : null}
                </article>
              ))}
              {!elementResources.length ? <p className="empty-state compact-empty">No linked resources for this Sunday.</p> : null}
            </div>
          </section>
        </div>
      </main>

      <CalendarPopup
        isOpen={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        title="Sunday School"
        eyebrow="Calendar"
        allDays={allCalendarDates.map(sundaySchoolCalendarDay)}
        sundayDays={sundayCalendarDates.map((dateInput) => {
          const lesson = lessonsByDate.get(dateInput);
          const teacherName = teacherNameForDate(dateInput);
          const teacher = sundaySchoolTeacherByName.get(teacherName.toLocaleLowerCase());
          return {
            date: dateInput,
            className: `${lesson ? "has-service" : ""} ${teacher ? sundaySchoolTeacherColors.get(teacher.id) ?? "" : teacherColor(teacherName)}`.trim(),
          };
        })}
        selectedDate={selectedDate}
        resolveDay={sundaySchoolCalendarDay}
        onDateSelect={(dateInput) => chooseDate(dateInput)}
        dayContent={(day) => {
          const teacherName = teacherNameForDate(day.date);
          const teacher = sundaySchoolTeacherByName.get(teacherName.toLocaleLowerCase());
          const lesson = lessonsByDate.get(day.date);
          const date = new Date(`${day.date}T12:00:00`);
          return (
            <>
              <span>{date.getDate()}</span>
              {teacher ? (
                <span className="calendar-user-marker" aria-label={teacher.name} title={teacher.name}>
                  {sundaySchoolTeacherMarkers.get(teacher.id)}
                </span>
              ) : teacherName ? (
                <span className="calendar-user-marker" aria-label={teacherName} title={teacherName}>
                  {teacherName.charAt(0).toUpperCase()}
                </span>
              ) : null}
              {lesson?.theme || lesson?.bible_reference ? <small>{lesson.theme || lesson.bible_reference}</small> : null}
            </>
          );
        }}
      />

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

      <LeaderAssignmentDialog
        areaLabel="Sunday School"
        areaKey="sunday_school"
        busy={teacherSaving}
        currentDate={teacherPickerDate}
        explicitLeaderId={teacherPickerDate ? explicitTeacherAssignments.get(teacherPickerDate) ?? null : null}
        leaderIdForDate={teacherIdForDate}
        leaders={sundaySchoolTeachers}
        maxSundaysForLeader={(teacher) => teacher.sunday_school_max_sundays_per_month}
        rotationModeForLeader={(teacher) => teacher.serving_rotation_modes.sunday_school ?? "auto"}
        onAssign={(teacherId) => {
          if (teacherPickerDate) void assignTeacher(teacherPickerDate, teacherId);
        }}
        onClose={() => setTeacherPickerDate(null)}
        onSwap={(targetDate) => void swapTeacherWith(targetDate)}
      />
    </section>
  );
}
