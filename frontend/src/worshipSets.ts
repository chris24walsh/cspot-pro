import type { PlanDetail, PlanItem, PlanSummary, PlanType } from "./api";

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
  const insertionSequence = anchorSequence ?? firstServiceSongSequence ?? 30;
  const serviceWithoutSongs = sortedServiceItems.filter((item) => item.item_type !== "song" && item.item_type !== WORSHIP_SET_ANCHOR_ITEM_TYPE);
  const serviceBeforeWorship = serviceWithoutSongs.filter((item) => (Number.parseFloat(item.sequence) || 0) < insertionSequence);
  const serviceAfterWorship = serviceWithoutSongs.filter((item) => (Number.parseFloat(item.sequence) || 0) >= insertionSequence);
  const mergedSongs = songs.map((item, index) => ({
    ...item,
    sequence: (insertionSequence + (index + 1) / 10000).toFixed(4),
  }));

  return [...serviceBeforeWorship, ...mergedSongs, ...serviceAfterWorship];
}
