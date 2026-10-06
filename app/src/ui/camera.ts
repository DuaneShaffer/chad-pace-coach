import { openCamera, stopCamera } from "../vision/poseEngine";
import { app } from "./appState";
import type { CameraSession } from "./appState";

type Facing = CameraSession["facing"];

export function openCameraFacing(video: HTMLVideoElement, facing: Facing): Promise<MediaStream> {
  return openCamera(video, facing);
}

export function closeCamera(): void {
  const cam = app.camera;
  if (!cam) return;
  cam.engine.close();
  stopCamera(cam.stream);
  cam.video.srcObject = null;
  app.camera = null;
}

export function cameraErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") return "Camera permission was denied. Allow camera access in your browser settings, then try again.";
    if (err.name === "NotFoundError") return "No camera was found on this device.";
    if (err.name === "NotReadableError") return "The camera is in use by another app.";
  }
  return err instanceof Error ? err.message : "The camera could not be started.";
}
