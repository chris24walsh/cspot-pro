import { expect, it } from 'vitest';
import type { PlanDetail, PlanItem } from './api';
import { optimisticRailMove } from './optimisticRailMove';

function item(id: string, sequence: string, parent: string | null = null, planId = 'service'): PlanItem {
  return { id, plan_id: planId, parent_item_id: parent, sequence, item_type: 'song', song_id: id,
    title: id, comment: null, key_signature: null, teacher_notes: 'Keep notes', files: [],
    presentation_options: { backing_audio_id: 'backing' } };
}
function plan(id: string, items: PlanItem[]): PlanDetail { return { id, items } as PlanDetail; }

it('updates the destination immediately and keeps rollback snapshots unchanged', () => {
  const moved = item('moved', '10', 'one');
  const other = item('other', '10', 'two');
  const service = plan('service', [moved, other]);
  const next = optimisticRailMove(service, null, moved, { plan_id: 'service', parent_item_id: 'two', after_item_id: 'other' });
  expect(next.service.items.find((entry) => entry.id === moved.id)).toMatchObject({ parent_item_id: 'two', sequence: '20.00', teacher_notes: 'Keep notes' });
  expect(service.items[0]).toBe(moved);
  expect(moved.parent_item_id).toBe('one');
  expect(other.sequence).toBe('10');
});

it('transfers a song without duplicating it or losing its files and settings', () => {
  const moved = item('moved', '10', null, 'worship');
  const files = [{ id: 'attachment', file_id: 'file', sort_order: 2 }] as PlanItem['files'];
  moved.files = files;
  const next = optimisticRailMove(plan('service', []), plan('worship', [moved]), moved,
    { plan_id: 'service', parent_item_id: null, after_item_id: null });
  expect(next.worship?.items).toEqual([]);
  expect(next.service.items).toHaveLength(1);
  expect(next.service.items[0]).toMatchObject({ id: moved.id, plan_id: 'service', parent_item_id: null,
    presentation_options: { backing_audio_id: 'backing', service_placement: true } });
  expect(next.service.items[0].files).toBe(files);
});

it('undoes a move against current state while keeping unrelated newer items', () => {
  const moved = item('moved', '10', 'one');
  const service = plan('service', [moved]);
  const next = optimisticRailMove(service, plan('worship', []), moved,
    { plan_id: 'worship', parent_item_id: null, after_item_id: null });
  const newer = item('newer', '10', 'two');
  const restored = optimisticRailMove({ ...next.service, items: [...next.service.items, newer] }, next.worship, next.worship!.items[0],
    { plan_id: 'service', parent_item_id: 'one', after_item_id: null });
  expect(restored.service.items.find((entry) => entry.id === newer.id)).toBe(newer);
  expect(restored.service.items.find((entry) => entry.id === moved.id)?.parent_item_id).toBe('one');
  expect(restored.worship?.items).toEqual([]);
});

it('renumbers only destination siblings and rejects stale drop positions', () => {
  const moved = item('moved', '10', 'one');
  const first = item('first', '3', 'two');
  const last = item('last', '3', 'two');
  const unrelated = item('unrelated', '55', 'elsewhere');
  const service = plan('service', [moved, first, last, unrelated]);
  const next = optimisticRailMove(service, null, moved, { plan_id: 'service', parent_item_id: 'two', after_item_id: 'first' });
  expect(next.service.items.find((entry) => entry.id === 'last')?.sequence).toBe('30.00');
  expect(next.service.items.find((entry) => entry.id === unrelated.id)).toBe(unrelated);
  expect(() => optimisticRailMove(service, null, moved, { plan_id: 'service', parent_item_id: 'two', after_item_id: unrelated.id })).toThrow('drop position');
});
