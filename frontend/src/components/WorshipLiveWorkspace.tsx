import { useEffect, useState, type ReactNode } from "react";
import { Columns2, Music2, SlidersHorizontal } from "lucide-react";
import { Xr18MixerPanel } from "./Xr18MixerPanel";

type View = "worship" | "mixer" | "split";

export function WorshipLiveWorkspace({ canUseMixer, children }: {
  canUseMixer: boolean;
  children: (worshipVisible: boolean) => ReactNode;
}) {
  const [view, setView] = useState<View>("worship");
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1100px)").matches);
  const [mixerOpened, setMixerOpened] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1100px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const effectiveView = !canUseMixer || view === "split" && !wide ? "worship" : view;
  const worshipVisible = effectiveView !== "mixer";
  return (
    <section className={`worship-live-shell worship-workspace view-${effectiveView}`} aria-label="Musician live worship">
      {canUseMixer ? <div className="worship-workspace-controls segmented-control" role="group" aria-label="Live workspace view">
        {([
          ["worship", "Worship", Music2],
          ["mixer", "Mixer", SlidersHorizontal],
          ...(wide ? [["split", "Split", Columns2] as const] : []),
        ] as const).map(([value, label, Icon]) => <button
          key={value} type="button" aria-label={label} title={label === "Split" ? "Worship and mixer side by side" : label}
          aria-pressed={effectiveView === value} className={effectiveView === value ? "is-active" : ""}
          onClick={() => { setView(value); if (value !== "worship") setMixerOpened(true); }}
        ><Icon size={16} aria-hidden="true" /><span>{label}</span></button>)}
      </div> : null}
      <div className="worship-workspace-panes">
        <div className="worship-workspace-song" hidden={!worshipVisible}>{children(worshipVisible)}</div>
        {canUseMixer && mixerOpened ? <div className="worship-live-mixer" hidden={effectiveView === "worship"} aria-label="Worship mixer"><Xr18MixerPanel /></div> : null}
      </div>
    </section>
  );
}
