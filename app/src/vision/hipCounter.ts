import type { CalibrationFloor, RepCandidate } from "../types.ts";
import { clamp, median, Smoother, StabilityWindow, Sustain } from "./geometry.ts";
import type { TorsoMeasure } from "./geometry.ts";

export interface HipCandidate {
  candidate: RepCandidate;
  startT: number;
  blindShare: number;
}

type Phase = "floor" | "rising" | "onBox" | "descending" | "repositioning" | "lost";

const LOST_MS = 500;
const SETTLE_MS = 550;
const IDLE_MS = 2000;
const RISE_HOLD_MS = 120;
const UP_HOLD_MS = 150;
const DOWN_HOLD_MS = 120;
const BACK_UP_HOLD_MS = 200;
const MIN_CYCLE_MS = 1200;
const MAX_CYCLE_MS = 8000;
const MAX_STALL_MS = 12000;
const MAX_UNARMED_MS = 5000;
const MIN_UP_MS = 300;
const MIN_RISE_MS = 140;

const MIN_UP_TORSO = 0.22;
const UP_SHARE = 0.55;
const START_SHARE = 0.6;
const FLOOR_SHARE = 0.45;
const BACK_DOWN_SHARE = 0.8;
const ORIGIN_TORSO = 0.1;
const PROVISIONAL_RISE = 0.5;
const MIN_LEARNED_RISE = 0.3;
const MAX_LEARNED_RISE = 2.5;
const LEARN_AGREEMENT = 0.25;
const LEARNED_TO_LOCK = 2;
const SQUAT_TORSO = 0.25;
const SQUAT_LOOKBACK_MS = 1500;

const MAX_CYCLE_SCALE = 0.12;
const MAX_PLATEAU_SCALE = 0.08;
const REPOSITION_SCALE = 0.25;
const FLOOR_SCALE = 0.15;
const SCALE_HOLD_MS = 300;
const VELOCITY_WINDOW_MS = 1200;
const MIN_VELOCITY_SPAN_MS = 800;
const REPOSITION_SPEED = 1.0;
const REPOSITION_SPEED_EXPECTED = 0.7;
const JUMP_TORSO = 0.8;
const JUMP_RATIO = 0.5;
const JUMP_FRAMES = 1.5;
const RESUME_SCALE = 0.15;
const BASELINE_TAU_MS = 10000;
const BASELINE_UPDATE_TORSO = 0.08;
const BLIND_SHARE_MIN = 0.5;
const VISIBILITY_ZERO = 0.4;
const VISIBILITY_FULL = 0.7;
const FPS_ACTIVE = 14;
const FPS_SETTLING = 10;
const FPS_IDLE = 8;
const FPS_LOST = 5;

interface Baseline {
  hipY: number;
  torso: number;
}

interface Sample {
  t: number;
  e: number;
}

interface Cycle {
  startT: number;
  armed: boolean;
  samples: Sample[];
  visibilitySum: number;
  frames: number;
  blindFrames: number;
  maxDeviation: number;
  plateauDeviations: number[];
  upMs: number;
  squatBefore: boolean;
  lastT: number;
  maxGapMs: number;
}

interface Learned {
  plateau: number;
  quality: number;
  startT: number;
  t: number;
  blindShare: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function crossing(samples: Sample[], level: number): number {
  const i = samples.findIndex((s) => s.e >= level);
  if (i <= 0) return samples[0]?.t ?? 0;
  const a = samples[i - 1];
  const b = samples[i];
  return a.t + ((level - a.e) / (b.e - a.e)) * (b.t - a.t);
}

export class HipCounter {
  private rise: number;
  private isLearning: boolean;
  private readonly threshold: number;
  private readonly seed: CalibrationFloor | null;
  private seedPending: boolean;
  private currentPhase: Phase = "floor";
  private baseline: Baseline | null = null;
  private cycle: Cycle | null = null;
  private learned: Learned[] = [];
  private lockedT: number | null = null;
  private lastUsableT: number | null = null;
  private lastMeasure: TorsoMeasure | null = null;
  private frameIntervals: number[] = [];
  private lastFrameT: number | null = null;
  private lastGapMs = 0;
  private transitionExpected = false;
  private samples: Sample[] = [];
  private ring: Sample[] = [];
  private history: { t: number; x: number; torso: number }[] = [];

