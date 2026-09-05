import { ChevronDown, GripVertical, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { createPlanType, getBroadcastViewerSettings, getPlanTypes, updatePlanType, type BroadcastAudioScene, type PlanType } from "../api";

const SECTION_TYPES = [
  ["custom", "Custom section"],
  ["pre_service", "Welcome / pre-service"],
  ["worship_set", "Worship set"],
  ["open_time", "Open time"],
  ["sermon", "Sermon"],
  ["announcements", "Announcements"],
  ["post_service", "Post-service"],
  ["welcome_montage", "Welcome montage"],
  ["welcome_countdown", "Countdown"],
  ["welcome_seated", "Holding slide"],
] as const;

function blankType(): PlanType {
  return {
    id: "",
    name: "",
    description: null,
    starts_at: null,
    automation_start: null,
    default_duration_minutes: 90,
    active: true,
    default_outline: [],
  };
}

export function PlanTypeManager({ onChanged, onMessage }: { onChanged?: () => void; onMessage: (message: string) => void }) {
  const [types, setTypes] = useState<PlanType[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<PlanType>(blankType());
  const [saving, setSaving] = useState(false);
  const [scenes, setScenes] = useState<BroadcastAudioScene[]>([]);
  const [expandedSectionSettings, setExpandedSectionSettings] = useState<Set<string>>(() => new Set());
  const [draggedOutlineId, setDraggedOutlineId] = useState<string | null>(null);

  async function load(preferredId?: string) {
    const [next, settings] = await Promise.all([getPlanTypes(), getBroadcastViewerSettings()]);
    setScenes(settings.audio_scenes);
    setTypes(next);
    const selected = next.find((type) => type.id === (preferredId ?? selectedId)) ?? next[0];
    if (selected) {
      setSelectedId(selected.id);
      setDraft(structuredClone({ ...selected, automation_start: selected.automation_start ?? selected.starts_at }));
    }
  }

  useEffect(() => { void load().catch((error) => onMessage(error instanceof Error ? error.message : "Could not load service types.")); }, []);

  function selectType(id: string) {
    setSelectedId(id);
    const selected = types.find((type) => type.id === id);
    setDraft(selected ? structuredClone({ ...selected, automation_start: selected.automation_start ?? selected.starts_at }) : blankType());
  }

  async function save() {
    if (!draft.name.trim()) {
      onMessage("Give the service type a name.");
      return;
    }
    setSaving(true);
    try {
      const { id: _id, ...payload } = { ...draft, name: draft.name.trim(), starts_at: draft.automation_start };
      const saved = draft.id
        ? await updatePlanType(draft.id, payload)
        : await createPlanType(payload);
      await load(saved.id);
      onChanged?.();
      onMessage(`Service type “${saved.name}” saved.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not save service type.");
    } finally {
      setSaving(false);
    }
  }

  function updateOutline(index: number, patch: Partial<PlanType["default_outline"][number]>) {
    setDraft((current) => ({
      ...current,
      default_outline: current.default_outline.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  function dropOutline(targetIndex: number) {
    if (!draggedOutlineId) return;
    setDraft((current) => {
      const sourceIndex = current.default_outline.findIndex((item) => item.id === draggedOutlineId);
      const source = current.default_outline[sourceIndex];
      const target = current.default_outline[targetIndex];
      if (!source || !target || (source.parent_id ?? null) !== (target.parent_id ?? null) || sourceIndex === targetIndex) return current;
      const siblings = current.default_outline.filter((item) => (item.parent_id ?? null) === (source.parent_id ?? null));
      const sourceSiblingIndex = siblings.findIndex((item) => item.id === source.id);
      const targetSiblingIndex = siblings.findIndex((item) => item.id === target.id);
      siblings.splice(sourceSiblingIndex, 1);
      siblings.splice(targetSiblingIndex, 0, source);
      let next: PlanType["default_outline"];
      if (source.parent_id) {
        const siblingIds = new Set(siblings.map((item) => item.id));
        let siblingIndex = 0;
        next = current.default_outline.map((item) => siblingIds.has(item.id) ? siblings[siblingIndex++] : item);
      } else {
        next = siblings.flatMap((root) => [root, ...current.default_outline.filter((item) => item.parent_id === root.id)]);
      }
      next = next.map((item) => {
        const position = next.filter((candidate) => (candidate.parent_id ?? null) === (item.parent_id ?? null)).findIndex((candidate) => candidate.id === item.id);
        return { ...item, sequence: String((position + 1) * 10) };
      });
      return { ...current, default_outline: next };
    });
    setDraggedOutlineId(null);
  }

  function addOutlineItem(parentId: string | null = null) {
    setDraft((current) => {
      const item = {
        id: crypto.randomUUID?.() ?? `template-${Date.now()}`,
        parent_id: parentId,
        item_type: parentId ? "open_time" : "custom",
        title: parentId ? "New slide" : "New section",
        sequence: String((current.default_outline.filter((candidate) => (candidate.parent_id ?? null) === parentId).length + 1) * 10),
        comment: null,
        presentation_options: {},
      };
      if (!parentId) return { ...current, default_outline: [...current.default_outline, item] };
      const parentIndex = current.default_outline.findIndex((candidate) => candidate.id === parentId);
      if (parentIndex < 0) return current;
      let insertIndex = parentIndex + 1;
      while (current.default_outline[insertIndex]?.parent_id === parentId) insertIndex += 1;
      const next = [...current.default_outline];
      next.splice(insertIndex, 0, item);
      return { ...current, default_outline: next };
    });
  }

  return (
    <section className="subsection-panel admin-settings-panel plan-type-settings">
      <div className="section-heading">
        <div><p className="eyebrow">Service templates</p><h3>Service types, sections and cues</h3></div>
        <div className="action-row">
          <button className="text-button" onClick={() => { setSelectedId(""); setDraft(blankType()); }} type="button"><Plus size={15} /> New type</button>
          <button className="primary-button" disabled={saving} onClick={() => void save()} type="button"><Save size={15} /> {saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
      <p className="muted-copy">The template starts once at the scheduled automation time. Each slide then owns its duration, next-slide action, scene and display destinations.</p>
      <label>Service type<select onChange={(event) => selectType(event.target.value)} value={selectedId}><option value="">New service type</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
      <div className="broadcast-settings-grid">
        <label>Name<input maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} /></label>
        <label>Automated start<input onChange={(event) => setDraft({ ...draft, automation_start: event.target.value || null, starts_at: event.target.value || null })} type="time" value={draft.automation_start ?? draft.starts_at ?? ""} /></label>
        <label>Default duration (minutes)<input min={1} onChange={(event) => setDraft({ ...draft, default_duration_minutes: Number(event.target.value) || null })} type="number" value={draft.default_duration_minutes ?? ""} /></label>
        <label className="toggle-row"><input checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} type="checkbox" /> Available when creating services</label>
      </div>
      <label>Description<textarea maxLength={500} onChange={(event) => setDraft({ ...draft, description: event.target.value || null })} value={draft.description ?? ""} /></label>
      <div className="stack plan-type-outline" aria-label="Template outline">
        {draft.default_outline.map((item, index) => (
          <div className={`plan-type-outline-row ${item.parent_id ? "is-child" : "is-section"} ${draggedOutlineId === item.id ? "is-dragging" : ""}`} key={item.id ?? `${index}:${item.sequence}`} onDragOver={(event) => { if (draggedOutlineId) event.preventDefault(); }} onDrop={() => dropOutline(index)}>
            <div className="template-row-main">
              <button aria-label={`Reorder ${item.title}`} className="template-drag-handle" draggable onDragEnd={() => setDraggedOutlineId(null)} onDragStart={(event) => { setDraggedOutlineId(item.id ?? null); event.dataTransfer.effectAllowed = "move"; }} title={`Drag to reorder ${item.parent_id ? "within this section" : "sections"}`} type="button"><GripVertical size={17} aria-hidden="true" /></button>
              <span className="template-row-kind">{item.parent_id ? "Slide" : "Section"}</span>
              <input aria-label={`${item.parent_id ? "Slide" : "Section"} ${index + 1} title`} onChange={(event) => updateOutline(index, { title: event.target.value })} placeholder={item.parent_id ? "Slide title" : "Section title"} value={item.title} />
              <select aria-label={`${item.parent_id ? "Slide" : "Section"} ${index + 1} type`} onChange={(event) => updateOutline(index, { item_type: event.target.value })} value={item.item_type}>{SECTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <div className="template-row-actions">
                <button aria-label={`Remove ${item.title}`} className="section-icon-button section-remove-button" onClick={() => setDraft((current) => ({ ...current, default_outline: current.default_outline.filter((entry, itemIndex) => itemIndex !== index && entry.parent_id !== item.id) }))} title="Remove" type="button"><Trash2 size={14} /></button>
              </div>
            </div>
            {!item.parent_id ? <div className="template-section-options"><label className="toggle-row"><input checked={Boolean(item.presentation_options?.auto_collapse_items)} onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, auto_collapse_items: event.target.checked } })} type="checkbox" /> Auto-contract items</label><label className="toggle-row"><input checked={Boolean(item.presentation_options?.end_after_section)} onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, end_after_section: event.target.checked } })} type="checkbox" /> End service after this section</label><button className="text-button template-add-child" onClick={() => addOutlineItem(item.id ?? null)} type="button"><Plus size={13} /> Add slide</button><button aria-expanded={expandedSectionSettings.has(item.id ?? String(index))} className="text-button template-section-settings-toggle" onClick={() => { const key = item.id ?? String(index); setExpandedSectionSettings((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; }); }} type="button">Settings <ChevronDown size={13} /></button></div> : null}
            {(item.parent_id || expandedSectionSettings.has(item.id ?? String(index))) ? <div className={`template-cue-controls ${item.parent_id ? "" : "is-section-controls"}`}>
              <span className="template-controls-label">Playback</span>
              <label>Image dwell <span className="field-unit">seconds</span><input min={1} onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, dwell_seconds: Number(event.target.value) } })} type="number" value={item.presentation_options?.dwell_seconds ?? 12} /></label>
              <label className="toggle-row"><input checked={Boolean(item.presentation_options?.auto_advance)} onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, auto_advance: event.target.checked } })} type="checkbox" /> Auto-advance</label>
              <label>Automated start<input onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, scheduled_start: event.target.value } })} type="time" value={item.presentation_options?.scheduled_start ?? ""} /></label>
              {item.presentation_options?.auto_advance ? <label>Advance after <span className="field-unit">seconds</span><input min={1} onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, auto_advance_seconds: Number(event.target.value) } })} type="number" value={item.presentation_options?.auto_advance_seconds ?? item.presentation_options?.dwell_seconds ?? 12} /></label> : null}
              <label>Scene<select onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, audio_scene_id: event.target.value || undefined } })} value={item.presentation_options?.audio_scene_id ?? ""}><option value="">Automatic</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.label}</option>)}</select></label>
              <label className="toggle-row"><input checked={(item.presentation_options?.display_targets ?? ["church", "livestream"]).includes("church")} onChange={(event) => { const targets = new Set(item.presentation_options?.display_targets ?? ["church", "livestream"]); event.target.checked ? targets.add("church") : targets.delete("church"); updateOutline(index, { presentation_options: { ...item.presentation_options, display_targets: [...targets] as Array<"church" | "livestream"> } }); }} type="checkbox" /> Church displays</label>
              <label className="toggle-row"><input checked={(item.presentation_options?.display_targets ?? ["church", "livestream"]).includes("livestream")} onChange={(event) => { const targets = new Set(item.presentation_options?.display_targets ?? ["church", "livestream"]); event.target.checked ? targets.add("livestream") : targets.delete("livestream"); updateOutline(index, { presentation_options: { ...item.presentation_options, display_targets: [...targets] as Array<"church" | "livestream"> } }); }} type="checkbox" /> Livestream</label>
              <details className="template-advanced-controls">
                <summary>Visual and overlay settings</summary>
                <div className="template-advanced-grid">
                  <label>Image fit<select onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, fit_mode: event.target.value as "contain" | "cover" } })} value={item.presentation_options?.fit_mode ?? "contain"}><option value="contain">Fit whole image</option><option value="cover">Fill and crop</option></select></label>
                  <label>Transition<select onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, transition: event.target.value as "fade" | "cut" | "slide" } })} value={item.presentation_options?.transition ?? "fade"}><option value="fade">Fade</option><option value="cut">Cut</option><option value="slide">Slide</option></select></label>
                  {item.item_type === "open_time" ? <label className="toggle-row"><input checked={Boolean(item.presentation_options?.repeat)} onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, repeat: event.target.checked } })} type="checkbox" /> Repeat montage</label> : null}
                  {["welcome_montage", "welcome_countdown", "welcome_seated", "open_time", "sermon", "announcements"].includes(item.item_type) ? <>
                    <label>Overlay type<select onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, overlay_mode: event.target.value as "none" | "static" | "countdown" } })} value={item.presentation_options?.overlay_mode ?? "none"}><option value="none">None</option><option value="static">Static text</option><option value="countdown">Text and countdown</option></select></label>
                    <label>Overlay text<input onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, overlay_text: event.target.value } })} value={item.presentation_options?.overlay_text ?? ""} /></label>
                    {item.presentation_options?.overlay_mode === "countdown" ? <label>Countdown <span className="field-unit">seconds</span><input min={1} onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, overlay_countdown_seconds: Number(event.target.value) } })} type="number" value={item.presentation_options?.overlay_countdown_seconds ?? 300} /></label> : null}
                    <label>Position<select onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, overlay_position: event.target.value as NonNullable<typeof item.presentation_options>["overlay_position"] } })} value={item.presentation_options?.overlay_position ?? "bottom"}><option value="top-left">Top left</option><option value="top">Top centre</option><option value="top-right">Top right</option><option value="left">Centre left</option><option value="centre">Centre</option><option value="right">Centre right</option><option value="bottom-left">Bottom left</option><option value="bottom">Bottom centre</option><option value="bottom-right">Bottom right</option></select></label>
                    <label>Text size<select onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, overlay_size: event.target.value as "small" | "medium" | "large" } })} value={item.presentation_options?.overlay_size ?? "medium"}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
                    <label>Font<select onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, overlay_font: event.target.value as NonNullable<typeof item.presentation_options>["overlay_font"] } })} value={item.presentation_options?.overlay_font ?? "sans"}><option value="sans">Clean sans</option><option value="display">Welcome display</option><option value="serif">Serif</option><option value="mono">Monospace</option></select></label>
                    <label>Text box opacity <span className="field-unit">{item.presentation_options?.overlay_panel_opacity ?? 68}%</span><input max={100} min={0} onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, overlay_panel_opacity: Number(event.target.value) } })} type="range" value={item.presentation_options?.overlay_panel_opacity ?? 68} /></label>
                    <label>Background dim <span className="field-unit">{item.presentation_options?.overlay_background_dim ?? 0}%</span><input max={80} min={0} onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, overlay_background_dim: Number(event.target.value) } })} type="range" value={item.presentation_options?.overlay_background_dim ?? 0} /></label>
                    {item.item_type === "announcements" ? <label>Announcement layout<select onChange={(event) => updateOutline(index, { presentation_options: { ...item.presentation_options, announcement_layout: event.target.value as "image" | "text" | "split" | "background" } })} value={item.presentation_options?.announcement_layout ?? "split"}><option value="split">Split image and text</option><option value="image">Image-led</option><option value="text">Text-led</option><option value="background">Full background</option></select></label> : null}
                  </> : null}
                </div>
              </details>
            </div> : null}
          </div>
        ))}
      </div>
      <button className="text-button" onClick={() => addOutlineItem()} type="button"><Plus size={14} /> Add section</button>
    </section>
  );
}
