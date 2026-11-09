// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useServiceCameraAlerts } from "./useServiceCameraAlerts";

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it("plays one two-note cue per new connection and defers blocked audio until interaction", async () => {
  const start=vi.fn();
  const gain={gain:{setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};
  const context={state:"suspended",currentTime:0,destination:{},resume:vi.fn(() => Promise.resolve()),close:vi.fn(() => Promise.resolve()),createGain:()=>gain,createOscillator:()=>({frequency:{value:0},connect:()=>gain,start,stop:vi.fn(),disconnect:vi.fn()})};
  vi.stubGlobal("AudioContext",vi.fn(()=>context));
  let alerts: ReturnType<typeof useServiceCameraAlerts>;
  function Harness() { alerts=useServiceCameraAlerts(true); return null; }
  const host=document.createElement("div"); const root=createRoot(host);
  const camera={id:"teacher",label:"Teacher",self_managed:true,connected:true,live:false,expires_at:"",revoked:false,return_source_id:null};
  try {
    await act(async () => root.render(<Harness/>));
    await act(async () => alerts.reportCameras([camera]));
    expect(start).not.toHaveBeenCalled();
    context.state="running";
    await act(async () => window.dispatchEvent(new Event("pointerdown")));
    expect(start).toHaveBeenCalledTimes(2);
    expect(alerts!.soundReady).toBe(true);
    await act(async () => alerts.reportCameras([camera]));
    expect(start).toHaveBeenCalledTimes(2);
    await act(async () => alerts.acknowledge());
    await act(async () => alerts.reportCameras([camera]));
    expect(alerts!.requests).toHaveLength(0);
    await act(async () => alerts.reportCameras([{...camera,connected:false}]));
    await act(async () => alerts.reportCameras([camera]));
    expect(start).toHaveBeenCalledTimes(4);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
