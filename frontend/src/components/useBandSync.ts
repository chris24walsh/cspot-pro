import { useCallback, useEffect, useRef, useState } from "react";
import { getBandSelection, updateBandSelection, type BandSelection } from "../api";

// This channel shares only the musicians' page, independently of service output.
export function useBandSync(planId: string | null, enabled: boolean) {
  const [selection, setSelection] = useState<BandSelection | null>(null);
  const [error, setError] = useState("");
  const latest = useRef(0);
  const generation = useRef(0);
  const pending = useRef(0);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    latest.current = 0;
    generation.current += 1;
    pending.current = 0;
    setSelection(null);
    setError("");
    if (!planId || !enabled) return;
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (polling || pending.current) return;
      polling = true;
      const version = generation.current;
      try {
        const result = await getBandSelection(planId);
        if (!disposed && !pending.current && version === generation.current && result.selection && result.selection.updated_at > latest.current) {
          latest.current = result.selection.updated_at;
          setSelection(result.selection);
          setError("");
        }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Could not sync band pages");
      } finally { polling = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [planId, enabled]);
  const publish = useCallback(async (slideId: string) => {
    if (!planId || !enabled) return;
    const version = ++generation.current;
    pending.current += 1;
    setSelection({ slide_id: slideId, updated_at: latest.current });
    try {
      const request = writes.current.catch(() => {}).then(() => {
        // Keep the in-flight write, but collapse queued turns to the newest page.
        if (version !== generation.current) return null;
        return updateBandSelection(planId, slideId);
      });
      writes.current = request;
      const result = await request;
      if (version === generation.current && result?.selection) {
        latest.current = result.selection.updated_at;
        setSelection(result.selection);
        setError("");
      }
    } catch (cause) {
      if (version === generation.current) setError(cause instanceof Error ? cause.message : "Could not sync band pages");
    } finally { if (version === generation.current) pending.current = 0; }
  }, [planId, enabled]);
  return { selection, publish, error };
}
