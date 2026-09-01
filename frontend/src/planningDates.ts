function localDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function nextSundayDate(now = new Date()) {
  const sunday = new Date(now);
  sunday.setHours(12, 0, 0, 0);
  sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7));
  return localDateInput(sunday);
}

export function defaultPlanningDate(planDates: string[], now = new Date()) {
  const today = localDateInput(now);
  const nextPlanDate = [...new Set(planDates.filter((date) => date >= today))].sort()[0];
  const sunday = nextSundayDate(now);
  return nextPlanDate && nextPlanDate < sunday ? nextPlanDate : sunday;
}
