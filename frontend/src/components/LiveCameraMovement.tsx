import { useEffect, useState } from "react";
import { CircleStop, MoveHorizontal } from "lucide-react";
import { controlPtzCruise, getPtzCruiseStatus } from "../api";

export function LiveCameraMovement() {
  const [devices, setDevices] = useState<{id: string; label: string}[]>([]);
  const [device, setDevice] = useState("default");
  const [speed, setSpeed] = useState(0.13);
  const [sweep, setSweep] = useState(15);
  const [status, setStatus] = useState<{running: boolean; error: string | null} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const refresh = () => void getPtzCruiseStatus(device).then(next => {
      if (!cancelled) { setDevices(next.devices); setStatus(next); setError(""); }
    }).catch(error => { if (!cancelled) setError(error.message); });
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [device]);
  async function move(enabled: boolean) {
    setBusy(true);
    try { setStatus(await controlPtzCruise(enabled, speed, sweep, device)); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not control camera movement"); }
    finally { setBusy(false); }
  }
  return <div className="broadcast-control-fields">
    <label>Camera<select aria-label="Physical pan camera" value={device} disabled={busy} onChange={event => {setDevice(event.target.value); setStatus(null);}}>{!devices.length && <option value="default">Default camera</option>}{devices.map(camera => <option key={camera.id} value={camera.id}>{camera.label}</option>)}</select></label>
    <label>Pan speed<input type="number" min={0.005} max={0.2} step={0.005} value={speed} onChange={event => setSpeed(Number(event.target.value))}/></label>
    <label>Sweep (seconds)<input type="number" min={5} max={120} value={sweep} onChange={event => setSweep(Number(event.target.value))}/></label>
    <button type="button" className="text-button icon-text-button" disabled={busy || !status || speed < 0.005 || speed > 0.2 || sweep < 5 || sweep > 120} onClick={() => void move(true)}><MoveHorizontal size={15}/> Start pan</button>
    <button type="button" className="text-button icon-text-button" disabled={busy} onClick={() => void move(false)}><CircleStop size={15}/> Stop pan</button>
    <span role="status">{error || status?.error || (status?.running ? "Camera moving" : status ? "Camera stopped" : "Connecting…")}</span>
  </div>;
}
