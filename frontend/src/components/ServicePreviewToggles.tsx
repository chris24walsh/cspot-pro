import type { ComponentProps } from "react";
import { EyeOff, Mic, Volume2 } from "lucide-react";
import { PointerToggle } from "./PointerToggle";
import { ServiceCameraControl } from "./ServiceCameraControl";

export function ServicePreviewToggles({ teacherOnly, canContributeCamera, production, pointer }: {
  teacherOnly: boolean;
  canContributeCamera: boolean;
  production: {
    audioEnabled: boolean; onAudioChange: (enabled: boolean) => void;
    recordingEnabled: boolean; onRecordingChange: (enabled: boolean) => void;
    blanked: boolean; onBlankChange: (blanked: boolean) => void;
  };
  pointer: ComponentProps<typeof PointerToggle>;
}) {
  return <>
    {!teacherOnly && <>
      <label className="stage-audio-switch stage-toggle-switch" title="Enable YouTube audio buttons">
        <span className="stage-toggle-label" data-short="A"><Volume2 size={13} aria-hidden="true" />Audio</span>
        <input
          aria-label="Enable YouTube audio buttons"
          checked={production.audioEnabled}
          onChange={(event) => production.onAudioChange(event.target.checked)}
          type="checkbox"
        />
        <span className="stage-theme-slider" aria-hidden="true" />
      </label>
      <label className="stage-recording-switch stage-toggle-switch" title="Show sermon recording controls">
        <span className="stage-toggle-label" data-short="R"><Mic size={13} aria-hidden="true" />Recording</span>
        <input
          aria-label="Show sermon recording controls"
          checked={production.recordingEnabled}
          onChange={(event) => production.onRecordingChange(event.target.checked)}
          type="checkbox"
        />
        <span className="stage-theme-slider" aria-hidden="true" />
      </label>
      <label className="stage-blank-switch stage-toggle-switch" title="Blank live output">
        <span className="stage-toggle-label" data-short="B"><EyeOff size={13} aria-hidden="true" />Blank</span>
        <input
          aria-label="Blank live output"
          checked={production.blanked}
          onChange={(event) => production.onBlankChange(event.target.checked)}
          type="checkbox"
        />
        <span aria-hidden="true">B</span>
      </label>
    </>}
    <PointerToggle {...pointer} />
    {canContributeCamera && <ServiceCameraControl />}
  </>;
}
