import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { parseBarChart } from "../musicPractice";
import type { SongRhythm } from "../songRhythm";

export function ChordPanelBarsEditor({ section, rhythm, chords, canEdit, onChange }: {
  section: string; rhythm: SongRhythm | null; chords: string[]; canEdit: boolean; onChange: (rhythm: SongRhythm) => void;
}) {
  const chart = rhythm?.arrangements?.find((entry) => entry.section === section)?.chart ?? "";
  const [rows, setRows] = useState(() => chart.split(/[|\n]/).map((row) => row.trim()).filter(Boolean));
  const ownChart = useRef(chart);
  useEffect(() => {
    if (chart !== ownChart.current) { setRows(chart.split(/[|\n]/).map((row) => row.trim()).filter(Boolean)); ownChart.current = chart; }
  }, [chart]);
  const current = rhythm ?? { numerator: 4, denominator: 4 as const, patterns: [], notes: "" };
  let error: string | null = null;
  let count = 0;
  try { count = parseBarChart(chart, current.numerator, section).length; }
  catch (cause) { error = cause instanceof Error ? cause.message : "Check the bar chords."; }
  function update(next: string[]) {
    setRows(next);
    const text = next.join(" | "); ownChart.current = text;
    onChange({ ...current, arrangements: [...(current.arrangements ?? []).filter((entry) => entry.section !== section), ...(next.length ? [{ section, chart: text }] : [])] });
  }
  return <div className="chord-panel-bars" aria-label={`${section === "Default" ? "Whole song" : section} bars`}>
    <div className="chord-panel-bars-heading">
      <strong>{section === "Default" ? "Whole song" : section} · {count} bars · {current.numerator}/{current.denominator}</strong>
      <button className="text-button" disabled={!canEdit} onClick={() => update([...rows, chords[rows.length] ?? rows[rows.length - 1]?.split(/[\s@*]/)[0] ?? "C"])} type="button"><Plus size={13} aria-hidden="true" />Add bar</button>
      {!rows.length && chords.length ? <button className="text-button" disabled={!canEdit} onClick={() => update(chords)} type="button">Use section chords</button> : null}
    </div>
    <div className="chord-panel-bar-cards">
      {rows.map((row, index) => <label className="chord-panel-bar-card" key={index}>
        <span>{index + 1}</span>
        <input aria-label={`${section} bar ${index + 1} chords`} disabled={!canEdit} maxLength={200} onChange={(event) => update(rows.map((entry, position) => position === index ? event.target.value : entry))} placeholder="C G or C@1 G@3" value={row} />
        <button aria-label={`Remove ${section} bar ${index + 1}`} className="section-icon-button" disabled={!canEdit} onClick={() => update(rows.filter((_, position) => position !== index))} title="Remove bar" type="button"><Trash2 size={12} aria-hidden="true" /></button>
      </label>)}
    </div>
    {error ? <small className="form-message" role="alert">{error}</small> : null}
  </div>;
}
