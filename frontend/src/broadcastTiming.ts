export function isBroadcastStartingSoon(
  serviceDate: string | null | undefined,
  nowMs: number,
  leadMinutes: number,
) {
  if (!serviceDate) return false;
  const serviceTime = new Date(serviceDate).getTime();
  if (Number.isNaN(serviceTime)) return false;
  const minutesUntil = (serviceTime - nowMs) / 60000;
  return minutesUntil <= leadMinutes && minutesUntil >= -30;
}
