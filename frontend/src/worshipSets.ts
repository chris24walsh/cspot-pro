import type { PlanDetail, PlanItem, PlanSummary, PlanType } from "./api";
import { defaultPlanningDate } from "./planningDates";

export const WORSHIP_SET_PLAN_TYPE = "Worship Set";
export const WORSHIP_SET_ANCHOR_ITEM_TYPE = "worship_set";

function normalized(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export function isWorshipSetPlan(plan: Pick<PlanSummary, "plan_type"> | null | undefined) {
  return normalized(plan?.plan_type) === normalized(WORSHIP_SET_PLAN_TYPE);
}

export function isWorshipSetType(planType: Pick<PlanType, "name"> | null | undefined) {
  return normalized(planType?.name) === normalized(WORSHIP_SET_PLAN_TYPE);
}

export function worshipSetType(planTypes: PlanType[]) {
  return planTypes.find(isWorshipSetType) ?? null;
}

export function dateKey(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function matchingWorshipSetForService(service: PlanDetail | null, sets: PlanSummary[]) {
  const serviceDate = dateKey(service?.service_date);
  if (!serviceDate) {
    return null;
  }
  return sets.find((candidate) => dateKey(candidate.service_date) === serviceDate) ?? null;
}

export function combinedPlanningItemCount(
  service: Pick<PlanSummary, "item_count"> | null | undefined,
  worshipSet: Pick<PlanSummary, "item_count"> | null | undefined,
) {
  return (service?.item_count ?? 0) + (worshipSet?.item_count ?? 0);
}

export function explicitPlanningItemCount(items: PlanItem[]) {
  const structuralItemTypes = new Set(["welcome_montage", "welcome_countdown", "welcome_seated"]);
  return items.filter((item) => !structuralItemTypes.has(item.item_type) && Boolean(item.parent_item_id || item.song_id)).length;
}

export function preferredWorshipSetPlanId(sets: PlanSummary[], now = new Date()) {
  const targetDate = defaultPlanningDate(
    sets.filter((candidate) => candidate.item_count > 0).map((candidate) => dateKey(candidate.service_date)),
    now,
  );
  return sets.find((candidate) => dateKey(candidate.service_date) === targetDate)?.id ?? "";
}

export function preferredServicePlanId(services: PlanSummary[], worshipSets: PlanSummary[], now = new Date()) {
  const worshipSetsByDate = new Map(worshipSets.map((set) => [dateKey(set.service_date), set]));
  const targetDate = defaultPlanningDate(
    services
      .filter((service) => combinedPlanningItemCount(service, worshipSetsByDate.get(dateKey(service.service_date))) > 0)
      .map((service) => dateKey(service.service_date)),
    now,
  );
  return services.find((service) => dateKey(service.service_date) === targetDate)?.id ?? "";
}

export function isPlanEditingLocked(
  plan: Pick<PlanDetail, "id" | "plan_type" | "plan_type_id" | "service_date"> | null,
  planTypes: PlanType[],
  plans: PlanSummary[],
  now = new Date(),
) {
  if (!plan) return false;
  const serviceDay = dateKey(plan.service_date);
  let effectiveType = planTypes.find((candidate) => candidate.id === plan.plan_type_id);
  if (isWorshipSetPlan(plan)) {
    const service = plans.find((candidate) => !isWorshipSetPlan(candidate) && dateKey(candidate.service_date) === serviceDay);
    effectiveType = planTypes.find((candidate) => candidate.name === service?.plan_type) ?? effectiveType;
  }
  if (!effectiveType?.starts_at) return dateKey(now.toISOString()) > serviceDay;
  const cutoff = new Date(`${serviceDay}T${effectiveType.starts_at}`);
  return !Number.isNaN(cutoff.getTime()) && now.getTime() > cutoff.getTime();
}

function sortedItems(items: PlanItem[]) {
  return [...items].sort((left, right) => (Number.parseFloat(left.sequence) || 0) - (Number.parseFloat(right.sequence) || 0));
}

export function worshipSongItems(items: PlanItem[]) {
  return sortedItems(items).filter((item) => item.item_type === "song" && item.song_id);
}

export function mergeWorshipSetIntoService(serviceItems: PlanItem[], worshipSetItems: PlanItem[]) {
  const songs = worshipSongItems(worshipSetItems);
  if (!songs.length) {
    return sortedItems(serviceItems.filter((item) => item.item_type !== WORSHIP_SET_ANCHOR_ITEM_TYPE));
  }

  const sortedServiceItems = sortedItems(serviceItems);
  const anchorSequence = sortedServiceItems
    .filter((item) => item.item_type === WORSHIP_SET_ANCHOR_ITEM_TYPE)
    .map((item) => Number.parseFloat(item.sequence))
    .find((sequence) => Number.isFinite(sequence));
  const firstServiceSongSequence = sortedServiceItems
    .filter((item) => item.item_type === "song")
    .map((item) => Number.parseFloat(item.sequence))
    .find((sequence) => Number.isFinite(sequence));
  const serviceWithoutSongs = sortedServiceItems.filter((item) => item.item_type !== "song" && item.item_type !== WORSHIP_SET_ANCHOR_ITEM_TYPE);
  const welcomeIndex = serviceWithoutSongs.findIndex((item) => ["welcome", "opening"].includes(normalized(item.item_type)));
  const welcomeSequence = welcomeIndex >= 0
    ? Number.parseFloat(serviceWithoutSongs[welcomeIndex]?.sequence ?? "")
    : Number.NaN;
  const insertionSequence = Number.isFinite(welcomeSequence)
    ? welcomeSequence
    : anchorSequence ?? firstServiceSongSequence ?? 30;
  const mergedSongs = songs.map((item, index) => ({
    ...item,
    sequence: (insertionSequence + (index + 1) / 10000).toFixed(4),
  }));

  if (welcomeIndex >= 0) {
    return [
      ...serviceWithoutSongs.slice(0, welcomeIndex + 1),
      ...mergedSongs,
      ...serviceWithoutSongs.slice(welcomeIndex + 1),
    ];
  }

  const serviceBeforeWorship = serviceWithoutSongs.filter((item) => (Number.parseFloat(item.sequence) || 0) < insertionSequence);
  const serviceAfterWorship = serviceWithoutSongs.filter((item) => (Number.parseFloat(item.sequence) || 0) >= insertionSequence);

  return [...serviceBeforeWorship, ...mergedSongs, ...serviceAfterWorship];
}
