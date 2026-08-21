import { useState } from "react";

import { removeVolunteerPreference, reviewVolunteerPreference, type VolunteerAdminRecord, type VolunteerStatus } from "../api";

export function VolunteerReview({ onChanged, rows }: { onChanged: () => Promise<void>; rows: VolunteerAdminRecord[] }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ row: VolunteerAdminRecord; status: VolunteerStatus } | null>(null);
  async function review(row: VolunteerAdminRecord, status: VolunteerStatus) {
    const previousStatus = row.preference.status;
    await reviewVolunteerPreference(row.preference.id, { status, preferred_frequency: row.preference.preferred_frequency, admin_notes: row.preference.admin_notes });
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
  const renderRow = (row: VolunteerAdminRecord) => <article className={row.preference.status === "pending" ? "is-pending" : ""} key={row.preference.id}><div><strong>{row.preference.area.name}</strong><span>{row.preference.preferred_frequency.replace("_", " ")} · {row.preference.status}</span>{row.preference.availability_notes ? <small>{row.preference.availability_notes}</small> : null}{row.unavailable.length ? <small>Away: {row.unavailable.map((item) => `${item.starts_on}–${item.ends_on}`).join(", ")}</small> : null}</div><div className="action-row">{row.preference.status === "pending" ? <><button className="text-button" onClick={() => void review(row, "declined")} type="button">Decline</button><button className="primary-button" onClick={() => void review(row, "approved")} type="button">Approve</button></> : <button className="text-button" onClick={() => void review(row, row.preference.status === "approved" ? "pending" : "approved")} type="button">{row.preference.status === "approved" ? "Review again" : "Approve"}</button>}<button className="danger-button" onClick={() => void remove(row)} type="button">Remove</button></div></article>;
  return <section className="subsection-panel volunteer-review"><div className="section-heading"><div><p className="eyebrow">Serving</p><h3>Roles and tasks</h3></div>{pending.length ? <span className="status-pill attention">{pending.length} pending</span> : null}</div>{notice ? <div className="inline-notice"><span>{notice}</span>{undo ? <button className="text-button" onClick={() => void undoLast()} type="button">Undo</button> : null}</div> : null}<div className="volunteer-review-list">{pending.map(renderRow)}{reviewed.length ? <details className="approved-volunteers"><summary>{reviewed.length} reviewed role{reviewed.length === 1 ? "" : "s"}</summary>{reviewed.map(renderRow)}</details> : null}{!rows.length ? <p className="muted-copy">No serving roles or requests for this user.</p> : null}</div></section>;
}
