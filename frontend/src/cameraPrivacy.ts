import { appAssetUrl } from "./paths";

export const cameraOffImage = () => appAssetUrl("images/camera-off.svg");

/** Publish a real placeholder picture without opening the device camera. */
export async function createCameraPlaceholder() {
  const canvas = document.createElement("canvas");
  canvas.width = 1280; canvas.height = 720;
  const context = canvas.getContext("2d");
  if (!context || !canvas.captureStream) throw new Error("This browser cannot send a camera-off picture. Try Safari or Chrome.");
  const image = new Image(); image.src = cameraOffImage();
  await image.decode();
  const draw = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
  draw();
  // Negotiate the same cadence as live capture, so downstream encoders do not
  // lock onto a 1 fps placeholder when the device camera is turned on later.
  const stream = canvas.captureStream(24);
  const timer = setInterval(draw, 1000 / 24);
  return { track: stream.getVideoTracks()[0], stop: () => { clearInterval(timer); stream.getTracks().forEach(track => track.stop()); } };
}

export function supportsNativeBlur(track?: MediaStreamTrack) {
  const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { backgroundBlur?: boolean[] }) | undefined;
  return Boolean(capabilities?.backgroundBlur?.includes(true));
}

export async function setNativeBlur(track: MediaStreamTrack, enabled: boolean) {
  await track.applyConstraints({ ...track.getConstraints(), backgroundBlur: { exact: enabled } } as MediaTrackConstraints);
}
