import { expect, it, vi } from "vitest";
import { setNativeBlur, supportsNativeBlur } from "./cameraPrivacy";

it("only offers native blur when the active track reports it", () => {
  expect(supportsNativeBlur()).toBe(false);
  expect(supportsNativeBlur({ getCapabilities: () => ({ backgroundBlur: [false] }) } as unknown as MediaStreamTrack)).toBe(false);
  expect(supportsNativeBlur({ getCapabilities: () => ({ backgroundBlur: [false, true] }) } as unknown as MediaStreamTrack)).toBe(true);
});
it("requires the requested blur setting and preserves camera constraints", async () => {
  const applyConstraints = vi.fn(async () => {});
  const track = { getConstraints: () => ({ width: { ideal: 1280 } }), applyConstraints } as unknown as MediaStreamTrack;
  await setNativeBlur(track, true);
  expect(applyConstraints).toHaveBeenCalledWith({ width: { ideal: 1280 }, backgroundBlur: { exact: true } });
});
