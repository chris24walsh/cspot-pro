import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ServicePreviewToggles } from "./ServicePreviewToggles";

function markup(teacherOnly: boolean, canContributeCamera = true) {
  const change = () => {};
  return renderToStaticMarkup(<ServicePreviewToggles teacherOnly={teacherOnly} canContributeCamera={canContributeCamera}
    production={{ audioEnabled: false, onAudioChange: change, recordingEnabled: false, onRecordingChange: change, blanked: false, onBlankChange: change }}
    pointer={{ enabled: false, onChange: change, markerStyle: { color: "#ffe000", thickness: 36 }, onStyleChange: change }} />);
}
it("shows teachers only pointer and camera/mic toggles on the preview", () => {
  const html = markup(true);
  expect(html).toContain('aria-label="Enable live pointer"');
  expect(html).toContain('aria-label="Enable camera and microphone"');
  expect(html.match(/type="checkbox"/g)).toHaveLength(2);
  expect(html).not.toContain('aria-label="Enable YouTube audio buttons"');
  expect(html).not.toContain('aria-label="Show sermon recording controls"');
  expect(html).not.toContain('aria-label="Blank live output"');
});
it("retains production toggles for operators", () => {
  const html = markup(false);
  expect(html).toContain('aria-label="Enable YouTube audio buttons"');
  expect(html).toContain('aria-label="Show sermon recording controls"');
  expect(html).toContain('aria-label="Blank live output"');
  expect(html).toContain('aria-label="Enable live pointer"');
});
it("does not expose camera capture without contribution permission", () => {
  expect(markup(false, false)).not.toContain('aria-label="Enable camera and microphone"');
});
