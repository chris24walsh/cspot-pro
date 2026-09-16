import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PresentationSlide } from "../presentation";
import { overlayFontScale, SlideOverlay } from "./SlideOverlay";

const slide = {
  id: "welcome-seated",
  planItemId: "welcome-seated",
  sectionId: "welcome",
  sectionTitle: "Pre-service",
  title: "Please be seated",
  text: "",
  itemType: "welcome_seated",
  sequence: "3",
  montageImageUrls: ["background.jpg"],
  preServiceTimed: true,
  overlayMode: "static",
  overlayText: "Please be seated",
} satisfies PresentationSlide;

describe("slide overlays", () => {
  it("does not repeat the built-in pre-service message on live outputs", () => {
    expect(renderToStaticMarkup(createElement(SlideOverlay, { slide }))).toBe("");
    expect(renderToStaticMarkup(createElement(SlideOverlay, { slide, running: false }))).toContain("Please be seated");
  });

  it("uses a bounded, precise font scale for ordinary overlays", () => {
    expect(overlayFontScale(75)).toBe(0.75);
    expect(overlayFontScale(250)).toBe(2);
    expect(overlayFontScale(-10)).toBe(0.25);
    expect(overlayFontScale()).toBe(1);
    const markup = renderToStaticMarkup(createElement(SlideOverlay, {
      slide: { ...slide, preServiceTimed: false, overlayFontScale: 75 },
    }));
    expect(markup).toContain("--overlay-font-scale:0.75");
  });
});
