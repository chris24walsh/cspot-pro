import type { PlanDetail, PlanItem, PlanItemMove } from './api';

// Match the move endpoint's destination renumbering without mutating the saved
// snapshots: they are also used for rollback when a request fails.
export function optimisticRailMove(
  service: PlanDetail,
  worship: PlanDetail | null,
  item: PlanItem,
  position: PlanItemMove,
): { service: PlanDetail; worship: PlanDetail | null } {
  const destination = position.plan_id === service.id ? service : worship;
  if (!destination || destination.id !== position.plan_id) throw new Error('Destination plan is unavailable.');
  const siblings = destination.items
    .filter((candidate) => candidate.id !== item.id && (candidate.parent_item_id ?? null) === position.parent_item_id)
    .sort((left, right) => Number(left.sequence) - Number(right.sequence) || left.id.localeCompare(right.id));
  const previousIndex = position.after_item_id ? siblings.findIndex((candidate) => candidate.id === position.after_item_id) : -1;
  if (position.after_item_id && previousIndex < 0) throw new Error('The drop position has changed; try again.');
  const moved = {
    ...item,
    plan_id: position.plan_id,
    parent_item_id: position.parent_item_id,
    presentation_options: position.plan_id === service.id && item.item_type === 'song'
      ? { ...item.presentation_options, service_placement: true } : item.presentation_options,
  };
  siblings.splice(previousIndex + 1, 0, moved);
  const updated = new Map(siblings.map((candidate, index) => [candidate.id, { ...candidate, sequence: ((index + 1) * 10).toFixed(2) }]));
  function apply(plan: PlanDetail): PlanDetail {
    const items = plan.items.filter((candidate) => candidate.id !== item.id);
    return {
      ...plan,
      items: plan.id === position.plan_id
        ? [...items.map((candidate) => updated.get(candidate.id) ?? candidate), updated.get(item.id)!]
        : items,
    };
  }
  return { service: apply(service), worship: worship ? apply(worship) : null };
}
