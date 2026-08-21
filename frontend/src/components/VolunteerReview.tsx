import { useEffect, useRef, useState } from "react";

import { inviteVolunteer, removeVolunteerPreference, reviewVolunteerPreference, type ServingArea, type VolunteerAdminRecord, type VolunteerFrequencyPeriod, type VolunteerStatus } from "../api";

interface ReviewDraft { status: VolunteerStatus; frequency_count: number; frequency_period: VolunteerFrequencyPeriod; admin_notes: string; remove: boolean; }
const makeDraft = (row: VolunteerAdminRecord): ReviewDraft => ({ status: row.preference.status, frequency_count: row.preference.frequency_count, frequency_period: row.preference.frequency_period, admin_notes: row.preference.admin_notes ?? "", remove: false });

function AdminVolunteerRow({ autoFocus = false, expanded, onChanged, onExpand, onToggle, row }: { autoFocus?: boolean; expanded: boolean; onChanged: () => Promise<void>; onExpand: () => void; onToggle: () => void; row: VolunteerAdminRecord }) {
  const [draft, setDraft] = useState<ReviewDraft>(() => makeDraft(row));
  const [saving, setSaving] = useState(false);
  const rowRef = useRef<HTMLElement>(null);
  const baseline = makeDraft(row);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => setDraft(makeDraft(row)), [row.preference.status, row.preference.frequency_count, row.preference.frequency_period, row.preference.admin_notes]);
  useEffect(() => {
    if (!autoFocus) return;
    requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [autoFocus, row.preference.id]);

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      if (draft.remove) await removeVolunteerPreference(row.preference.id);
      else await reviewVolunteerPreference(row.preference.id, { status: draft.status, frequency_count: draft.frequency_count, frequency_period: draft.frequency_period, admin_notes: draft.admin_notes || null });
      await onChanged();
    } finally { setSaving(false); }
  }

  const invitationPending = row.preference.initiated_by === "admin" && draft.status === "pending";
  const quickLabel = invitationPending ? "Cancel" : draft.status === "approved" ? "Remove" : "Accept";
  return <article className={`compact-serving-role admin-serving-role ${row.preference.admin_attention_pending ? "is-pending" : ""} ${dirty ? "is-dirty" : ""}`} ref={rowRef}>
    <div className="compact-serving-role-head"><button className="compact-serving-role-main" onClick={onToggle} type="button"><span aria-hidden="true">{expanded ? "▾" : "▸"}</span><span><strong>{row.preference.area.name}</strong><small>{draft.remove ? "Will be removed" : draft.status}</small></span></button><button className={invitationPending || draft.status === "approved" ? "danger-button compact-role-action" : "primary-button compact-role-action"} onClick={() => { setDraft(invitationPending || draft.status === "approved" ? { ...draft, remove: true } : { ...draft, status: "approved" }); onExpand(); }} type="button">{quickLabel}</button></div>
    {expanded ? <div className="serving-role-details"><p className="muted-copy">{row.preference.area.description}</p>
      {!draft.remove ? <><div className="frequency-input"><span>Up to</span><input min="0" max="52" type="number" value={draft.frequency_count} onChange={(event) => setDraft({ ...draft, frequency_count: Number(event.target.value) })} /><span>per</span><select value={draft.frequency_period} onChange={(event) => setDraft({ ...draft, frequency_period: event.target.value as VolunteerFrequencyPeriod })}><option value="week">week</option><option value="month">month</option><option value="quarter">quarter</option><option value="year">year</option></select></div><label>Admin note<textarea value={draft.admin_notes} onChange={(event) => setDraft({ ...draft, admin_notes: event.target.value })} placeholder="Optional note visible to the volunteer" /></label>{row.preference.availability_notes ? <small>Volunteer note: {row.preference.availability_notes}</small> : null}{row.unavailable.length ? <small>Away: {row.unavailable.map((item) => `${item.starts_on}–${item.ends_on}`).join(", ")}</small> : null}</> : <p className="inline-warning">This request or acceptance will be removed when you save.</p>}
      <div className="action-row lifecycle-actions">{draft.remove ? <button className="text-button" onClick={() => setDraft({ ...baseline })} type="button">Keep</button> : <>{!(row.preference.initiated_by === "admin" && draft.status === "pending") && draft.status !== "approved" ? <button className="primary-button" onClick={() => setDraft({ ...draft, status: "approved" })} type="button">Accept</button> : null}{!(row.preference.initiated_by === "admin" && draft.status === "pending") && draft.status !== "declined" ? <button className="text-button" onClick={() => setDraft({ ...draft, status: "declined" })} type="button">Reject</button> : null}<button className="danger-button" onClick={() => setDraft({ ...draft, remove: true })} type="button">{row.preference.initiated_by === "admin" && draft.status === "pending" ? "Cancel invitation" : "Remove"}</button></>}{dirty ? <><button className="text-button" onClick={() => setDraft(baseline)} type="button">Discard</button><button className="primary-button" disabled={saving} onClick={() => void save()} type="button">{saving ? "Saving…" : "Save changes"}</button></> : null}</div>
    </div> : null}
  </article>;
}

