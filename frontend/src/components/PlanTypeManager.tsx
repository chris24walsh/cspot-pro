import { ChevronDown, ChevronUp, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { createPlanType, getPlanTypes, updatePlanType, type PlanType } from "../api";

const SECTION_TYPES = [
  ["custom", "Custom section"],
  ["pre_service", "Welcome / pre-service"],
  ["worship_set", "Worship set"],
  ["open_time", "Open time"],
  ["sermon", "Sermon"],
  ["announcements", "Announcements"],
] as const;

function blankType(): PlanType {
  return {
    id: "",
    name: "",
    description: null,
    starts_at: null,
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

  async function load(preferredId?: string) {
    const next = await getPlanTypes();
    setTypes(next);
    const selected = next.find((type) => type.id === (preferredId ?? selectedId)) ?? next[0];
    if (selected) {
      setSelectedId(selected.id);
      setDraft(structuredClone(selected));
    }
  }

  useEffect(() => { void load().catch((error) => onMessage(error instanceof Error ? error.message : "Could not load service types.")); }, []);

  function selectType(id: string) {
    setSelectedId(id);
    const selected = types.find((type) => type.id === id);
    setDraft(selected ? structuredClone(selected) : blankType());
  }

  async function save() {
    if (!draft.name.trim()) {
      onMessage("Give the service type a name.");
      return;
    }
    setSaving(true);
    try {
      const { id: _id, ...payload } = { ...draft, name: draft.name.trim() };
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

  function moveOutline(index: number, delta: -1 | 1) {
    setDraft((current) => {
      const next = [...current.default_outline];
      const target = index + delta;
      if (!next[index] || !next[target]) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, default_outline: next.map((item, itemIndex) => ({ ...item, sequence: String((itemIndex + 1) * 10) })) };
    });
  }

  return (
    <section className="subsection-panel admin-settings-panel plan-type-settings">
      <div className="section-heading">
        <div><p className="eyebrow">Planning templates</p><h3>Service types and outlines</h3></div>
        <div className="action-row">
          <button className="text-button" onClick={() => { setSelectedId(""); setDraft(blankType()); }} type="button"><Plus size={15} /> New type</button>
          <button className="primary-button" disabled={saving} onClick={() => void save()} type="button"><Save size={15} /> {saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
      <p className="muted-copy">Define named service types and the ordered section outline used for new plans and by Add outline.</p>
      <label>Service type<select onChange={(event) => selectType(event.target.value)} value={selectedId}><option value="">New service type</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
      <div className="broadcast-settings-grid">
        <label>Name<input maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} /></label>
        <label>Default start<input onChange={(event) => setDraft({ ...draft, starts_at: event.target.value || null })} type="time" value={draft.starts_at ?? ""} /></label>
        <label>Default duration (minutes)<input min={1} onChange={(event) => setDraft({ ...draft, default_duration_minutes: Number(event.target.value) || null })} type="number" value={draft.default_duration_minutes ?? ""} /></label>
        <label className="toggle-row"><input checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} type="checkbox" /> Available when creating services</label>
      </div>
      <label>Description<textarea maxLength={500} onChange={(event) => setDraft({ ...draft, description: event.target.value || null })} value={draft.description ?? ""} /></label>
      <div className="stack">
        {draft.default_outline.map((item, index) => (
          <div className="plan-type-outline-row" key={`${index}:${item.sequence}`}>
            <input aria-label={`Section ${index + 1} title`} onChange={(event) => updateOutline(index, { title: event.target.value })} placeholder="Section title" value={item.title} />
            <select aria-label={`Section ${index + 1} type`} onChange={(event) => updateOutline(index, { item_type: event.target.value })} value={item.item_type}>{SECTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <button aria-label={`Move ${item.title} up`} className="section-icon-button" disabled={index === 0} onClick={() => moveOutline(index, -1)} type="button"><ChevronUp size={14} /></button>
            <button aria-label={`Move ${item.title} down`} className="section-icon-button" disabled={index === draft.default_outline.length - 1} onClick={() => moveOutline(index, 1)} type="button"><ChevronDown size={14} /></button>
            <button aria-label={`Remove ${item.title}`} className="section-icon-button section-remove-button" onClick={() => setDraft((current) => ({ ...current, default_outline: current.default_outline.filter((_, itemIndex) => itemIndex !== index).map((entry, nextIndex) => ({ ...entry, sequence: String((nextIndex + 1) * 10) })) }))} type="button"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <button className="text-button" onClick={() => setDraft((current) => ({ ...current, default_outline: [...current.default_outline, { item_type: "custom", title: "New section", sequence: String((current.default_outline.length + 1) * 10), comment: null }] }))} type="button"><Plus size={14} /> Add outline section</button>
    </section>
  );
}
