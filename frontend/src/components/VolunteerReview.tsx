import { useEffect, useState } from "react";

import { inviteVolunteer, removeVolunteerPreference, reviewVolunteerPreference, type ServingArea, type VolunteerAdminRecord, type VolunteerFrequencyPeriod, type VolunteerStatus } from "../api";

interface ReviewDraft { status: VolunteerStatus; frequency_count: number; frequency_period: VolunteerFrequencyPeriod; admin_notes: string; remove: boolean; }
const makeDraft = (row: VolunteerAdminRecord): ReviewDraft => ({ status: row.preference.status, frequency_count: row.preference.frequency_count, frequency_period: row.preference.frequency_period, admin_notes: row.preference.admin_notes ?? "", remove: false });

function AdminVolunteerRow({ onChanged, row }: { onChanged: () => Promise<void>; row: VolunteerAdminRecord }) {
  const [draft, setDraft] = useState<ReviewDraft>(() => makeDraft(row));
  const [saving, setSaving] = useState(false);
  const baseline = makeDraft(row);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => setDraft(makeDraft(row)), [row.preference.status, row.preference.frequency_count, row.preference.frequency_period, row.preference.admin_notes]);

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      if (draft.remove) await removeVolunteerPreference(row.preference.id);
      else await reviewVolunteerPreference(row.preference.id, { status: draft.status, frequency_count: draft.frequency_count, frequency_period: draft.frequency_period, admin_notes: draft.admin_notes || null });
      await onChanged();
    } finally { setSaving(false); }
  }

  return <details className={`serving-role-row admin-serving-role ${row.preference.status === "pending" ? "is-pending" : ""} ${dirty ? "is-dirty" : ""}`} open={row.preference.status === "pending"}>
    <summary><span><strong>{row.preference.area.name}</strong><small>{dirty ? "Unsaved · " : ""}{draft.remove ? "Will be removed" : `${row.preference.initiated_by === "admin" && draft.status === "pending" ? "invitation pending" : draft.status} · ${draft.frequency_count} per ${draft.frequency_period}`}</small></span></summary>
    <div className="serving-role-details">
      {!draft.remove ? <><div className="frequency-input"><span>Up to</span><input min="0" max="52" type="number" value={draft.frequency_count} onChange={(event) => setDraft({ ...draft, frequency_count: Number(event.target.value) })} /><span>per</span><select value={draft.frequency_period} onChange={(event) => setDraft({ ...draft, frequency_period: event.target.value as VolunteerFrequencyPeriod })}><option value="week">week</option><option value="month">month</option><option value="quarter">quarter</option><option value="year">year</option></select></div><label>Admin note<textarea value={draft.admin_notes} onChange={(event) => setDraft({ ...draft, admin_notes: event.target.value })} placeholder="Optional note visible to the volunteer" /></label>{row.preference.availability_notes ? <small>Volunteer note: {row.preference.availability_notes}</small> : null}{row.unavailable.length ? <small>Away: {row.unavailable.map((item) => `${item.starts_on}–${item.ends_on}`).join(", ")}</small> : null}</> : <p className="inline-warning">This request or acceptance will be removed when you save.</p>}
      <div className="action-row lifecycle-actions">{draft.remove ? <button className="text-button" onClick={() => setDraft({ ...baseline })} type="button">Keep</button> : <>{!(row.preference.initiated_by === "admin" && draft.status === "pending") && draft.status !== "approved" ? <button className="primary-button" onClick={() => setDraft({ ...draft, status: "approved" })} type="button">Accept</button> : null}{!(row.preference.initiated_by === "admin" && draft.status === "pending") && draft.status !== "declined" ? <button className="text-button" onClick={() => setDraft({ ...draft, status: "declined" })} type="button">Reject</button> : null}<button className="danger-button" onClick={() => setDraft({ ...draft, remove: true })} type="button">{row.preference.initiated_by === "admin" && draft.status === "pending" ? "Cancel invitation" : "Remove"}</button></>}{dirty ? <><button className="text-button" onClick={() => setDraft(baseline)} type="button">Discard</button><button className="primary-button" disabled={saving} onClick={() => void save()} type="button">{saving ? "Saving…" : "Save changes"}</button></> : null}</div>
    </div>
  </details>;
}

function AdminInviteRow({ area, onChanged, userId }: { area: ServingArea; onChanged: () => Promise<void>; userId: string }) {
  const [draft, setDraft] = useState<{ invite: boolean; count: number; period: VolunteerFrequencyPeriod }>({ invite: false, count: 1, period: "month" });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { await inviteVolunteer(userId, area.key, { preferred_frequency: draft.period === "week" ? "weekly" : draft.period === "month" ? "monthly" : "quarterly", frequency_count: draft.count, frequency_period: draft.period, availability_notes: null }); await onChanged(); }
    finally { setSaving(false); }
  }
  return <details className={`serving-role-row ${draft.invite ? "is-dirty" : ""}`}><summary><span><strong>{area.name}</strong><small>{draft.invite ? `Unsaved invitation · ${draft.count} per ${draft.period}` : area.description}</small></span></summary><div className="serving-role-details">{draft.invite ? <><div className="frequency-input"><span>Up to</span><input min="0" max="52" type="number" value={draft.count} onChange={(event) => setDraft({ ...draft, count: Number(event.target.value) })} /><span>per</span><select value={draft.period} onChange={(event) => setDraft({ ...draft, period: event.target.value as VolunteerFrequencyPeriod })}><option value="week">week</option><option value="month">month</option><option value="quarter">quarter</option><option value="year">year</option></select></div><div className="action-row"><button className="text-button" onClick={() => setDraft({ invite: false, count: 1, period: "month" })} type="button">Discard</button><button className="primary-button" disabled={saving} onClick={() => void save()} type="button">{saving ? "Sending…" : "Save invitation"}</button></div></> : <button className="text-button role-lifecycle-button" onClick={() => setDraft({ ...draft, invite: true })} type="button">Invite to this role</button>}</div></details>;
}

export function VolunteerReview({ areas = [], compact = false, onChanged, rows, userId }: { areas?: ServingArea[]; compact?: boolean; onChanged: () => Promise<void>; rows: VolunteerAdminRecord[]; userId?: string }) {
  const pending = rows.filter((row) => row.preference.status === "pending");
  const reviewed = rows.filter((row) => row.preference.status !== "pending");
  const renderRow = (row: VolunteerAdminRecord) => <AdminVolunteerRow key={row.preference.id} onChanged={onChanged} row={row} />;
  const missingAreas = areas.filter((area) => !rows.some((row) => row.preference.area.key === area.key));
  return <section className={`${compact ? "volunteer-review-compact" : "subsection-panel"} volunteer-review`}><div className="section-heading"><div>{compact ? null : <p className="eyebrow">Serving</p>}<h3>{compact ? "Requests and assignments" : "Roles and tasks"}</h3></div>{pending.length ? <span className="status-pill attention">{pending.length} pending</span> : null}</div><div className="volunteer-review-list">{pending.map(renderRow)}{reviewed.length ? <details className="approved-volunteers"><summary>{reviewed.length} reviewed role{reviewed.length === 1 ? "" : "s"}</summary>{reviewed.map(renderRow)}</details> : null}{userId ? missingAreas.map((area) => <AdminInviteRow area={area} key={area.id} onChanged={onChanged} userId={userId} />) : null}{!rows.length && !missingAreas.length ? <p className="muted-copy">No serving roles or requests for this user.</p> : null}</div></section>;
}
