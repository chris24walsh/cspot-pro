// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { isEditableKeyboardTarget, slideKeyboardDirection } from "./keyboardNavigation";

describe("slide keyboard navigation", () => {
  it("maps expected forward and backward keys", () => {
    expect(slideKeyboardDirection(new KeyboardEvent("keydown", { key: "ArrowRight" }))).toBe(1);
    expect(slideKeyboardDirection(new KeyboardEvent("keydown", { key: "ArrowDown" }))).toBe(1);
    expect(slideKeyboardDirection(new KeyboardEvent("keydown", { key: " " }))).toBe(1);
    expect(slideKeyboardDirection(new KeyboardEvent("keydown", { key: "ArrowLeft" }))).toBe(-1);
    expect(slideKeyboardDirection(new KeyboardEvent("keydown", { key: "ArrowUp" }))).toBe(-1);
    expect(slideKeyboardDirection(new KeyboardEvent("keydown", { key: "Backspace" }))).toBe(-1);
  });

  it("ignores unrelated keys", () => {
    expect(slideKeyboardDirection(new KeyboardEvent("keydown", { key: "s" }))).toBeNull();
  });

  it("keeps hidden slide key capture eligible for navigation", () => {
    const input = document.createElement("input");
    input.dataset.slideKeyCapture = "true";

    expect(isEditableKeyboardTarget(input)).toBe(false);
    expect(isEditableKeyboardTarget(document.createElement("textarea"))).toBe(true);
  });
});