  private readonly hipX = new Smoother();
  private readonly hipY = new Smoother();
  private readonly torso = new Smoother();
  private readonly settle = new StabilityWindow();
  private readonly idleWindow = new StabilityWindow(IDLE_MS + 1000);
  private readonly riseHold = new Sustain();
  private readonly upHold = new Sustain();
  private readonly downHold = new Sustain();
  private readonly backUpHold = new Sustain();
  private readonly scaleHold = new Sustain();

  constructor(calibrationRise: number | null, floor: CalibrationFloor | null, threshold: number) {
    this.isLearning = calibrationRise === null;
    this.rise = calibrationRise ?? PROVISIONAL_RISE;
    this.threshold = threshold;
    this.seed = floor;
    this.seedPending = floor !== null;
  }

  get phase(): string {
    return this.currentPhase;
  }

  get learning(): boolean {
    return this.isLearning;
  }

  get lockedStep(): number | null {
    return this.isLearning ? null : this.rise;
  }

  get lockedAt(): number | null {
    return this.lockedT;
  }

  get suggestedFps(): number {
    if (this.currentPhase === "lost") return FPS_LOST;
    if (this.currentPhase === "repositioning") return FPS_SETTLING;
    if (this.currentPhase === "floor") return this.idleWindow.spanMs >= IDLE_MS ? FPS_IDLE : FPS_ACTIVE;
    return FPS_ACTIVE;
  }

  setContext(transitionExpected: boolean): void {
    this.transitionExpected = transitionExpected;
  }

  setStepHeight(rise: number): void {
    if (!this.isLearning) return;
    this.rise = rise;
    this.isLearning = false;
    this.learned = [];
  }

  private get up(): number {
    return Math.max(UP_SHARE * this.rise, MIN_UP_TORSO);
  }

  onMissing(t: number): void {
    if (this.currentPhase === "lost" || this.lastUsableT === null) return;
    if (t - this.lastUsableT > LOST_MS) this.enterLost();
  }

  push(m: TorsoMeasure): HipCandidate[] {
    this.trackInterval(m.t);
    const gap = this.lastUsableT === null ? 0 : m.t - this.lastUsableT;
    this.lastUsableT = m.t;
    this.lastGapMs = gap;
    if (this.currentPhase !== "lost" && gap > LOST_MS) this.enterLost();
    if (this.currentPhase === "lost") this.enterRepositioning();
    if (this.cycle) this.cycle.maxGapMs = Math.max(this.cycle.maxGapMs, gap);

    if (this.seedPending) this.trySeed(m);
    const jumped = this.isJump(m, gap);
    this.lastMeasure = m;
    if (jumped && this.currentPhase !== "repositioning") this.enterRepositioning();

    const x = this.hipX.push(m.hipX);
    const y = this.hipY.push(m.hipY);
    const torso = this.torso.push(m.torso);
    this.history.push({ t: m.t, x, torso });
    while (this.history.length > 1 && m.t - this.history[0].t > VELOCITY_WINDOW_MS) this.history.shift();
    this.idleWindow.push(m.t, [y, x], [torso * 0.2, torso * 0.3]);
    if (this.currentPhase !== "repositioning" && this.isRepositioning(m.t, x, torso)) this.enterRepositioning();

    if (this.currentPhase === "repositioning") {
      this.updateSettling(m.t, x, y, torso);
      return [];
    }
    const base = this.baseline;
    if (!base) {
      this.settle.push(m.t, [x, y, torso], [torso * 0.2, torso * 0.2, torso * 0.25]);
      if (this.settle.spanMs >= SETTLE_MS) this.baseline = { hipY: this.settle.mean(1), torso: this.settle.mean(2) };
      return [];
    }
    const e = (base.hipY - y) / base.torso;
    const deviation = Math.abs(torso / base.torso - 1);
    this.ring.push({ t: m.t, e });
    while (this.ring.length > 1 && m.t - this.ring[0].t > SQUAT_LOOKBACK_MS) this.ring.shift();

    if (this.cycle) this.accumulate(m, deviation);
    switch (this.currentPhase) {
      case "floor":
        return this.onFloor(m, e, torso);
      case "rising":
        return this.onRising(m.t, e, deviation);
      case "onBox":
        return this.onBox(m.t, e, deviation);
      default:
        return this.onDescending(m.t, e, deviation);
    }
  }

