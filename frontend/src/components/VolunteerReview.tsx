import { useEffect, useState } from "react";
import { getVolunteerAdminRecords, reviewVolunteerPreference, type VolunteerAdminRecord, type VolunteerStatus } from "../api";

export function VolunteerReview() {
  const [rows, setRows] = useState<VolunteerAdminRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  async function load() { setRows(await getVolunteerAdminRecords()); }
  useEffect(() => { void load().catch(() => setMessage("Could not load volunteer requests.")); }, []);
  async function review(row: VolunteerAdminRecord, status: VolunteerStatus) { await reviewVolunteerPreference(row.preference.id, { status, preferred_frequency: row.preference.preferred_frequency, admin_notes: row.preference.admin_notes }); await load(); setMessage(`${row.user_name}: ${status}.`); }
  return <section className="subsection-panel volunteer-review"><div className="section-heading"><div><p className="eyebrow">Serving</p><h3>Volunteer requests</h3></div><span className="status-pill">{rows.filter((row) => row.preference.status === "pending").length} pending</span></div>{message ? <p className="form-message">{message}</p> : null}<div className="volunteer-review-list">{rows.length ? rows.map((row) => <article key={row.preference.id}><div><strong>{row.user_name}</strong><span>{row.preference.area.name} · {row.preference.preferred_frequency.replace("_", " ")} · {row.preference.status}</span>{row.preference.availability_notes ? <small>{row.preference.availability_notes}</small> : null}{row.unavailable.length ? <small>Away: {row.unavailable.map((item) => `${item.starts_on}–${item.ends_on}`).join(", ")}</small> : null}</div><div className="action-row"><button className="text-button" type="button" onClick={() => void review(row, "declined")}>Decline</button><button className="primary-button" type="button" onClick={() => void review(row, "approved")}>Approve</button></div></article>) : <p className="muted-copy">No volunteer requests yet.</p>}</div></section>;
}
