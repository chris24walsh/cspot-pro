import { useEffect, useRef, useState } from "react";

import { inviteVolunteer, removeVolunteerPreference, reviewVolunteerPreference, type ServingArea, type VolunteerAdminRecord, type VolunteerFrequencyPeriod, type VolunteerRotationMode, type VolunteerStatus } from "../api";
import { ServingFrequencyInput } from "./ServingFrequencyInput";
import { useConfirmationDialog } from "./ConfirmationDialog";

interface ReviewDraft { status: VolunteerStatus; frequency_count: number; frequency_period: VolunteerFrequencyPeriod; rotation_mode: VolunteerRotationMode; admin_notes: string; }
const makeDraft = (row: VolunteerAdminRecord): ReviewDraft => ({ status: row.preference.status, frequency_count: row.preference.frequency_count, frequency_period: row.preference.frequency_period, rotation_mode: row.preference.rotation_mode, admin_notes: row.preference.admin_notes ?? "" });
type ConfirmAction = ReturnType<typeof useConfirmationDialog>["confirm"];

function AdminVolunteerRow({ autoFocus = false, confirm, expanded, onChanged, onToggle, row }: { autoFocus?: boolean; confirm: ConfirmAction; expanded: boolean; onChanged: () => Promise<void>; onToggle: () => void; row: VolunteerAdminRecord }) {
  const [draft, setDraft] = useState<ReviewDraft>(() => makeDraft(row));
  const [saving, setSaving] = useState(false);
  const rowRef = useRef<HTMLElement>(null);
  useEffect(() => setDraft(makeDraft(row)), [row.preference.status, row.preference.frequency_count, row.preference.frequency_period, row.preference.rotation_mode, row.preference.admin_notes]);
  useEffect(() => {
    if (!autoFocus) return;
    requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [autoFocus, row.preference.id]);

  async function persist(next: ReviewDraft) {
    setDraft(next);
    setSaving(true);
    try {
      await reviewVolunteerPreference(row.preference.id, { status: next.status, frequency_count: next.frequency_count, frequency_period: next.frequency_period, rotation_mode: next.rotation_mode, admin_notes: next.admin_notes || null });
      await onChanged();
    } finally { setSaving(false); }
  }

  async function removeNow() {
    const label = row.preference.initiated_by === "admin" && draft.status === "pending" ? "Cancel invitation" : "Remove role";
    if (!(await confirm({ title: label, message: `${label} for this user?`, confirmLabel: label, tone: "danger" }))) return;
    setSaving(true);
    try { await removeVolunteerPreference(row.preference.id); await onChanged(); }
    finally { setSaving(false); }
  }

  const invitationPending = row.preference.initiated_by === "admin" && draft.status === "pending";
  const quickLabel = invitationPending ? "Cancel" : draft.status === "approved" ? "Remove" : "Accept";
  return <article className={`compact-serving-role admin-serving-role ${row.preference.admin_attention_pending ? "is-pending" : ""}`} ref={rowRef}>
    <div className="compact-serving-role-head"><button className="compact-serving-role-main" onClick={onToggle} type="button"><span aria-hidden="true">{expanded ? "▾" : "▸"}</span><span><strong>{row.preference.area.name}</strong><small>{draft.status}</small></span></button><button className={invitationPending || draft.status === "approved" ? "danger-button compact-role-action" : "primary-button compact-role-action"} disabled={saving} onClick={() => void (invitationPending || draft.status === "approved" ? removeNow() : persist({ ...draft, status: "approved" }))} type="button">{saving ? "…" : quickLabel}</button></div>
    {expanded ? <div className="serving-role-details"><p className="muted-copy">{row.preference.area.description}</p>
      <ServingFrequencyInput count={draft.frequency_count} label={row.preference.area.name} mode={draft.rotation_mode} onChange={(frequency_count, frequency_period, rotation_mode) => void persist({ ...draft, frequency_count, frequency_period, rotation_mode })} period={draft.frequency_period} /><label>Admin note<textarea value={draft.admin_notes} onBlur={() => void persist(draft)} onChange={(event) => setDraft({ ...draft, admin_notes: event.target.value })} placeholder="Optional note visible to the volunteer" /></label>{row.preference.availability_notes ? <small>Volunteer note: {row.preference.availability_notes}</small> : null}{row.unavailable.length ? <small>Away: {row.unavailable.map((item) => `${item.starts_on}–${item.ends_on}`).join(", ")}</small> : null}
      <div className="action-row lifecycle-actions">{!invitationPending && draft.status !== "approved" ? <button className="primary-button" disabled={saving} onClick={() => void persist({ ...draft, status: "approved" })} type="button">Accept</button> : null}{!invitationPending && draft.status !== "declined" ? <button className="text-button" disabled={saving} onClick={async () => { if (await confirm({ title: "Reject request", message: "Reject this serving request?", confirmLabel: "Reject", tone: "danger" })) void persist({ ...draft, status: "declined" }); }} type="button">Reject</button> : null}<button className="danger-button" disabled={saving} onClick={() => void removeNow()} type="button">{invitationPending ? "Cancel invitation" : "Remove"}</button></div>
    </div> : null}
  </article>;
}

function AdminInviteRow({ area, expanded, onChanged, onToggle, userId }: { area: ServingArea; expanded: boolean; onChanged: () => Promise<void>; onToggle: () => void; userId: string }) {
  const [draft, setDraft] = useState<{ count: number; period: VolunteerFrequencyPeriod; rotation_mode: VolunteerRotationMode }>({ count: 1, period: "month", rotation_mode: "auto" });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { await inviteVolunteer(userId, area.key, { preferred_frequency: draft.period === "week" ? "weekly" : draft.period === "month" ? "monthly" : "quarterly", frequency_count: draft.count, frequency_period: draft.period, rotation_mode: draft.rotation_mode, availability_notes: null }); await onChanged(); }
    finally { setSaving(false); }
  }
  return <article className="compact-serving-role"><div className="compact-serving-role-head"><button className="compact-serving-role-main" onClick={onToggle} type="button"><span aria-hidden="true">{expanded ? "▾" : "▸"}</span><span><strong>{area.name}</strong></span></button><button className="text-button compact-role-action" disabled={saving} onClick={() => void save()} type="button">{saving ? "Sending…" : "Invite"}</button></div>{expanded ? <div className="serving-role-details"><p className="muted-copy">{area.description}</p><ServingFrequencyInput count={draft.count} label={area.name} mode={draft.rotation_mode} onChange={(count, period, rotation_mode) => setDraft({ count, period, rotation_mode })} period={draft.period} /></div> : null}</article>;
}

