/** Fit usable touch strips plus a pinned main fader into the available desk width. */
export function mixerBankSize(width: number): number {
  return [16, 8, 4, 2].find(size => size * 88 + (size - 1) * 4 + 96 + 24 <= width) ?? 2;
}
