import { useEffect, useRef, useState, type ReactNode } from "react";
import { Columns2, Music2, SlidersHorizontal } from "lucide-react";
import { CompactControlMenu } from "./CompactControlMenu";
import { Xr18MixerPanel } from "./Xr18MixerPanel";

type View = "worship" | "mixer" | "split";
type WorkspaceMenu = (close: () => void) => ReactNode;

// Edge gestures leave lyric paging, strip scrolling and faders untouched.
function SwipeEdge({ target, onSwitch }: { target: "worship" | "mixer"; onSwitch: () => void }) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  return <div className={`worship-workspace-swipe edge-${target}`} data-workspace-swipe={target} aria-hidden="true"
    onPointerDown={event => {
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.stopPropagation();
    }}
    onPointerCancel={() => { start.current = null; }}
    onPointerUp={event => {
      const initial = start.current;
      start.current = null;
      if (!initial || initial.id !== event.pointerId) return;
      event.stopPropagation();
      const dx = event.clientX - initial.x, dy = event.clientY - initial.y;
      if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && (target === "mixer" ? dx < 0 : dx > 0)) onSwitch();
    }}
  ><span>{target === "mixer" ? "‹" : "›"}</span></div>;
}

export function WorshipLiveWorkspace({ canUseMixer, children }: {
  canUseMixer: boolean;
  children: (worshipVisible: boolean, menu: WorkspaceMenu | undefined, split: boolean) => ReactNode;
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
  function select(next: View) {
    setView(next);
    if (next !== "worship") setMixerOpened(true);
  }
  const menu: WorkspaceMenu = close => <>
    {([
      ["worship", "Worship", Music2],
      ["mixer", "Mixer", SlidersHorizontal],
      ...(wide ? [["split", "Split", Columns2] as const] : []),
    ] as const).map(([value, label, Icon]) => <button key={value} type="button" role="menuitemradio"
      aria-checked={effectiveView === value} aria-label={label}
      title={value === "split" ? "Worship and mixer side by side" : `${label} · swipe from the ${value === "mixer" ? "right" : "left"} edge`}
      onClick={() => { close(); select(value); }}
    ><Icon size={16} aria-hidden="true" /><span>{label}</span></button>)}
  </>;
  return <section className={`worship-live-shell worship-workspace view-${effectiveView}`} aria-label="Musician live worship">
    <div className="worship-workspace-panes">
      <div className="worship-workspace-song" hidden={!worshipVisible}>
        {children(worshipVisible, canUseMixer ? menu : undefined, effectiveView === "split")}
        {canUseMixer && effectiveView === "worship" ? <SwipeEdge target="mixer" onSwitch={() => select("mixer")} /> : null}
      </div>
      {canUseMixer && mixerOpened ? <div className="worship-live-mixer" hidden={effectiveView === "worship"} aria-label="Worship mixer">
        <Xr18MixerPanel embeddedExpanded headerControls={<CompactControlMenu label="Workspace" icon={<Columns2 size={16} aria-hidden="true" />}>{menu}</CompactControlMenu>} />
        {effectiveView === "mixer" ? <SwipeEdge target="worship" onSwitch={() => select("worship")} /> : null}
      </div> : null}
    </div>
  </section>;
}
