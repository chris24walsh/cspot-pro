import { useEffect, useState } from "react";

import {
  addUserUnavailability, getUserUnavailability, removeUserUnavailability,
  updateUserUnavailability, type VolunteerUnavailability,
} from "../api";

const emptyDraft = { starts_on: "", ends_on: "", note: "" };

export function AdminAvailabilityPanel({ onMessage, userId }: { onMessage: (message: string) => void; userId: string }) {
  const [items, setItems] = useState<VolunteerUnavailability[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { setItems(await getUserUnavailability(userId)); }
    catch (error) { onMessage(error instanceof Error ? error.message : "Could not load availability."); }
    finally { setLoading(false); }
  }

  useEffect(() => { setDraft(emptyDraft); setEditingId(null); void load(); }, [userId]);

  async function save() {
    try {
      const payload = { ...draft, note: draft.note || null };
      if (editingId) await updateUserUnavailability(userId, editingId, payload);
      else await addUserUnavailability(userId, payload);
      setDraft(emptyDraft); setEditingId(null); await load();
      onMessage(editingId ? "Unavailable dates updated." : "Unavailable dates added.");
    } catch (error) { onMessage(error instanceof Error ? error.message : "Could not save availability."); }
  }

  async function remove(id: string) {
    try { await removeUserUnavailability(userId, id); await load(); onMessage("Unavailable dates removed."); }
    catch (error) { onMessage(error instanceof Error ? error.message : "Could not remove availability."); }
  }

  return <section className="serving-availability admin-serving-availability">
    <div className="section-heading"><div><p className="eyebrow">Availability</p><h3>Dates this user cannot serve</h3></div></div>
    <div className="availability-entry"><label>From<input type="date" value={draft.starts_on} onChange={(event) => setDraft({ ...draft, starts_on: event.target.value })} /></label><label>To<input type="date" min={draft.starts_on} value={draft.ends_on} onChange={(event) => setDraft({ ...draft, ends_on: event.target.value })} /></label><label>Note<input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label><div className="action-row"><button className="text-button" disabled={!draft.starts_on || !draft.ends_on} onClick={() => void save()} type="button">{editingId ? "Save dates" : "Add dates"}</button>{editingId ? <button className="text-button" onClick={() => { setEditingId(null); setDraft(emptyDraft); }} type="button">Cancel</button> : null}</div></div>
    <div className="availability-list">{loading ? <p className="muted-copy">Loading availability…</p> : items.length ? items.map((item) => <div key={item.id}><span><strong>{item.starts_on}</strong> to <strong>{item.ends_on}</strong>{item.note ? ` · ${item.note}` : ""}</span><div className="action-row"><button className="text-button" onClick={() => { setEditingId(item.id); setDraft({ starts_on: item.starts_on, ends_on: item.ends_on, note: item.note ?? "" }); }} type="button">Edit</button><button className="danger-button" onClick={() => void remove(item.id)} type="button">Remove</button></div></div>) : <p className="muted-copy">No unavailable dates recorded.</p>}</div>
  </section>;
}
