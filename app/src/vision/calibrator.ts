import type { Calibration, CalibrationFloor, PoseFrame } from "../types.ts";
import { measureBody, StabilityWindow } from "./geometry.ts";

export type CalibrationStep = "floor" | "box" | "done";

const STABLE_MS = 1500;
const MIN_BOX_TORSO = 0.7;
const MAX_BOX_TORSO = 1.6;
const MIN_ELEVATED_TORSO = 0.1;
const MAX_FOOT_MISMATCH_TORSO = 0.3;
const MAX_SCALE_CHANGE = 0.1;
const SEQUENCE_ELEVATION_TORSO = 0.3;
const MIN_SEQUENCE_MS = 150;
const POSITION_TOLERANCE = 0.2;
const TORSO_TOLERANCE = 0.25;

const INSTRUCTION = {
  floor: "Stand next to the box",
  box: "Step up and stand on the box",
  done: "Box detected",
  lost: "Step into view",
  implausible: "That did not look right. Stand next to the box and try again",
  oneAtATime: "Step onto the box one foot at a time. Stand next to the box and try again",
  distance: "Stay at the same distance from the camera. Stand next to the box and try again",
} as const;

export class BoxCalibrator {
  private currentStep: CalibrationStep = "floor";
  private currentInstruction: string = INSTRUCTION.floor;
  private currentProgress = 0;
  private floor: CalibrationFloor | null = null;
  private calibration: Calibration | null = null;
  private rejection: string | null = null;
  private up: { l: number | null; r: number | null } = { l: null, r: null };
  private readonly window = new StabilityWindow();

  get step(): CalibrationStep {
    return this.currentStep;
  }

  get instruction(): string {
    return this.currentInstruction;
  }

  get progress(): number {
    return this.currentProgress;
  }

  result(): Calibration | null {
    return this.calibration;
  }

  push(frame: PoseFrame): void {
    if (this.currentStep === "done") return;
    const m = measureBody(frame);
    if (!m) {
      this.window.reset();
      this.currentProgress = 0;
      this.currentInstruction = INSTRUCTION.lost;
      return;
    }
    const tolerance = [m.torso * POSITION_TOLERANCE, m.torso * POSITION_TOLERANCE, m.torso * POSITION_TOLERANCE, m.torso * TORSO_TOLERANCE];
    const prompt = this.currentStep === "floor" ? INSTRUCTION.floor : INSTRUCTION.box;
    this.currentInstruction = this.rejection ?? prompt;

    if (this.currentStep === "box" && this.floor) {
      this.trackRise(m.t, m.lAnkleY, m.rAnkleY, this.floor);
      const lRise = (this.floor.lAnkleY - m.lAnkleY) / this.floor.torso;
      const rRise = (this.floor.rAnkleY - m.rAnkleY) / this.floor.torso;
      const elevated = Math.min(lRise, rRise) > MIN_ELEVATED_TORSO;
      const bothFeet = Math.abs(lRise - rRise) < MAX_FOOT_MISMATCH_TORSO;
      if (!elevated || !bothFeet) {
        this.window.reset();
        this.currentProgress = 0;
        return;
      }
    }

    this.window.push(m.t, [m.lAnkleY, m.rAnkleY, m.hipY, m.torso], tolerance);
    this.currentProgress = Math.min(1, this.window.spanMs / STABLE_MS);
    if (this.window.spanMs >= 300) this.rejection = null;
    if (this.window.spanMs < STABLE_MS) return;

    if (this.currentStep === "floor") this.finishFloor();
    else this.finishBox();
  }

  private trackRise(t: number, lAnkleY: number, rAnkleY: number, floor: CalibrationFloor): void {
    const elevations = { l: (floor.lAnkleY - lAnkleY) / floor.torso, r: (floor.rAnkleY - rAnkleY) / floor.torso };
    for (const side of ["l", "r"] as const) {
      if (elevations[side] > SEQUENCE_ELEVATION_TORSO) this.up[side] ??= t;
      else if (elevations[side] < MIN_ELEVATED_TORSO) this.up[side] = null;
    }
  }

  private finishFloor(): void {
    this.floor = {
      lAnkleY: this.window.mean(0),
      rAnkleY: this.window.mean(1),
      hipY: this.window.mean(2),
      torso: this.window.mean(3),
    };
    this.window.reset();
    this.up = { l: null, r: null };
    this.currentStep = "box";
    this.currentProgress = 0;
    this.currentInstruction = INSTRUCTION.box;
  }

  private finishBox(): void {
    const floor = this.floor as CalibrationFloor;
    const torso = this.window.mean(3);
    const rise = ((floor.lAnkleY - this.window.mean(0)) + (floor.rAnkleY - this.window.mean(1))) / 2 / floor.torso;
    const scale = torso / floor.torso;
    this.window.reset();
    this.currentProgress = 0;

    const sequenced = this.up.l !== null && this.up.r !== null && Math.abs(this.up.l - this.up.r) >= MIN_SEQUENCE_MS;
    const implausible = rise < MIN_BOX_TORSO || rise > MAX_BOX_TORSO;
    const moved = Math.abs(scale - 1) > MAX_SCALE_CHANGE;
    if (implausible || moved || !sequenced) {
      this.rejection = moved ? INSTRUCTION.distance : !sequenced ? INSTRUCTION.oneAtATime : INSTRUCTION.implausible;
      this.currentInstruction = this.rejection;
      this.currentStep = "floor";
      this.floor = null;
      return;
    }
    this.calibration = { boxHeightTorso: rise, floor };
    this.currentStep = "done";
    this.currentProgress = 1;
    this.currentInstruction = INSTRUCTION.done;
  }
}
