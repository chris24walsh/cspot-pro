export type RailPlacement = 'before' | 'after' | 'inside';
type RailItem = { id: string; parent_item_id?: string | null; sequence: string };

export function railMovePosition(items: RailItem[], sourceId: string, targetId: string, placement: RailPlacement) {
  const source = items.find((item) => item.id === sourceId);
  const target = items.find((item) => item.id === targetId);
  if (!source || !target || sourceId === targetId) return null;
  if (placement === 'inside' && target.parent_item_id) return null;
  const parentId = placement === 'inside' ? target.id : target.parent_item_id ?? null;
  if (parentId === sourceId) return null;
  if (parentId && items.some((item) => item.parent_item_id === sourceId)) return null;
  const siblings = items.filter((item) => item.id !== sourceId && (item.parent_item_id ?? null) === parentId)
    .sort((left, right) => Number(left.sequence) - Number(right.sequence));
  const targetIndex = siblings.findIndex((item) => item.id === targetId);
  const previous = placement === 'inside' ? siblings[siblings.length - 1]
    : placement === 'after' ? target : siblings[targetIndex - 1];
  return { parent_item_id: parentId, after_item_id: previous?.id ?? null };
}
