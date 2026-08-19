type PresentationDeviceNavigator = Pick<Navigator, "maxTouchPoints" | "userAgent">;
type PresentationDeviceScreen = Pick<Screen, "height" | "width">;

export function isMobileOrTabletDevice(device: PresentationDeviceNavigator = window.navigator): boolean {
  const userAgent = device.userAgent;
  return (
    /Android|iPad|iPhone|iPod|Mobile|Tablet/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && device.maxTouchPoints > 1)
  );
}

export function isTabletDevice(
  device: PresentationDeviceNavigator = window.navigator,
  screen: PresentationDeviceScreen = window.screen,
): boolean {
  return isMobileOrTabletDevice(device) && Math.min(screen.width, screen.height) >= 600;
}
