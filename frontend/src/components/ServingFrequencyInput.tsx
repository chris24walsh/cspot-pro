import type { VolunteerFrequencyPeriod } from "../api";

const PERIOD_LIMITS: Record<VolunteerFrequencyPeriod, number> = {
  week: 3,
  month: 5,
  quarter: 8,
  year: 12,
};

export function servingFrequencyOptions(period: VolunteerFrequencyPeriod) {
  return Array.from({ length: PERIOD_LIMITS[period] }, (_, index) => index + 1);
}

export function ServingFrequencyInput({ count, label, onChange, period }: {
  count: number;
  label: string;
  onChange: (count: number, period: VolunteerFrequencyPeriod) => void;
  period: VolunteerFrequencyPeriod;
}) {
  const options = servingFrequencyOptions(period);
  const safeCount = Math.min(Math.max(count, 1), options.length);
  return <div className="frequency-input"><span>Up to</span><select aria-label={`${label} frequency`} value={safeCount} onChange={(event) => onChange(Number(event.target.value), period)}>{options.map((value) => <option key={value} value={value}>{value}</option>)}</select><span>per</span><select aria-label={`${label} period`} value={period} onChange={(event) => { const nextPeriod = event.target.value as VolunteerFrequencyPeriod; onChange(Math.min(safeCount, PERIOD_LIMITS[nextPeriod]), nextPeriod); }}><option value="week">week</option><option value="month">month</option><option value="quarter">quarter</option><option value="year">year</option></select></div>;
}
