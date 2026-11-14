// Collapse only adjacent occurrences of the same section and content. Playback
// keeps its original occurrence indexes, including every page of every repeat.
export function repeatedSectionGroups<T extends { label: string; content: string }>(blocks: T[]) {
  const groups: Array<{ block: T; occurrences: number[] }> = [];
  blocks.forEach((block, occurrence) => {
    const previous = groups[groups.length - 1];
    if (previous?.block.label === block.label && previous.block.content === block.content) previous.occurrences.push(occurrence);
    else groups.push({ block, occurrences: [occurrence] });
  });
  return groups;
}
