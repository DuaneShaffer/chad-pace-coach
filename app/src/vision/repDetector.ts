import type { Calibration, PoseFrame, RepCandidate } from "../types.ts";
import { AnkleCounter } from "./ankleCounter.ts";
import { measureTorso } from "./geometry.ts";
import { BLIND_SHARE_MIN, HipCounter } from "./hipCounter.ts";

const HIPS_MODE_AFTER_MS = 1000;
const LOST_MS = 500;

export class RepDetector {
  private readonly ankle: AnkleCounter;
  private readonly hip: HipCounter;
  private blindSince: number | null = null;
  private lastTorsoT: number | null = null;
  private firstFrameT: number | null = null;
  private lastAnkleRepT = -Infinity;
  private now = 0;

  constructor(calibration: Calibration | null, opts?: { confidenceThreshold?: number }) {
    this.ankle = new AnkleCounter(calibration, opts);
    this.hip = new HipCounter(calibration?.boxHeightTorso ?? null, calibration?.floor ?? null, opts?.confidenceThreshold ?? 0.8);
  }

  private get hipsMode(): boolean {
    return this.blindSince !== null && this.now - this.blindSince >= HIPS_MODE_AFTER_MS;
  }

  private get lost(): boolean {
    const since = this.lastTorsoT ?? this.firstFrameT;
    return since !== null && this.now - since > LOST_MS;
  }

  get phase(): string {
    if (this.lost) return "lost";
    return this.hipsMode ? this.hip.phase : this.ankle.phase;
  }

  get diagnostic(): string {
    if (this.lost) return "Lost you";
    if (this.hipsMode) {
      return this.hip.learning ? "Learning your step… (feet not visible)" : "Counting by hips (feet not visible)";
    }
    const text = this.ankle.diagnostic;
    return text === "Lost you" ? "" : text;
  }

  get suggestedFps(): number {
    return this.hipsMode ? this.hip.suggestedFps : this.ankle.suggestedFps;
  }

  setContext(ctx: { repsIntoSet: number; setSize: number; reps?: number }): void {
    this.ankle.setContext(ctx);
    this.hip.setContext((ctx.repsIntoSet === 0 && (ctx.reps ?? 0) > 0) || ctx.repsIntoSet >= ctx.setSize - 1);
  }

  push(frame: PoseFrame): RepCandidate | null {
    return this.pushAll(frame)[0] ?? null;
  }

  pushAll(frame: PoseFrame): RepCandidate[] {
    this.now = frame.t;
    this.firstFrameT ??= frame.t;
    const torso = measureTorso(frame);
    this.ankle.quickResume = torso !== null && this.hip.phase !== "repositioning" && this.hip.phase !== "lost";
    const out = this.ankle.pushAll(frame);
    for (const c of out) if (c.accepted) this.lastAnkleRepT = Math.max(this.lastAnkleRepT, c.t);

    if (!torso) {
      this.hip.onMissing(frame.t);
      return out;
    }
    this.lastTorsoT = frame.t;
    if (torso.ankles) this.blindSince = null;
    else this.blindSince ??= frame.t;

    const stepFromAnkles = this.ankle.lockedStep;
    if (stepFromAnkles !== null && this.hip.learning) this.hip.setStepHeight(stepFromAnkles);

    for (const h of this.hip.push(torso)) {
      if (h.blindShare >= BLIND_SHARE_MIN && this.lastAnkleRepT < h.startT) out.push(h.candidate);
    }
    return out.sort((a, b) => a.t - b.t);
  }
}
