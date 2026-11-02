// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServiceCameraControl } from "./ServiceCameraControl";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../remoteContribution", () => ({ contributionRequest: request }));
vi.mock("./RemoteGuest", () => ({ RemoteGuest: ({ token, embedded, autoJoin }: { token: string; embedded: boolean; autoJoin: boolean }) => <div data-token={token} data-embedded={embedded} data-autojoin={autoJoin}>Local camera controls</div> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  request.mockReset(); request.mockResolvedValue({ id: "owned-camera", token: "scoped-token" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it("starts the teacher's camera in the Service workspace without changing the page", async () => {
  const original = window.location.href;
  await act(async () => root.render(<ServiceCameraControl />));
  expect(request).not.toHaveBeenCalled();
  await act(async () => host.querySelector("button")!.click());
  expect(request).toHaveBeenCalledWith("/self", "POST");
  const panel = document.querySelector(".service-camera-panel")!;
  expect(panel.getAttribute("aria-label")).toBe("Your service camera and microphone");
  expect(panel.querySelector("[data-token]")?.getAttribute("data-token")).toBe("scoped-token");
  expect(panel.querySelector("[data-autojoin]")?.getAttribute("data-autojoin")).toBe("true");
  expect(window.location.href).toBe(original);
});
it("stops the owned camera and removes its panel", async () => {
  await act(async () => root.render(<ServiceCameraControl />));
  await act(async () => host.querySelector("button")!.click());
  await act(async () => host.querySelector("button")!.click());
  expect(request).toHaveBeenCalledWith("/self/owned-camera", "DELETE");
  expect(document.querySelector(".service-camera-panel")).toBeNull();
});
it("ends a camera session if its creation finishes after leaving Service", async () => {
  let finish!: (value: { id: string; token: string }) => void;
  request.mockImplementation((path: string) => path === "/self" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: true }));
  await act(async () => root.render(<ServiceCameraControl />));
  await act(async () => host.querySelector("button")!.click());
  await act(async () => root.unmount());
  await act(async () => finish({ id: "late-camera", token: "scoped-token" }));
  expect(request).toHaveBeenCalledWith("/self/late-camera", "DELETE");
  expect(document.querySelector(".service-camera-panel")).toBeNull();
});
it("shows a connection error without opening a camera panel", async () => {
  request.mockRejectedValue(new Error("Camera gateway unavailable"));
  await act(async () => root.render(<ServiceCameraControl />));
  await act(async () => host.querySelector("button")!.click());
  expect(host.querySelector("[role=alert]")?.textContent).toBe("Camera gateway unavailable");
  expect(document.querySelector(".service-camera-panel")).toBeNull();
});

it("hides the preview without ending capture and reopens the same session", async () => {
  await act(async () => root.render(<ServiceCameraControl />));
  await act(async () => host.querySelector("button")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Hide camera controls"]')!.click());
  expect(document.querySelector<HTMLElement>(".service-camera-panel")?.hidden).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Show camera controls"]')!.click());
  expect(document.querySelector<HTMLElement>(".service-camera-panel")?.hidden).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
});
