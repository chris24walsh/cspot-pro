export function reorderRailItems<T extends { id: string }>(items: T[], sourceId: string, targetId: string, after: boolean): T[] {
  const source = items.find((item) => item.id === sourceId);
  if (!source || sourceId === targetId || !items.some((item) => item.id === targetId)) return items;
  const remaining = items.filter((item) => item.id !== sourceId);
  const index = remaining.findIndex((item) => item.id === targetId) + Number(after);
  return [...remaining.slice(0, index), source, ...remaining.slice(index)];
}
