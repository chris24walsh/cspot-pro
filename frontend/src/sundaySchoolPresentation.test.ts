import { describe, expect, it } from "vitest";
import { combineVerseItems, verseWords, versePhase } from "./sundaySchoolPresentation";

describe("combined memory verse", () => {
  for (const text of ["Rejoice!", "God is love; God is love.\nTrust Him!", Array(100).fill("Give thanks.").join(" ")]) {
    it(`preserves text and progresses both directions for ${text.length} characters`, () => {
      const stages = Array.from({length: 14}, (_, step) => verseWords(text, step));
      stages.forEach((tokens) => expect(tokens.map(t => t.text).join("")).toBe(text));
      const hidden = stages.map(tokens => tokens.filter(t => t.hidden).length);
      expect(hidden[0]).toBe(stages[0].filter(t => t.word).length);
      expect(hidden[5]).toBe(0);
      expect(hidden[7]).toBe(0);
      expect(hidden[12]).toBe(hidden[0]);
      expect(hidden.slice(0, 7)).toEqual([...hidden.slice(0, 7)].sort((a, b) => b-a));
      expect(hidden.slice(7)).toEqual([...hidden.slice(7)].sort((a, b) => a-b));
      expect(versePhase(6).mode).toBe("recall");
      expect(versePhase(7).mode).toBe("learn");
    });
  }
  it("combines existing verse items without losing either verse", () => {
    const items = combineVerseItems([
      {id:"a",kind:"content",title:"Recall",element_type:"challenge",detail:"Last week",reference:"A"},
      {id:"b",kind:"content",title:"Learn",element_type:"verse",detail:"This week",reference:"B"},
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].verse_game?.last_week.text).toBe("Last week");
    expect(items[0].verse_game?.this_week.reference).toBe("B");
  });
});