  private accumulate(m: TorsoMeasure, deviation: number): void {
    const c = this.cycle as Cycle;
    c.visibilitySum += m.visibility;
    c.frames += 1;
    if (!m.ankles) c.blindFrames += 1;
    c.maxDeviation = Math.max(c.maxDeviation, deviation);
    if (this.currentPhase === "onBox") c.plateauDeviations.push(deviation);
    c.lastT = m.t;
  }

  private trackInterval(t: number): void {
    if (this.lastFrameT !== null && t > this.lastFrameT) {
      this.frameIntervals.push(t - this.lastFrameT);
      if (this.frameIntervals.length > 15) this.frameIntervals.shift();
    }
    this.lastFrameT = t;
  }

  private setPhase(phase: Phase): void {
    this.currentPhase = phase;
    for (const h of [this.riseHold, this.upHold, this.downHold, this.backUpHold]) h.reset();
    if (phase === "floor") {
      this.history = [];
      this.scaleHold.reset();
      this.samples = [];
    }
  }

  private enterLost(): void {
    this.cycle = null;
    this.setPhase("lost");
  }

  private enterRepositioning(): void {
    this.cycle = null;
    this.history = [];
    this.ring = [];
    this.samples = [];
    this.settle.reset();
    this.idleWindow.reset();
    this.hipX.reset();
    this.hipY.reset();
    this.torso.reset();
    this.lastMeasure = null;
    this.scaleHold.reset();
    this.setPhase("repositioning");
  }

  private forceRebaseline(): void {
    this.cycle = null;
    this.baseline = null;
    this.seedPending = false;
    this.settle.reset();
    this.samples = [];
    this.setPhase("floor");
  }

  private trySeed(m: TorsoMeasure): void {
    this.seedPending = false;
    const seed = this.seed as CalibrationFloor;
    if (Math.abs(m.torso / seed.torso - 1) < RESUME_SCALE) this.baseline = { hipY: seed.hipY, torso: seed.torso };
  }

  private isJump(m: TorsoMeasure, gap: number): boolean {
    const last = this.lastMeasure;
    if (!last || gap > JUMP_FRAMES * median(this.frameIntervals)) return false;
    const travel = Math.hypot(m.hipX - last.hipX, m.hipY - last.hipY) / last.torso;
    const ratio = m.torso / last.torso;
    return travel > JUMP_TORSO || ratio < 1 - JUMP_RATIO || ratio > 1 + JUMP_RATIO;
  }

  private isRepositioning(t: number, x: number, torso: number): boolean {
    const deviation = this.baseline ? Math.abs(torso / this.baseline.torso - 1) : 0;
    if (this.currentPhase !== "floor") return this.scaleHold.held(deviation > REPOSITION_SCALE, t, SCALE_HOLD_MS);
    const first = this.history[0];
    const span = t - first.t;
    if (span >= MIN_VELOCITY_SPAN_MS) {
      const reference = this.baseline?.torso ?? torso;
      const speed = Math.abs(x - first.x) / reference / (span / 1000);
      if (speed > (this.transitionExpected ? REPOSITION_SPEED_EXPECTED : REPOSITION_SPEED)) return true;
      const rate = Math.abs(torso / first.torso - 1) / (span / 1000);
      if (this.baseline && rate > 0.12 && deviation > 0.08) return true;
    }
    return this.scaleHold.held(deviation > FLOOR_SCALE, t, SCALE_HOLD_MS);
  }

