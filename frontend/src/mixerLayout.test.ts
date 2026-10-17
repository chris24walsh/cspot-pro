import { expect, it } from 'vitest';
import { mixerBankSize } from './mixerLayout';
it('fits channel banks plus a pinned main strip on phones, portrait and landscape tablets, and desktops', () => {
  for (const [width,size] of [[320,2],[390,2],[600,4],[768,4],[900,8],[1024,8],[1366,8],[1540,8],[1600,16]]) {
    expect(mixerBankSize(width)).toBe(size);
    expect(size*88 + (size-1)*4 + 96 + 24).toBeLessThanOrEqual(width);
  }
});
