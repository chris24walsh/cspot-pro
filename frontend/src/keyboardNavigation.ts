export type SlideKeyboardDirection = -1 | 1;

export function isEditableKeyboardTarget(target: EventTarget | null) {
  if (target instanceof HTMLElement && target.dataset.slideKeyCapture === "true") {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function slideKeyboardDirection(event: KeyboardEvent): SlideKeyboardDirection | null {
  const key = event.key.toLowerCase();
  const code = event.code.toLowerCase();
  const legacyCode = event.keyCode || event.which;

  if (
    key === "arrowright" ||
    key === "arrowdown" ||
    key === "pagedown" ||
    key === " " ||
    key === "spacebar" ||
    key === "enter" ||
    key === "mediatracknext" ||
    key === "audiovolumedown" ||
    code === "arrowright" ||
    code === "arrowdown" ||
    code === "pagedown" ||
    code === "space" ||
    code === "enter" ||
    code === "numpadenter" ||
    code === "mediatracknext" ||
    code === "audiovolumedown" ||
    legacyCode === 13 ||
    legacyCode === 32 ||
    legacyCode === 34 ||
    legacyCode === 39 ||
    legacyCode === 40
  ) {
    return 1;
  }

  if (
    key === "arrowleft" ||
    key === "arrowup" ||
    key === "pageup" ||
    key === "backspace" ||
    key === "mediatrackprevious" ||
    key === "audiovolumeup" ||
    code === "arrowleft" ||
    code === "arrowup" ||
    code === "pageup" ||
    code === "backspace" ||
    code === "mediatrackprevious" ||
    code === "audiovolumeup" ||
    legacyCode === 8 ||
    legacyCode === 33 ||
    legacyCode === 37 ||
    legacyCode === 38
  ) {
    return -1;
  }

  return null;
}
