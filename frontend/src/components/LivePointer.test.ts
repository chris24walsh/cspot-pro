import { describe, expect, it } from "vitest";
import { pointerPosition } from "./LivePointer";

describe("live pointer coordinates", () => {
  it("maps preview positions to the same relative position on any output size", () => {
    expect(pointerPosition(250, 125, { left: 50, top: 25, width: 400, height: 200 })).toEqual({ x: 0.5, y: 0.5 });
    expect(pointerPosition(1000, 500, { left: 0, top: 0, width: 2000, height: 1000 })).toEqual({ x: 0.5, y: 0.5 });
  });
  it("keeps the pointer within the slide and handles an unmeasured stage", () => {
    expect(pointerPosition(-10, 300, { left: 0, top: 0, width: 100, height: 100 })).toEqual({ x: 0, y: 1 });
    expect(pointerPosition(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});
