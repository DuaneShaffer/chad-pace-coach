import type { Calibration, CountingMode, WorkoutPlan } from "../types";
import { loadSavedPlan } from "../platform/settings";
import type { PoseEngine } from "../vision/poseEngine";

export interface CameraSession {
  video: HTMLVideoElement;
  stream: MediaStream;
  engine: PoseEngine;
  calibration: Calibration | null;
  facing: "user" | "environment";
}

const saved = loadSavedPlan();

export const app: { plan: WorkoutPlan; mode: CountingMode; camera: CameraSession | null } = {
  plan: saved.plan,
  mode: saved.mode,
  camera: null,
};
