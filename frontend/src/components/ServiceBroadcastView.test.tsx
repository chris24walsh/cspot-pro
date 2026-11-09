// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteGuest } from "../remoteContribution";
import { ServiceBroadcastView } from "./ServiceBroadcastView";
const { update, viewership, cameraReporter } = vi.hoisted(() => ({ update: vi.fn(), viewership: vi.fn(), cameraReporter: { current: null as null | ((cameras: RemoteGuest[]) => void) } }));
vi.mock("../api", async importOriginal => ({
  ...await importOriginal<typeof import("../api")>(),
  getPlans: async () => [], getSongs: async () => [], getLivePresentationServices: async () => [],
  getBroadcastViewerSettings: async () => ({camera_sources: [{id:"front",label:"Front",url:"/camera"}], audio_sources: [], audio_scenes: [], manual_live_audience:"off", active_audio_scene:"pastor", audio_scene_automation:true, camera_cycle_seconds:0, camera_fade_ms:1200, slide_delay_ms:800, live_audio_source:"none"}),
  getLivestreamViewership: viewership,
  getPtzCruiseStatus: async () => ({running:false, error:null, devices:[]}),
  updateBroadcastViewerSettings: update,
}));
vi.mock("./RemoteContributionPanel", () => ({RemoteContributionPanel: ({onCamerasChange}: {onCamerasChange: (cameras: RemoteGuest[]) => void}) => { cameraReporter.current = onCamerasChange; return <div>Service cameras</div>; }}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host=document.createElement("div"); document.body.append(host); root=createRoot(host); update.mockReset(); viewership.mockResolvedValue([]); });
afterEach(async () => {await act(async () => root.unmount()); host.remove();});
async function render(admin=false) { await act(async () => root.render(<ServiceBroadcastView canControl={admin}/>)); }
async function click(label:string) {await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());}
it("minimizes and restores either panel and maximizes one at a time", async () => {
  await render();
  await click("Minimize Camera");
  expect(host.querySelector(".service-broadcast-camera-pane")?.classList.contains("panel-minimized")).toBe(true);
  await click("Restore Camera");
  expect(host.querySelector(".service-broadcast-camera-pane")?.classList.contains("panel-normal")).toBe(true);
  await click("Maximize Slides");
  expect(host.querySelector(".service-broadcast-grid")?.classList.contains("has-maximized-panel")).toBe(true);
  await click("Restore Slides");
  expect(host.querySelector(".service-broadcast-grid")?.classList.contains("has-maximized-panel")).toBe(false);
});
it("offers admin controls while offline and persists taking cameras off air", async () => {
  await render(true);
  expect(host.querySelector('[aria-label="Quick livestream controls"]')).not.toBeNull();
  expect(host.textContent).toContain("Today’s watchers");
  update.mockResolvedValue({camera_sources:[{id:"front",label:"Front",url:"/camera",enabled:false}],audio_sources:[],audio_scenes:[],live_audio_source:"none", active_audio_scene:"pastor", audio_scene_automation:true, manual_live_audience:"off", camera_cycle_seconds:0, camera_fade_ms:1200, slide_delay_ms:800});
  await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Cameras off air")!.click());
  expect(update).toHaveBeenCalledWith({camera_sources:[{id:"front",label:"Front",url:"/camera",enabled:false}]});
});
it("keeps live controls restricted to admins", async () => {
  await render();
  expect(host.querySelector('[aria-label="Quick livestream controls"]')).toBeNull();
});

it("orders frequent controls first and contracts the previous category", async () => {
  await render(true);
  const categories = Array.from(host.querySelectorAll<HTMLDetailsElement>(".broadcast-control-category"));
  expect(categories.map(category => category.querySelector("summary .broadcast-accordion-heading > span")?.textContent)).toEqual([
    " Cameras & framing", "Program audio", "Service cameras", "Today’s watchers", "Physical pan", "Switching & sync", "Stream status",
  ]);
  expect(categories[0].open).toBe(true);
  await act(async () => {
    categories[1].open = true;
    categories[1].dispatchEvent(new Event("toggle"));
  });
  expect(categories[0].open).toBe(false);
  expect(categories[1].open).toBe(true);
  await act(async () => {
    categories[3].open = true;
    categories[3].dispatchEvent(new Event("toggle"));
  });
  expect(categories[1].open).toBe(false);
  expect(categories[3].open).toBe(true);
  await act(async () => {
    categories[3].open = false;
    categories[3].dispatchEvent(new Event("toggle"));
  });
  expect(categories.every(category => !category.open)).toBe(true);
});
it("summarizes watchers as current / unique today across repeated service sessions", async () => {
  const today = new Date().toISOString();
  viewership.mockResolvedValue([
    {id:"one", title:"Morning", started_at:today, ended_at:today, viewers:[{user_id:"alice",name:"Alice",watching_now:false}, {user_id:"bob",name:"Bob",watching_now:false}]},
    {id:"two", title:"Service", started_at:today, ended_at:null, viewers:[{user_id:"alice",name:"Alice",watching_now:true}, {user_id:"chris",name:"Chris",watching_now:false}]},
    {id:"old", title:"Yesterday", started_at:"2000-01-01T00:00:00Z", ended_at:"2000-01-01T01:00:00Z", viewers:[{user_id:"other",name:"Other",watching_now:false}]},
  ]);
  await render(true);
  const summaries = Array.from(host.querySelectorAll(".broadcast-control-category > summary"));
  expect(summaries.find(summary => summary.textContent?.includes("Today’s watchers"))?.textContent).toContain("1/3 watching");
  expect(summaries.find(summary => summary.textContent?.includes("Cameras & framing"))?.textContent).toContain("Front · 1/1 enabled");
  expect(summaries.find(summary => summary.textContent?.includes("Program audio"))?.textContent).toContain("Muted · Auto");
});

it("promotes a new service camera request until acknowledged without repeating it on refresh", async () => {
  await render(true);
  const camera = {id:"teacher",label:"Teacher",self_managed:true,connected:true,live:false,expires_at:"",revoked:false,return_source_id:null};
  await act(async () => cameraReporter.current?.([camera]));
  expect(host.querySelector(".broadcast-control-category")?.textContent).toContain("Service cameras");
  expect(host.querySelector(".broadcast-control-category")?.classList.contains("has-camera-request")).toBe(true);
  expect(host.querySelector(".camera-request-announcement")?.textContent).toContain("Teacher");
  const request = host.querySelector<HTMLDetailsElement>(".has-camera-request")!;
  await act(async () => { request.open=true; request.dispatchEvent(new Event("toggle")); });
  expect(host.querySelector(".has-camera-request")).toBeNull();
  expect(host.querySelector(".broadcast-control-category")?.textContent).toContain("Cameras & framing");
  await act(async () => cameraReporter.current?.([camera]));
  expect(host.querySelector(".has-camera-request")).toBeNull();
  await act(async () => cameraReporter.current?.([{...camera,connected:false}]));
  await act(async () => cameraReporter.current?.([camera]));
  expect(host.querySelector(".has-camera-request")).not.toBeNull();
  await act(async () => cameraReporter.current?.([{...camera,live:true}]));
  expect(host.querySelector(".has-camera-request")).toBeNull();
});
