import { describe, expect, it } from "vitest";
import { SCHOOL_STORIES, storyFrame, storyLength } from "./sundaySchoolStories";

describe("reusable story frames", () => {
  const story = SCHOOL_STORIES.jonah;
  it("restores a previous scene and layer positions independently of navigation history", () => {
    const before = JSON.stringify(story);
    const harbour = storyFrame(story, 5);
    storyFrame(story, 15);
    expect(storyFrame(story, 5)).toEqual(harbour);
    expect(harbour.scene.background).toBe("harbour");
    expect(harbour.layers.find(layer => layer.id === "jonah")?.x).toBe(61);
    expect(JSON.stringify(story)).toBe(before);
  });
  it("keeps sound events attached to cues and clamps invalid positions", () => {
    expect(storyFrame(story, 9).sound).toBe("thunder");
    expect(storyFrame(story, 8).sound).toBe("waves");
    expect(storyFrame(story, 12).sound).toBe("splash");
    expect(storyFrame(story, 999)).toEqual(storyFrame(story, storyLength(story)-1));
    expect(storyFrame(story, -1)).toEqual(storyFrame(story, 0));
  });
  it("can restore Jonah after undoing the fish swallowing him", () => {
    expect(storyFrame(story, 14).layers.find(layer => layer.id === "jonah")?.visible).toBe(false);
    expect(storyFrame(story, 13).layers.find(layer => layer.id === "jonah")?.visible).toBe(true);
  });
});
