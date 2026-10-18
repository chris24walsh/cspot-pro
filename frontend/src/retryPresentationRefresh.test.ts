import { afterEach, expect, it, vi } from "vitest";
import { retryPresentationRefresh } from "./retryPresentationRefresh";

afterEach(() => { vi.useRealTimers(); });

it("retries failed content without requiring another verse change, then stops", async () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(false).mockResolvedValue(true);
  const cancel = retryPresentationRefresh(refresh, 500);
  await vi.advanceTimersByTimeAsync(1500);
  expect(refresh).toHaveBeenCalledTimes(3);
  cancel();
});

it("does not retry a superseded verse even when its request fails later", async () => {
  vi.useFakeTimers();
  let finish!: (value: boolean) => void;
  const refresh = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const cancel = retryPresentationRefresh(refresh, 500);
  cancel();
  finish(false);
  await vi.advanceTimersByTimeAsync(1500);
  expect(refresh).toHaveBeenCalledTimes(1);
});
