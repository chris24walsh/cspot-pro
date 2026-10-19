import { useEffect, useState } from "react";
import { getManagedServingAreas, setManagedServingAreas, type ServingArea } from "../api";

export function ServingManagementGrants({ userId, areas }: { userId: string; areas: ServingArea[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let current = true;
    setBusy(true);
    setLoaded(false);
    setMessage("");
    getManagedServingAreas(userId).then((ids) => { if (current) { setSelected(ids); setLoaded(true); } })
      .catch((error) => { if (current) setMessage(String(error)); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [userId]);
  async function toggle(id: string) {
    setBusy(true);
    setMessage("");
    try { setSelected(await setManagedServingAreas(userId, selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id])); }
    catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }
  return <fieldset className="wide-field role-fieldset capability-fieldset"><legend>Team management</legend>
    <p className="muted-copy">Allow this user to invite, approve, suspend and remove volunteers only for the selected serving roles. This grants the management view without account or system administration.</p>
    {areas.map((area) => <label className="admin-role-toggle" key={area.id}><input type="checkbox" checked={selected.includes(area.id)} disabled={busy || !loaded} onChange={() => void toggle(area.id)} /><span>{area.category} · {area.name}</span></label>)}
    {message ? <p role="alert">{message}</p> : null}
  </fieldset>;
}
