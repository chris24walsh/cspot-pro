import type { PlanItem } from "./api";

export type WorshipSequenceUpdate = Pick<PlanItem, "id" | "sequence">;

export function reorderedWorshipSequences(
  orderedItems: PlanItem[],
  itemId: string,
  delta: -1 | 1,
): WorshipSequenceUpdate[] | null {
  const currentIndex = orderedItems.findIndex((item) => item.id === itemId);
  const targetIndex = currentIndex + delta;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedItems.length) {
    return null;
  }

  const reordered = [...orderedItems];
  [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
  return reordered.map((item, index) => ({
    id: item.id,
    sequence: ((index + 1) * 10).toFixed(2),
  }));
}
