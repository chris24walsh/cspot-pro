import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ScaledSlideImage } from "./ScaledSlideImage";

describe("ScaledSlideImage", () => {
  it("loads selected preview and live images eagerly", () => {
    const markup = renderToStaticMarkup(createElement(ScaledSlideImage, {
      alt: "Announcements",
      src: "/api/v1/library/files/image-1/download",
    }));

    expect(markup).toContain('src="/api/v1/library/files/image-1/download"');
    expect(markup).not.toContain('loading="lazy"');
  });
});
