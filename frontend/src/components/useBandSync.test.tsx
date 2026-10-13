// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useBandSync } from "./useBandSync";
import { getBandSelection, updateBandSelection, type BandSelection } from "../api";
vi.mock("../api", () => ({ getBandSelection: vi.fn(), updateBandSelection: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shares pages across devices without echoing, supports independent browsing, and catches up on re-enable", async () => {
  vi.useFakeTimers();
  let shared: BandSelection | null = null;
  let tick = 0;
  vi.mocked(getBandSelection).mockImplementation(async () => ({ selection: shared }));
  vi.mocked(updateBandSelection).mockImplementation(async (_plan, slide_id) => ({ selection: shared = { slide_id, updated_at: ++tick } }));
  const devices: Record<string, ReturnType<typeof useBandSync>> = {};
  function Device({ id, enabled }: { id: string; enabled: boolean }) {
    devices[id] = useBandSync("plan", enabled);
    return <span>{devices[id].selection?.slide_id}</span>;
  }
  const a = createRoot(document.createElement("div")), b = createRoot(document.createElement("div"));
  try {
    await act(async () => { a.render(<Device id="a" enabled />); b.render(<Device id="b" enabled />); });
    await act(async () => devices.a.publish("verse"));
    await act(async () => vi.advanceTimersByTime(500));
    expect(devices.b.selection?.slide_id).toBe("verse");
    expect(updateBandSelection).toHaveBeenCalledTimes(1);
    await act(async () => b.render(<Device id="b" enabled={false} />));
    const reads = vi.mocked(getBandSelection).mock.calls.length;
    await act(async () => devices.b.publish("private"));
    expect(updateBandSelection).toHaveBeenCalledTimes(1);
    await act(async () => devices.a.publish("chorus"));
    await act(async () => vi.advanceTimersByTime(500));
    expect(getBandSelection).toHaveBeenCalledTimes(reads + 1);
    expect(devices.b.selection).toBeNull();
    await act(async () => b.render(<Device id="b" enabled />));
    expect(devices.b.selection?.slide_id).toBe("chorus");
    expect(updateBandSelection).toHaveBeenCalledTimes(2);
  } finally { act(() => { a.unmount(); b.unmount(); }); vi.useRealTimers(); vi.clearAllMocks(); }
});

it("ignores an old poll arriving after local navigation", async () => {
  let resolveRead!: (value: { selection: BandSelection }) => void;
  vi.mocked(getBandSelection).mockImplementation(() => new Promise(resolve => { resolveRead = resolve; }));
  vi.mocked(updateBandSelection).mockResolvedValue({ selection: { slide_id: "new", updated_at: 2 } });
  let device!: ReturnType<typeof useBandSync>;
  function Device() { device = useBandSync("plan", true); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Device />));
    await act(async () => device.publish("new"));
    await act(async () => resolveRead({ selection: { slide_id: "old", updated_at: 1 } }));
    expect(device.selection?.slide_id).toBe("new");
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});