  private updateSettling(t: number, x: number, y: number, torso: number): void {
    this.settle.push(t, [x, y, torso], [torso * 0.2, torso * 0.2, torso * 0.25]);
    if (this.settle.spanMs < SETTLE_MS) return;
    const settled: Baseline = { hipY: this.settle.mean(1), torso: this.settle.mean(2) };
    this.history = [];
    this.scaleHold.reset();
    const previous = this.baseline ?? (this.seed ? { hipY: this.seed.hipY, torso: this.seed.torso } : null);
    if (previous && Math.abs(settled.torso / previous.torso - 1) < RESUME_SCALE) {
      const e = (previous.hipY - settled.hipY) / previous.torso;
      if (e > this.up) {
        this.baseline = previous;
        this.cycle = this.newCycle(t, false, 0);
        this.setPhase("onBox");
        return;
      }
    }
    this.baseline = settled;
    this.setPhase("floor");
  }

  private newCycle(startT: number, armed: boolean, squatMin: number): Cycle {
    return {
      startT,
      armed,
      samples: [...this.samples],
      visibilitySum: 0,
      frames: 0,
      blindFrames: 0,
      maxDeviation: 0,
      plateauDeviations: [],
      upMs: 0,
      squatBefore: squatMin < -SQUAT_TORSO,
      lastT: startT,
      maxGapMs: 0,
    };
  }

  private onFloor(m: TorsoMeasure, e: number, torso: number): HipCandidate[] {
    if (e < ORIGIN_TORSO) this.samples = [{ t: m.t, e }];
    else this.samples.push({ t: m.t, e });
    if (Math.abs(e) < BASELINE_UPDATE_TORSO && this.baseline) {
      const alpha = 1 - Math.exp(-clamp(this.lastGapMs, 0, 200) / BASELINE_TAU_MS);
      this.baseline.torso += alpha * (torso - this.baseline.torso);
    }
    const start = START_SHARE * this.up;
    if (this.riseHold.held(e > start, m.t, RISE_HOLD_MS)) {
      const squatMin = Math.min(...this.ring.filter((s) => s.t < (this.samples[0]?.t ?? m.t)).map((s) => s.e), 0);
      this.cycle = this.newCycle(this.samples[0]?.t ?? m.t, true, squatMin);
      this.setPhase("rising");
      return this.onRising(m.t, e, 0);
    }
    return [];
  }

  private onRising(t: number, e: number, deviation: number): HipCandidate[] {
    const cycle = this.cycle as Cycle;
    cycle.samples.push({ t, e });
    if (this.upHold.held(e > this.up, t, UP_HOLD_MS)) {
      this.setPhase("onBox");
      return [];
    }
    if (this.downHold.held(e < FLOOR_SHARE * this.up, t, DOWN_HOLD_MS)) {
      this.cycle = null;
      this.setPhase("floor");
      return [];
    }
    if (deviation > 1 || t - cycle.startT > MAX_STALL_MS) this.forceRebaseline();
    return [];
  }

  private onBox(t: number, e: number, deviation: number): HipCandidate[] {
    const cycle = this.cycle as Cycle;
    cycle.samples.push({ t, e });
    if (e > this.up) cycle.upMs += Math.min(this.lastGapMs, 250);
    const limit = cycle.armed ? MAX_STALL_MS : MAX_UNARMED_MS;
    if (t - cycle.startT > limit || deviation > 1) {
      this.forceRebaseline();
      return [];
    }
    if (e < BACK_DOWN_SHARE * this.up) this.setPhase("descending");
    return [];
  }