export function VolunteerReview({ areas = [], compact = false, directRoleNames = [], onChanged, rows, userId }: { areas?: ServingArea[]; compact?: boolean; directRoleNames?: string[]; onChanged: () => Promise<void>; rows: VolunteerAdminRecord[]; userId?: string }) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const pending = rows.filter((row) => row.preference.admin_attention_pending);
  const reviewed = rows.filter((row) => !row.preference.admin_attention_pending);
  const [openRoleId, setOpenRoleId] = useState<string | null>(() => pending[0]?.preference.id ?? null);
  useEffect(() => { if (pending[0]) setOpenRoleId(pending[0].preference.id); }, [pending[0]?.preference.id]);
  const renderRow = (row: VolunteerAdminRecord, autoFocus = false) => <AdminVolunteerRow autoFocus={autoFocus} confirm={confirm} expanded={openRoleId === row.preference.id} key={row.preference.id} onChanged={onChanged} onToggle={() => setOpenRoleId((current) => current === row.preference.id ? null : row.preference.id)} row={row} />;
  const missingAreas = areas.filter((area) => !rows.some((row) => row.preference.area.key === area.key) && !(area.legacy_role_name && directRoleNames.includes(area.legacy_role_name)));
  return <section className={`${compact ? "volunteer-review-compact" : "subsection-panel"} volunteer-review`}>{confirmationDialog}{compact ? pending.length ? <div className="compact-pending-label"><span className="status-pill attention">{pending.length} pending</span></div> : null : <div className="section-heading"><div><p className="eyebrow">Serving</p><h3>Roles and tasks</h3></div>{pending.length ? <span className="status-pill attention">{pending.length} pending</span> : null}</div>}<div className="volunteer-review-list">{pending.map((row, index) => renderRow(row, index === 0))}{reviewed.map((row) => renderRow(row))}{userId ? missingAreas.map((area) => <AdminInviteRow area={area} expanded={openRoleId === `invite-${area.id}`} key={area.id} onChanged={onChanged} onToggle={() => setOpenRoleId((current) => current === `invite-${area.id}` ? null : `invite-${area.id}`)} userId={userId} />) : null}{!rows.length && !missingAreas.length ? <p className="muted-copy">No serving roles or requests for this user.</p> : null}</div></section>;
}
