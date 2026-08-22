import type { VolunteerFrequencyPeriod, VolunteerRotationMode } from "../api";

const PERIOD_LIMITS: Record<VolunteerFrequencyPeriod, number> = {
  week: 3,
  month: 5,
  quarter: 8,
  year: 12,
};

export function servingFrequencyOptions(period: VolunteerFrequencyPeriod) {
  return Array.from({ length: PERIOD_LIMITS[period] }, (_, index) => index + 1);
}

export function ServingFrequencyInput({ count, label, mode, onChange, period }: {
  count: number;
  label: string;
  mode: VolunteerRotationMode;
  onChange: (count: number, period: VolunteerFrequencyPeriod, mode: VolunteerRotationMode) => void;
  period: VolunteerFrequencyPeriod;
}) {
  const options = servingFrequencyOptions(period);
  const safeCount = Math.min(Math.max(count, 1), options.length);
  return <div className="frequency-input"><select aria-label={`${label} rotation mode`} value={mode} onChange={(event) => onChange(safeCount, period, event.target.value as VolunteerRotationMode)}><option value="auto">Automatic</option><option value="manual">Manual</option><option value="disabled">Disabled</option></select>{mode === "auto" ? <><span>up to</span><select aria-label={`${label} frequency`} value={safeCount} onChange={(event) => onChange(Number(event.target.value), period, mode)}>{options.map((value) => <option key={value} value={value}>{value}</option>)}</select><span>per</span><select aria-label={`${label} period`} value={period} onChange={(event) => { const nextPeriod = event.target.value as VolunteerFrequencyPeriod; onChange(Math.min(safeCount, PERIOD_LIMITS[nextPeriod]), nextPeriod, mode); }}><option value="week">week</option><option value="month">month</option><option value="quarter">quarter</option><option value="year">year</option></select></> : <span>{mode === "manual" ? "Manual assignment only" : "Hidden from assignment"}</span>}</div>;
}