function AdminInviteRow({ area, expanded, onChanged, onExpand, onToggle, userId }: { area: ServingArea; expanded: boolean; onChanged: () => Promise<void>; onExpand: () => void; onToggle: () => void; userId: string }) {
  const [draft, setDraft] = useState<{ invite: boolean; count: number; period: VolunteerFrequencyPeriod }>({ invite: false, count: 1, period: "month" });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { await inviteVolunteer(userId, area.key, { preferred_frequency: draft.period === "week" ? "weekly" : draft.period === "month" ? "monthly" : "quarterly", frequency_count: draft.count, frequency_period: draft.period, availability_notes: null }); await onChanged(); }
    finally { setSaving(false); }
  }
  return <article className={`compact-serving-role ${draft.invite ? "is-dirty" : ""}`}><div className="compact-serving-role-head"><button className="compact-serving-role-main" onClick={onToggle} type="button"><span aria-hidden="true">{expanded ? "▾" : "▸"}</span><span><strong>{area.name}</strong></span></button><button className="text-button compact-role-action" onClick={() => { setDraft({ ...draft, invite: true }); onExpand(); }} type="button">Invite</button></div>{expanded ? <div className="serving-role-details"><p className="muted-copy">{area.description}</p>{draft.invite ? <><div className="frequency-input"><span>Up to</span><input min="0" max="52" type="number" value={draft.count} onChange={(event) => setDraft({ ...draft, count: Number(event.target.value) })} /><span>per</span><select value={draft.period} onChange={(event) => setDraft({ ...draft, period: event.target.value as VolunteerFrequencyPeriod })}><option value="week">week</option><option value="month">month</option><option value="quarter">quarter</option><option value="year">year</option></select></div><div className="action-row"><button className="text-button" onClick={() => setDraft({ invite: false, count: 1, period: "month" })} type="button">Discard</button><button className="primary-button" disabled={saving} onClick={() => void save()} type="button">{saving ? "Sending…" : "Save invitation"}</button></div></> : null}</div> : null}</article>;
}

export function VolunteerReview({ areas = [], compact = false, directRoleNames = [], onChanged, rows, userId }: { areas?: ServingArea[]; compact?: boolean; directRoleNames?: string[]; onChanged: () => Promise<void>; rows: VolunteerAdminRecord[]; userId?: string }) {
  const pending = rows.filter((row) => row.preference.admin_attention_pending);
  const reviewed = rows.filter((row) => !row.preference.admin_attention_pending);
  const [openRoleId, setOpenRoleId] = useState<string | null>(() => pending[0]?.preference.id ?? null);
  useEffect(() => { if (pending[0]) setOpenRoleId(pending[0].preference.id); }, [pending[0]?.preference.id]);
  const renderRow = (row: VolunteerAdminRecord, autoFocus = false) => <AdminVolunteerRow autoFocus={autoFocus} expanded={openRoleId === row.preference.id} key={row.preference.id} onChanged={onChanged} onExpand={() => setOpenRoleId(row.preference.id)} onToggle={() => setOpenRoleId((current) => current === row.preference.id ? null : row.preference.id)} row={row} />;
  const missingAreas = areas.filter((area) => !rows.some((row) => row.preference.area.key === area.key) && !(area.legacy_role_name && directRoleNames.includes(area.legacy_role_name)));
  return <section className={`${compact ? "volunteer-review-compact" : "subsection-panel"} volunteer-review`}>{compact ? pending.length ? <div className="compact-pending-label"><span className="status-pill attention">{pending.length} pending</span></div> : null : <div className="section-heading"><div><p className="eyebrow">Serving</p><h3>Roles and tasks</h3></div>{pending.length ? <span className="status-pill attention">{pending.length} pending</span> : null}</div>}<div className="volunteer-review-list">{pending.map((row, index) => renderRow(row, index === 0))}{reviewed.map((row) => renderRow(row))}{userId ? missingAreas.map((area) => <AdminInviteRow area={area} expanded={openRoleId === `invite-${area.id}`} key={area.id} onChanged={onChanged} onExpand={() => setOpenRoleId(`invite-${area.id}`)} onToggle={() => setOpenRoleId((current) => current === `invite-${area.id}` ? null : `invite-${area.id}`)} userId={userId} />) : null}{!rows.length && !missingAreas.length ? <p className="muted-copy">No serving roles or requests for this user.</p> : null}</div></section>;
}
