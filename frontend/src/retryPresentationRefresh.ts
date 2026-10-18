// A live position can arrive before its content request succeeds. Keep retrying
// that revision until loaded; cancelling prevents an old revision being retried.
export function retryPresentationRefresh(
  refresh: () => Promise<boolean>,
  delayMs: number,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function attempt() {
    const loaded = await refresh().catch(() => false);
    if (!cancelled && !loaded) timer = setTimeout(() => void attempt(), delayMs);
  }
  void attempt();
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
