import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  addVolunteerUnavailability, decideServingInvitation, getServingProfile, removeVolunteerUnavailability,
  saveVolunteerPreference, updateMyProfile, withdrawVolunteerPreference,
  type ServingProfile, type VolunteerFrequencyPeriod,
} from "../api";
import { CALENDAR_AVATARS } from "../userCalendarStyle";

interface ServingDraft { selected: boolean; frequency_count: number; frequency_period: VolunteerFrequencyPeriod; availability_notes: string; decision?: "approved" | "declined"; }

function makeDrafts(data: ServingProfile): Record<string, ServingDraft> {
  return Object.fromEntries(data.areas.map((area) => {
    const preference = data.preferences.find((item) => item.area.key === area.key);
    const directlyAssigned = Boolean(area.legacy_role_name && data.user.roles.includes(area.legacy_role_name));
    return [area.key, { selected: Boolean(preference) || directlyAssigned, frequency_count: preference?.frequency_count ?? 1, frequency_period: preference?.frequency_period ?? "month", availability_notes: preference?.availability_notes ?? "" }];
  }));
}

export function MyProfile({ onProfileChanged }: { onProfileChanged: () => void }) {
  const [data, setData] = useState<ServingProfile | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ServingDraft>>({});
  const [form, setForm] = useState({ name: "", email: "", username: "", calendar_avatar: "" });
  const [away, setAway] = useState({ starts_on: "", ends_on: "", note: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [savingServing, setSavingServing] = useState(false);

  async function load() {
    const next = await getServingProfile();
    setData(next); setDrafts(makeDrafts(next));
    setForm({ name: next.user.name, email: next.user.email, username: next.user.username, calendar_avatar: next.user.calendar_avatar || "" });
  }
  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load profile.")); }, []);
  const servingDirty = useMemo(() => data ? JSON.stringify(drafts) !== JSON.stringify(makeDrafts(data)) : false, [data, drafts]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    try { await updateMyProfile({ ...form, calendar_avatar: form.calendar_avatar || null }); await load(); onProfileChanged(); setMessage("Profile saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save profile."); }
  }

  async function saveServing() {
    if (!data || !servingDirty) return;
    setSavingServing(true);
    try {
      for (const area of data.areas) {
        const draft = drafts[area.key];
        const preference = data.preferences.find((item) => item.area.key === area.key);
        if (area.legacy_role_name && data.user.roles.includes(area.legacy_role_name)) continue;
        if (preference?.initiated_by === "admin" && preference.status === "pending" && draft.decision) await decideServingInvitation(area.key, draft.decision);
        if (!draft.selected && preference) await withdrawVolunteerPreference(area.key);
        if (draft.selected && draft.decision !== "declined" && (!preference || draft.frequency_count !== preference.frequency_count || draft.frequency_period !== preference.frequency_period || draft.availability_notes !== (preference.availability_notes ?? ""))) {
          await saveVolunteerPreference(area.key, { preferred_frequency: draft.frequency_period === "week" ? "weekly" : draft.frequency_period === "month" ? "monthly" : "quarterly", frequency_count: draft.frequency_count, frequency_period: draft.frequency_period, availability_notes: draft.availability_notes || null });
        }
      }
      await load(); onProfileChanged(); setMessage("Serving changes saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save serving changes."); }
    finally { setSavingServing(false); }
  }

  if (!data) return <section className="profile-workspace"><p>{message || "Loading your profile…"}</p></section>;
  const baseline = makeDrafts(data);
  const invitationCount = data.preferences.filter((preference) => preference.initiated_by === "admin" && preference.status === "pending").length;
  return <section className="profile-workspace" aria-label="My profile">
    <form className="profile-card" onSubmit={(event) => void saveProfile(event)}>
      <div className="section-heading"><div><p className="eyebrow">Account</p><h2>My details</h2></div><button className="primary-button" type="submit">Save profile</button></div>
      {message ? <p className="form-message">{message}</p> : null}
      <div className="form-grid"><label>Name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Username<input required pattern="[a-z0-9][a-z0-9._-]{1,79}" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })} /></label><fieldset className="role-fieldset"><legend>Avatar</legend><div className="calendar-avatar-options"><label className={!form.calendar_avatar ? "selected" : ""}><input type="radio" checked={!form.calendar_avatar} onChange={() => setForm({ ...form, calendar_avatar: "" })} /><span>Initial</span></label>{CALENDAR_AVATARS.map((avatar) => <label className={form.calendar_avatar === avatar ? "selected" : ""} key={avatar}><input type="radio" checked={form.calendar_avatar === avatar} onChange={() => setForm({ ...form, calendar_avatar: avatar })} /><span>{avatar}</span></label>)}</div></fieldset></div>
    </form>
    <section className={`profile-card serving-list-panel ${servingDirty ? "has-unsaved-changes" : ""}`}>
      <div className="section-heading"><div><p className="eyebrow">Serving</p><h2>How I can help</h2></div><div className="action-row">{invitationCount ? <span className="status-pill attention">{invitationCount} invitation{invitationCount === 1 ? "" : "s"} to answer</span> : null}{servingDirty ? <><span className="status-pill attention">Unsaved changes</span><button className="text-button" onClick={() => setDrafts(makeDrafts(data))} type="button">Discard</button></> : null}<button className="primary-button" disabled={!servingDirty || savingServing} onClick={() => void saveServing()} type="button">{savingServing ? "Saving…" : "Save serving"}</button></div></div>
      <p className="muted-copy">Changes remain drafts until saved. Approved roles stay active while you adjust their workload.</p>
      <div className="serving-role-groups">{Array.from(new Set(data.areas.map((area) => area.category))).map((category) => <section className="serving-role-group" key={category}><h3>{category}</h3>{data.areas.filter((area) => area.category === category).map((area) => {
        const preference = data.preferences.find((item) => item.area.key === area.key);
        const directlyAssigned = Boolean(area.legacy_role_name && data.user.roles.includes(area.legacy_role_name));
        const draft = drafts[area.key]; const changed = JSON.stringify(draft) !== JSON.stringify(baseline[area.key]);
        const invitationPending = preference?.initiated_by === "admin" && preference.status === "pending";
        return <details className={`serving-role-row ${draft.selected ? "selected" : ""} ${changed ? "is-dirty" : ""} ${invitationPending ? "is-pending" : ""}`} key={area.key}>
          <summary><span><strong>{area.name}</strong><small>{directlyAssigned ? "Assigned directly" : changed ? `Unsaved · ${preference ? preference.status : "new request"}` : preference ? `${preference.status} · ${draft.frequency_count} per ${draft.frequency_period}` : draft.selected ? `New request · ${draft.frequency_count} per ${draft.frequency_period}` : area.description}</small></span></summary>
          <div className="serving-role-details">{directlyAssigned ? <p className="muted-copy">This role is already active through your assigned access role. An administrator can change it.</p> : draft.selected ? <><div className="frequency-input"><span>Up to</span><input aria-label={`${area.name} frequency`} min="0" max="52" type="number" value={draft.frequency_count} onChange={(event) => setDrafts({ ...drafts, [area.key]: { ...draft, frequency_count: Number(event.target.value) } })} /><span>per</span><select value={draft.frequency_period} onChange={(event) => setDrafts({ ...drafts, [area.key]: { ...draft, frequency_period: event.target.value as VolunteerFrequencyPeriod } })}><option value="week">week</option><option value="month">month</option><option value="quarter">quarter</option><option value="year">year</option></select></div><label>Notes<textarea value={draft.availability_notes} onChange={(event) => setDrafts({ ...drafts, [area.key]: { ...draft, availability_notes: event.target.value } })} placeholder="Times that suit, experience, or anything coordinators should know" /></label>{preference?.admin_notes ? <p className="field-help">Admin note: {preference.admin_notes}</p> : null}{preference?.initiated_by === "admin" && preference.status === "pending" ? <div className="action-row lifecycle-actions"><button className="text-button" onClick={() => setDrafts({ ...drafts, [area.key]: { ...draft, decision: "declined" } })} type="button">Reject invitation</button><button className="primary-button" onClick={() => setDrafts({ ...drafts, [area.key]: { ...draft, decision: "approved" } })} type="button">Accept invitation</button></div> : <button className="danger-button role-lifecycle-button" onClick={() => setDrafts({ ...drafts, [area.key]: { ...draft, selected: false } })} type="button">{preference?.status === "pending" ? "Cancel request" : preference?.status === "approved" ? "Leave role" : "Remove request"}</button>}</> : <button className="text-button role-lifecycle-button" onClick={() => setDrafts({ ...drafts, [area.key]: { ...draft, selected: true } })} type="button">{preference ? "Keep role" : "Volunteer for this role"}</button>}</div>
        </details>;
      })}</section>)}</div>
    </section>
    <section className="profile-card"><div className="section-heading"><div><p className="eyebrow">Availability</p><h2>Dates I cannot serve</h2></div></div><form className="availability-entry" onSubmit={async (event) => { event.preventDefault(); await addVolunteerUnavailability({ ...away, note: away.note || null }); setAway({ starts_on: "", ends_on: "", note: "" }); await load(); }}><label>From<input required type="date" value={away.starts_on} onChange={(event) => setAway({ ...away, starts_on: event.target.value })} /></label><label>To<input required type="date" min={away.starts_on} value={away.ends_on} onChange={(event) => setAway({ ...away, ends_on: event.target.value })} /></label><label>Note<input value={away.note} onChange={(event) => setAway({ ...away, note: event.target.value })} /></label><button className="text-button" type="submit">Add dates</button></form><div className="availability-list">{data.unavailable.map((item) => <div key={item.id}><span><strong>{item.starts_on}</strong> to <strong>{item.ends_on}</strong>{item.note ? ` · ${item.note}` : ""}</span><button className="text-button" type="button" onClick={async () => { await removeVolunteerUnavailability(item.id); await load(); }}>Remove</button></div>)}</div></section>
  </section>;
}
