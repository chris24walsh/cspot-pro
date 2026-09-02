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

export function adjacentPlanningDate(currentDate: string, direction: "next" | "previous", planDates: string[]) {
  const current = new Date(`${currentDate}T12:00:00`);
  if (Number.isNaN(current.getTime())) return "";
  const sunday = new Date(current);
  const day = sunday.getDay();
  const offset = direction === "next" ? (7 - day) % 7 || 7 : -(day || 7);
  sunday.setDate(sunday.getDate() + offset);
  const sundayDate = localDateInput(sunday);
  const eligiblePlans = [...new Set(planDates)]
    .filter((date) => direction === "next" ? date > currentDate : date < currentDate)
    .sort();
  const planDate = direction === "next" ? eligiblePlans[0] : eligiblePlans[eligiblePlans.length - 1];
  if (!planDate) return sundayDate;
  return direction === "next"
    ? (planDate < sundayDate ? planDate : sundayDate)
    : (planDate > sundayDate ? planDate : sundayDate);
}
