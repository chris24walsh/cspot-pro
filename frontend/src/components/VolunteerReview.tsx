import { useState } from "react";

import { removeVolunteerPreference, reviewVolunteerPreference, type VolunteerAdminRecord, type VolunteerFrequencyPeriod, type VolunteerStatus } from "../api";

export function VolunteerReview({ compact = false, onChanged, rows }: { compact?: boolean; onChanged: () => Promise<void>; rows: VolunteerAdminRecord[] }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ row: VolunteerAdminRecord; status: VolunteerStatus } | null>(null);
  async function review(row: VolunteerAdminRecord, status: VolunteerStatus) {
    const previousStatus = row.preference.status;
    await reviewVolunteerPreference(row.preference.id, { status, preferred_frequency: row.preference.preferred_frequency, frequency_count: row.preference.frequency_count, frequency_period: row.preference.frequency_period, admin_notes: row.preference.admin_notes });
    setUndo({ row, status: previousStatus });
    setNotice(`${row.preference.area.name} ${status}.`);
    await onChanged();
  }
  async function remove(row: VolunteerAdminRecord) {
    await removeVolunteerPreference(row.preference.id);
    setUndo(null);
    setNotice(`${row.preference.area.name} removed.`);
    await onChanged();
  }
  async function undoLast() {
    if (!undo) return;
    await reviewVolunteerPreference(undo.row.preference.id, { status: undo.status });
    setUndo(null);
    setNotice("Last review undone.");
    await onChanged();
  }
  const pending = rows.filter((row) => row.preference.status === "pending");
  const reviewed = rows.filter((row) => row.preference.status !== "pending");
  async function updateFrequency(row: VolunteerAdminRecord, count: number, period: VolunteerFrequencyPeriod) { await reviewVolunteerPreference(row.preference.id, { status: row.preference.status, frequency_count: count, frequency_period: period }); await onChanged(); }
  const renderRow = (row: VolunteerAdminRecord) => <details className={`serving-role-row admin-serving-role ${row.preference.status === "pending" ? "is-pending" : ""}`} key={row.preference.id} open={row.preference.status === "pending"}><summary><span><strong>{row.preference.area.name}</strong><small>{row.preference.status} · {row.preference.frequency_count} per {row.preference.frequency_period}</small></span></summary><div className="serving-role-details"><div className="frequency-input"><span>Up to</span><input min="0" max="52" type="number" defaultValue={row.preference.frequency_count} onBlur={(event) => void updateFrequency(row, Number(event.target.value), row.preference.frequency_period)} /><span>per</span><select value={row.preference.frequency_period} onChange={(event) => void updateFrequency(row, row.preference.frequency_count, event.target.value as VolunteerFrequencyPeriod)}><option value="week">week</option><option value="month">month</option><option value="quarter">quarter</option><option value="year">year</option></select></div>{row.preference.availability_notes ? <small>{row.preference.availability_notes}</small> : null}{row.unavailable.length ? <small>Away: {row.unavailable.map((item) => `${item.starts_on}–${item.ends_on}`).join(", ")}</small> : null}<div className="action-row">{row.preference.status === "pending" ? <><button className="text-button" onClick={() => void review(row, "declined")} type="button">Decline</button><button className="primary-button" onClick={() => void review(row, "approved")} type="button">Approve</button></> : <button className="text-button" onClick={() => void review(row, row.preference.status === "approved" ? "pending" : "approved")} type="button">{row.preference.status === "approved" ? "Review again" : "Approve"}</button>}<button className="danger-button" onClick={() => void remove(row)} type="button">Remove</button></div></div></details>;
  return <section className={`${compact ? "volunteer-review-compact" : "subsection-panel"} volunteer-review`}><div className="section-heading"><div>{compact ? null : <p className="eyebrow">Serving</p>}<h3>{compact ? "Requests and assignments" : "Roles and tasks"}</h3></div>{pending.length ? <span className="status-pill attention">{pending.length} pending</span> : null}</div>{notice ? <div className="inline-notice"><span>{notice}</span>{undo ? <button className="text-button" onClick={() => void undoLast()} type="button">Undo</button> : null}</div> : null}<div className="volunteer-review-list">{pending.map(renderRow)}{reviewed.length ? <details className="approved-volunteers"><summary>{reviewed.length} reviewed role{reviewed.length === 1 ? "" : "s"}</summary>{reviewed.map(renderRow)}</details> : null}{!rows.length ? <p className="muted-copy">No serving roles or requests for this user.</p> : null}</div></section>;
}
