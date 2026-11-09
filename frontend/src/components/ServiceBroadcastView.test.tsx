// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServiceBroadcastView } from "./ServiceBroadcastView";
const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("../api", async importOriginal => ({
  ...await importOriginal<typeof import("../api")>(),
  getPlans: async () => [], getSongs: async () => [], getLivePresentationServices: async () => [],
  getBroadcastViewerSettings: async () => ({camera_sources: [{id:"front",label:"Front",url:"/camera"}], audio_sources: [], audio_scenes: [], manual_live_audience:"off", active_audio_scene:"pastor", audio_scene_automation:true, camera_cycle_seconds:0, camera_fade_ms:1200, slide_delay_ms:800, live_audio_source:"none"}),
  getLivestreamViewership: async () => [],
  getPtzCruiseStatus: async () => ({running:false, error:null, devices:[]}),
  updateBroadcastViewerSettings: update,
}));
vi.mock("./RemoteContributionPanel", () => ({RemoteContributionPanel: () => <div>Service cameras</div>}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host=document.createElement("div"); document.body.append(host); root=createRoot(host); update.mockReset(); });
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
