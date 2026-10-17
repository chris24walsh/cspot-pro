import { describe, expect, it } from 'vitest';
import { fromWire, physicalHeadamp, toWire, type MixerParameter } from './xr18';
const spec: MixerParameter = {
  path: '/test',
  label: 'Test',
  group: 'Test',
  kind: 'float',
  min: -90,
  max: 10,
  unit: 'dB',
  scale: 'fader',
  options: null
};
describe('XR18 physical-unit conversion', () => {
  it('matches the X AIR fader breakpoints', () => {
    for (const [wire, db] of [[0, -90], [.0625, -60], [.25, -30], [.5, -10], [.75, 0], [1, 10]]) {
      expect(fromWire(spec, wire)).toBeCloseTo(db);
      expect(toWire(spec, db)).toBeCloseTo(wire);
    }
  });
  it('roundtrips frequency, Q, pan and gain', () => {
    for (const item of [{
      ...spec,
      min: 20,
      max: 20000,
      scale: 'log'
    }, {
      ...spec,
      min: .3,
      max: 10,
      scale: 'reverse-log'
    }, {
      ...spec,
      min: -100,
      max: 100,
      scale: 'linear'
    }]) {
      for (const wire of [0, .1, .5, .9, 1]) expect(toWire(item, fromWire(item, wire))).toBeCloseTo(wire);
    }
  });
});

it('selects the physical preamp assigned to a channel, including repatched inputs', () => {
  expect(physicalHeadamp({'/ch/01/config/insrc':6}, '/ch/01')).toBe('/headamp/07');
  expect(physicalHeadamp({'/ch/01/config/insrc':16}, '/ch/01')).toBeNull();
  expect(physicalHeadamp({}, '/ch/01')).toBeNull();
});