  private onDescending(t: number, e: number, deviation: number): HipCandidate[] {
    const cycle = this.cycle as Cycle;
    cycle.samples.push({ t, e });
    if (t - cycle.startT > MAX_STALL_MS || deviation > 1) {
      this.forceRebaseline();
      return [];
    }
    if (this.backUpHold.held(e > this.up, t, BACK_UP_HOLD_MS)) {
      this.setPhase("onBox");
      return [];
    }
    if (e >= FLOOR_SHARE * this.up) return [];
    this.cycle = null;
    this.setPhase("floor");
    return cycle.armed ? this.finish(t, cycle) : [];
  }

  private finish(t: number, cycle: Cycle): HipCandidate[] {
    const upSamples = cycle.samples.filter((s) => s.e > this.up).map((s) => s.e);
    const plateau = percentile(upSamples, 0.5);
    const riseMs = plateau > 0 ? crossing(cycle.samples, 0.8 * plateau) - crossing(cycle.samples, 0.2 * plateau) : 0;
    const duration = t - cycle.startT;
    const plateauDeviation = cycle.plateauDeviations.length
      ? cycle.plateauDeviations.reduce((a, b) => a + b, 0) / cycle.plateauDeviations.length
      : 0;
    const meanVisibility = cycle.frames ? cycle.visibilitySum / cycle.frames : 0;
    const visibility = clamp((meanVisibility - VISIBILITY_ZERO) / (VISIBILITY_FULL - VISIBILITY_ZERO), 0, 1);
    const blindShare = cycle.frames ? cycle.blindFrames / cycle.frames : 0;
    const reasons: string[] = [];
    if (cycle.squatBefore) reasons.push("hips went down first");
    if (cycle.maxDeviation > MAX_CYCLE_SCALE || plateauDeviation > MAX_PLATEAU_SCALE) reasons.push("body size changed");
    if (riseMs < MIN_RISE_MS) reasons.push("rise too abrupt");
    if (cycle.upMs < MIN_UP_MS) reasons.push("not held up");
    if (duration < MIN_CYCLE_MS || duration > MAX_CYCLE_MS) reasons.push("implausible duration");
    const valid = reasons.length === 0;
    const gapPenalty = clamp(cycle.maxGapMs / LOST_MS, 0, 1) * 0.15;
    const quality = visibility * (1 - gapPenalty);

    if (this.isLearning) return this.learnFrom(t, cycle, valid, plateau, quality, blindShare);
    const height = clamp((plateau / this.rise - 0.4) / 0.3, 0, 1);
    const confidence = valid ? quality * height : 0;
    const candidate: RepCandidate = {
      t,
      confidence,
      accepted: valid && confidence >= this.threshold,
      reason: valid ? (confidence < this.threshold ? "did not reach full step height" : undefined) : reasons[0],
    };
    return [{ candidate, startT: cycle.startT, blindShare }];
  }

  private learnFrom(t: number, cycle: Cycle, valid: boolean, plateau: number, quality: number, blindShare: number): HipCandidate[] {
    if (!valid || plateau < MIN_LEARNED_RISE || plateau > MAX_LEARNED_RISE) {
      this.learned = [];
      return [];
    }
    const previous = this.learned[this.learned.length - 1];
    if (previous && Math.abs(previous.plateau - plateau) > LEARN_AGREEMENT * ((previous.plateau + plateau) / 2)) {
      this.learned = [];
    }
    this.learned.push({ plateau, quality, startT: cycle.startT, t, blindShare });
    if (this.learned.length < LEARNED_TO_LOCK) return [];
    this.rise = this.learned.reduce((a, c) => a + c.plateau, 0) / this.learned.length;
    this.isLearning = false;
    this.lockedT = t;
    const confirmed = this.learned.map((c): HipCandidate => {
      const confidence = c.quality * clamp((c.plateau / this.rise - 0.4) / 0.3, 0, 1);
      return { candidate: { t: c.t, confidence, accepted: confidence >= this.threshold }, startT: c.startT, blindShare: c.blindShare };
    });
    this.learned = [];
    return confirmed;
  }
}

export { BLIND_SHARE_MIN };
