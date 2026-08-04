type PresentationDeviceNavigator = Pick<Navigator, "maxTouchPoints" | "userAgent">;

export function isMobileOrTabletDevice(device: PresentationDeviceNavigator = window.navigator): boolean {
  const userAgent = device.userAgent;
  return (
    /Android|iPad|iPhone|iPod|Mobile|Tablet/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && device.maxTouchPoints > 1)
  );
}
