import type { PlanHistoryEntry, PlanHistorySnapshotItem } from "./api";

const snapshotFields = ["item_type", "sequence", "title", "planned_start", "comment", "key_signature", "song_id"] as const;

function matchingItem(items: PlanHistorySnapshotItem[], candidate: PlanHistorySnapshotItem) {
  return items.find((item) => item.id === candidate.id)
    ?? (candidate.song_id ? items.find((item) => item.song_id === candidate.song_id) : undefined);
}

/** Builds a new current snapshot with only one historical change reversed. */
export function undoHistoryEntrySnapshot(current: PlanHistorySnapshotItem[], entry: PlanHistoryEntry) {
  const result = current.map((item) => ({ ...item }));

  for (const afterItem of entry.after) {
    if (!matchingItem(entry.before, afterItem)) {
      const currentItem = matchingItem(result, afterItem);
      if (currentItem) result.splice(result.indexOf(currentItem), 1);
    }
  }

  for (const beforeItem of entry.before) {
    const afterItem = matchingItem(entry.after, beforeItem);
    const currentItem = matchingItem(result, beforeItem);
    if (!afterItem) {
      if (!currentItem) result.push({ ...beforeItem });
      continue;
    }
    if (!currentItem) {
      result.push({ ...beforeItem });
      continue;
    }
    for (const field of snapshotFields) {
      if (beforeItem[field] !== afterItem[field]) {
        Object.assign(currentItem, { [field]: beforeItem[field] });
      }
    }
  }

  return result.sort((left, right) => (Number.parseFloat(left.sequence) || 0) - (Number.parseFloat(right.sequence) || 0));
}
