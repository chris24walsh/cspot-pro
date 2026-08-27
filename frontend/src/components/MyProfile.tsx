import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  addVolunteerUnavailability, decideServingInvitation, getServingProfile, removeVolunteerUnavailability,
  saveVolunteerPreference, updateMyProfile, withdrawVolunteerPreference,
  type ServingProfile, type VolunteerFrequencyPeriod, type VolunteerPreference, type VolunteerRotationMode,
} from "../api";
import { useConfirmationDialog } from "./ConfirmationDialog";
import { ServingFrequencyInput } from "./ServingFrequencyInput";

interface ServingDraft { selected: boolean; frequency_count: number; frequency_period: VolunteerFrequencyPeriod; rotation_mode: VolunteerRotationMode; availability_notes: string; }

function preferencePayload(draft: ServingDraft) {
  return {
    preferred_frequency: draft.frequency_period === "week" ? "weekly" as const : draft.frequency_period === "month" ? "monthly" as const : "quarterly" as const,
    frequency_count: draft.frequency_count,
    frequency_period: draft.frequency_period,
    rotation_mode: draft.rotation_mode,
    availability_notes: draft.availability_notes || null,
  };
}

function makeDrafts(data: ServingProfile): Record<string, ServingDraft> {
  return Object.fromEntries(data.areas.map((area) => {
    const preference = data.preferences.find((item) => item.area.key === area.key);
    const directlyAssigned = Boolean(area.legacy_role_name && data.user.roles.includes(area.legacy_role_name));
    return [area.key, { selected: Boolean(preference) || directlyAssigned, frequency_count: preference?.frequency_count ?? 1, frequency_period: preference?.frequency_period ?? "month", rotation_mode: preference?.rotation_mode ?? "auto", availability_notes: preference?.availability_notes ?? "" }];
  }));
}

