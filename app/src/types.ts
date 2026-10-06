export const TOTAL_REPS = 1000;
export const DEFAULT_BOX_HEIGHT_IN = 20;

export interface WorkoutPlan {
  targetTimeSec: number;
  setSize: number;
  setsPerRevolution: number;
  boxHeightIn: number;
}

export function repsPerRevolution(plan: WorkoutPlan): number {
  return plan.setSize * plan.setsPerRevolution;
}

export interface RepEvent {
  /** ms since workout start */
  t: number;
  cumulativeRep: number;
  confidence: number;
}

export interface SetEvent {
  t: number;
  setNumber: number;
  cumulativeRep: number;
}

export interface RevolutionEvent {
  t: number;
  revolutionNumber: number;
  cumulativeRep: number;
}

export interface WorkoutRecord {
  id: string;
  /** ISO timestamp of workout start */
  date: string;
  plan: WorkoutPlan;
  /** null when abandoned before 1000 */
  actualTimeSec: number | null;
  totalReps: number;
  countingMode: CountingMode;
  reps: RepEvent[];
  sets: SetEvent[];
  revolutions: RevolutionEvent[];
}

export type CountingMode = "camera" | "manual";

export type AudioMode = "off" | "reps" | "pace" | "full";

export interface Settings {
  audioMode: AudioMode;
  /** seconds; below this, no pace announcement */
  paceQuietThresholdSec: number;
  paceOccasionalThresholdSec: number;
  paceProminentThresholdSec: number;
  paceCorrectionThresholdSec: number;
  /** minimum confidence for a camera rep to count */
  repConfidenceThreshold: number;
  rollingWindowSec: number;
}

export const DEFAULT_SETTINGS: Settings = {
  audioMode: "full",
  paceQuietThresholdSec: 15,
  paceOccasionalThresholdSec: 15,
  paceProminentThresholdSec: 30,
  paceCorrectionThresholdSec: 60,
  repConfidenceThreshold: 0.8,
  rollingWindowSec: 180,
};

export interface PaceSnapshot {
  elapsedSec: number;
  reps: number;
  remainingReps: number;
  targetRepsPerSec: number;
  expectedReps: number;
  /** positive = ahead of target, seconds */
  aheadSec: number;
  /** reps per minute needed to hit the target from now; null if target time passed */
  requiredRpm: number | null;
  /** false when the required pace is null or far beyond the current pace */
  requiredRealistic: boolean;
  overallRpm: number;
  rollingRpm: number;
  /** projected finish using rolling pace (falls back to overall); null if not computable */
  projectedFinishSec: number | null;
  revolution: number;
  totalRevolutions: number;
  repsIntoRevolution: number;
  repsPerRevolution: number;
  setInRevolution: number;
  repsIntoSet: number;
  revolutionElapsedSec: number;
  targetRevolutionSec: number;
}

export interface RevolutionSplit {
  revolutionNumber: number;
  durationSec: number;
  targetSec: number;
  /** positive = faster than target */
  deltaSec: number;
}

/** Normalized image coordinates (0..1, y grows downward), as produced by MediaPipe Pose. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** 33 BlazePose landmarks, or null when no person was detected in the frame. */
export interface PoseFrame {
  /** ms, monotonic */
  t: number;
  landmarks: Landmark[] | null;
  /** mean luma 0..255 of the frame, if measured */
  brightness?: number;
}

export interface RepCandidate {
  t: number;
  confidence: number;
  accepted: boolean;
  reason?: string;
}

export interface CalibrationFloor {
  /** normalized image y of each ankle, and of the hip midpoint, while standing on the floor */
  lAnkleY: number;
  rAnkleY: number;
  hipY: number;
  /** shoulder-midpoint to hip-midpoint distance in normalized image units */
  torso: number;
}

export interface Calibration {
  /** vertical ankle rise when standing on the box, in torso-length units */
  boxHeightTorso: number;
  /** floor pose at calibration time; lets the detector count from the very first rep */
  floor?: CalibrationFloor;
}

export type SetupCheckId = "person" | "fullBody" | "feet" | "light" | "box";

export interface SetupCheck {
  id: SetupCheckId;
  ok: boolean;
  label: string;
  hint?: string;
}