export function MyProfile({ onProfileChanged, onServingChanged }: { onProfileChanged: () => void; onServingChanged: () => void }) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [data, setData] = useState<ServingProfile | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ServingDraft>>({});
  const [form, setForm] = useState({ name: "", email: "", username: "" });
  const [away, setAway] = useState({ starts_on: "", ends_on: "", note: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [immediateAction, setImmediateAction] = useState<string | null>(null);
  const [profileSection, setProfileSection] = useState<"account" | "serving">(() => sessionStorage.getItem("cspot-profile-section") === "serving" ? "serving" : "account");
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [openArea, setOpenArea] = useState<string | null>(null);
  const initialSectionChosen = useRef(false);
  const initialInvitationFocused = useRef(false);

  async function load() {
    const next = await getServingProfile();
    setData(next); setDrafts(makeDrafts(next));
    setForm({ name: next.user.name, email: next.user.email, username: next.user.username });
    if (!initialSectionChosen.current) {
      initialSectionChosen.current = true;
      const invitation = next.preferences.find((preference) => preference.initiated_by === "admin" && preference.status === "pending");
      if (invitation) {
        setProfileSection("serving");
        sessionStorage.setItem("cspot-profile-section", "serving");
        setOpenCategory(invitation.area.category);
        setOpenArea(invitation.area.key);
      }
    }
  }
  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load profile.")); }, []);
  useEffect(() => {
    if (!data || profileSection !== "serving" || initialInvitationFocused.current) return;
    const invitation = data.preferences.find((preference) => preference.initiated_by === "admin" && preference.status === "pending");
    if (!invitation) return;
    initialInvitationFocused.current = true;
    requestAnimationFrame(() => {
      const element = document.getElementById(`profile-invitation-${invitation.area.key}`) as HTMLDetailsElement | null;
      if (element) element.open = true;
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [data, profileSection]);

  function changeSection(section: "account" | "serving") {
    setProfileSection(section);
    sessionStorage.setItem("cspot-profile-section", section);
  }

  function applyPreference(preference: VolunteerPreference) {
    setData((current) => current ? { ...current, preferences: [...current.preferences.filter((item) => item.area.key !== preference.area.key), preference] } : current);
    setDrafts((current) => ({ ...current, [preference.area.key]: { selected: true, frequency_count: preference.frequency_count, frequency_period: preference.frequency_period, rotation_mode: preference.rotation_mode, availability_notes: preference.availability_notes ?? "" } }));
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    try { await updateMyProfile(form); await load(); onProfileChanged(); setMessage("Profile saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save profile."); }
  }

  async function volunteerNow(areaKey: string, draft: ServingDraft) {
    setImmediateAction(areaKey);
    try {
      const preference = await saveVolunteerPreference(areaKey, preferencePayload(draft));
      applyPreference(preference);
      onServingChanged();
      setMessage("Volunteer request sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send volunteer request.");
    } finally {
      setImmediateAction(null);
    }
  }

  async function acceptInvitationNow(areaKey: string, draft: ServingDraft) {
    setImmediateAction(areaKey);
    try {
      await saveVolunteerPreference(areaKey, preferencePayload(draft));
      const preference = await decideServingInvitation(areaKey, "approved");
      applyPreference(preference);
      onServingChanged();
      setMessage("Invitation accepted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not accept invitation.");
    } finally {
      setImmediateAction(null);
    }
  }

  async function updatePreferenceNow(areaKey: string, draft: ServingDraft) {
    setImmediateAction(areaKey);
    try {
      const preference = await saveVolunteerPreference(areaKey, preferencePayload(draft));
      applyPreference(preference);
      setMessage("Serving preference updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update serving preference.");
    } finally {
      setImmediateAction(null);
    }
  }

  async function destructiveRoleAction(areaKey: string, action: "reject" | "remove", label: string) {
    const confirmed = await confirm({ title: label, message: `Are you sure you want to ${label.toLowerCase()}?`, confirmLabel: label, tone: "danger" });
    if (!confirmed) return;
    setImmediateAction(areaKey);
    try {
      if (action === "reject") await decideServingInvitation(areaKey, "declined");
      else await withdrawVolunteerPreference(areaKey);
      if (action === "reject") {
        const next = await getServingProfile();
        setData(next); setDrafts(makeDrafts(next));
      } else {
        setData((current) => current ? { ...current, preferences: current.preferences.filter((item) => item.area.key !== areaKey) } : current);
        setDrafts((current) => ({ ...current, [areaKey]: { selected: false, frequency_count: 1, frequency_period: "month", rotation_mode: "auto", availability_notes: "" } }));
      }
      onServingChanged();
      setMessage(`${label} completed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not ${label.toLowerCase()}.`);
    } finally {
      setImmediateAction(null);
    }
  }

  async function removeAvailability(unavailabilityId: string) {
    const confirmed = await confirm({ title: "Remove unavailable dates", message: "Remove this unavailable date range?", confirmLabel: "Remove dates", tone: "danger" });
    if (!confirmed) return;
    try {
      await removeVolunteerUnavailability(unavailabilityId);
      await load();
      setMessage("Unavailable dates removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove unavailable dates.");
    }
  }

  if (!data) return <section className="profile-workspace"><p>{message || "Loading your profile…"}</p></section>;
  const invitationCount = data.preferences.filter((preference) => preference.initiated_by === "admin" && preference.status === "pending").length;
  return <section className="profile-workspace" aria-label="My profile">
    {confirmationDialog}
    <div className="tab-row flat-admin-tabs profile-section-tabs" role="tablist" aria-label="Profile sections"><button className={profileSection === "account" ? "active" : ""} onClick={() => changeSection("account")} type="button">Account</button><button className={profileSection === "serving" ? "active" : ""} onClick={() => changeSection("serving")} type="button">Serving{invitationCount ? <span className="tab-attention-count">{invitationCount}</span> : null}</button></div>
    {profileSection === "account" ? <form className="profile-card" onSubmit={(event) => void saveProfile(event)}>
      <div className="section-heading"><div><p className="eyebrow">Account</p><h2>My details</h2></div><button className="primary-button" type="submit">Save profile</button></div>
      {message ? <p className="form-message">{message}</p> : null}
      <div className="form-grid"><label>Full name<input autoComplete="name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Username<input required pattern="[a-z0-9][a-z0-9._-]{1,79}" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })} /></label></div>
    </form> : null}
    {profileSection === "serving" ? <section className="profile-card serving-list-panel">
      <div className="section-heading"><div><p className="eyebrow">Serving</p><h2>How I can help</h2></div><div className="action-row">{invitationCount ? <span className="status-pill attention">{invitationCount} invitation{invitationCount === 1 ? "" : "s"} to answer</span> : null}</div></div>
      {message ? <p className="form-message">{message}</p> : null}
      <p className="muted-copy">Changes apply immediately. Active and requested roles are listed first; destructive actions ask for confirmation.</p>
      <div className="serving-role-groups">{Array.from(new Set(data.areas.map((area) => area.category))).map((category) => {
        const categoryAreas = data.areas.filter((area) => area.category === category);
        const activeCount = categoryAreas.filter((area) => drafts[area.key]?.selected).length;
        const categoryOpen = openCategory === category;
        return <section className={`serving-role-group role-category ${categoryOpen ? "is-open" : ""}`} key={category}><button className="role-category-heading" onClick={() => { setOpenCategory(categoryOpen ? null : category); setOpenArea(null); }} type="button"><span>{category}</span><small>{activeCount} active</small><span aria-hidden="true">{categoryOpen ? "−" : "+"}</span></button>{categoryOpen ? <div className="role-category-items">{categoryAreas.map((area) => {
        const preference = data.preferences.find((item) => item.area.key === area.key);
        const directlyAssigned = Boolean(area.legacy_role_name && data.user.roles.includes(area.legacy_role_name));
        const draft = drafts[area.key];
        const invitationPending = preference?.initiated_by === "admin" && preference.status === "pending";
        const stateLabel = directlyAssigned ? "Assigned" : invitationPending ? "Invitation" : preference?.status === "approved" ? "Active" : preference?.status === "pending" ? "Requested" : preference?.status === "declined" ? "Declined" : null;
        const destructiveLabel = preference?.status === "pending" ? "Cancel request" : preference?.status === "approved" ? "Leave role" : "Remove request";
        const areaOpen = openArea === area.key;
        return <article className={`compact-serving-role ${draft.selected ? "selected" : ""} ${invitationPending ? "is-pending" : ""}`} id={invitationPending ? `profile-invitation-${area.key}` : undefined} key={area.key}>
          <div className="compact-serving-role-head"><button className="compact-serving-role-main" onClick={() => setOpenArea(areaOpen ? null : area.key)} type="button"><span aria-hidden="true">{areaOpen ? "▾" : "▸"}</span><span><strong>{area.name}</strong>{stateLabel ? <small>{stateLabel}</small> : null}</span></button>{directlyAssigned ? <span className="role-state-flag inline">Assigned</span> : invitationPending ? <button className="primary-button compact-role-action" disabled={immediateAction === area.key} onClick={() => void acceptInvitationNow(area.key, draft)} type="button">Accept</button> : draft.selected ? <button className="danger-button compact-role-action" disabled={immediateAction === area.key} onClick={() => void destructiveRoleAction(area.key, "remove", destructiveLabel)} type="button">{preference?.status === "approved" ? "Leave" : "Cancel"}</button> : <button className="text-button compact-role-action" disabled={immediateAction === area.key} onClick={() => void volunteerNow(area.key, draft)} type="button">Join</button>}</div>
          {areaOpen ? <div className="serving-role-details"><p className="muted-copy">{area.description}</p>{directlyAssigned ? <p className="muted-copy">This role is active through your assigned access role. An administrator can change it.</p> : draft.selected ? <><ServingFrequencyInput count={draft.frequency_count} label={area.name} mode={draft.rotation_mode} onChange={(frequency_count, frequency_period, rotation_mode) => { const next = { ...draft, frequency_count, frequency_period, rotation_mode }; setDrafts({ ...drafts, [area.key]: next }); void updatePreferenceNow(area.key, next); }} period={draft.frequency_period} /><label>Availability and notes<textarea value={draft.availability_notes} onBlur={() => void updatePreferenceNow(area.key, drafts[area.key])} onChange={(event) => setDrafts({ ...drafts, [area.key]: { ...draft, availability_notes: event.target.value } })} placeholder="Times that suit, experience, or anything coordinators should know" /></label>{preference?.admin_notes ? <p className="field-help">Admin note: {preference.admin_notes}</p> : null}{invitationPending ? <button className="danger-button role-lifecycle-button" disabled={immediateAction === area.key} onClick={() => void destructiveRoleAction(area.key, "reject", "Reject invitation")} type="button">Reject invitation</button> : null}</> : null}</div> : null}
        </article>;
      })}</div> : null}</section>;
      })}</div>
      <section className="serving-availability"><div className="section-heading"><div><p className="eyebrow">Availability</p><h2>Dates I cannot serve</h2></div></div><form className="availability-entry" onSubmit={async (event) => { event.preventDefault(); await addVolunteerUnavailability({ ...away, note: away.note || null }); setAway({ starts_on: "", ends_on: "", note: "" }); await load(); setMessage("Unavailable dates added."); }}><label>From<input required type="date" value={away.starts_on} onChange={(event) => setAway({ ...away, starts_on: event.target.value })} /></label><label>To<input required type="date" min={away.starts_on} value={away.ends_on} onChange={(event) => setAway({ ...away, ends_on: event.target.value })} /></label><label>Note<input value={away.note} onChange={(event) => setAway({ ...away, note: event.target.value })} /></label><button className="text-button" type="submit">Add dates</button></form><div className="availability-list">{data.unavailable.map((item) => <div key={item.id}><span><strong>{item.starts_on}</strong> to <strong>{item.ends_on}</strong>{item.note ? ` · ${item.note}` : ""}</span><button className="danger-button" type="button" onClick={() => void removeAvailability(item.id)}>Remove</button></div>)}</div></section>
    </section> : null}
  </section>;
}
