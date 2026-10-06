import type { Calibration, CalibrationFloor, PoseFrame, RepCandidate } from "../types.ts";
import { clamp, estimateStepInches, measureBody, median, Smoother, StabilityWindow, Sustain } from "./geometry.ts";
import type { BodyMeasure } from "./geometry.ts";

type Phase = "floor" | "rising" | "onBox" | "descending" | "repositioning" | "lost";

const LOST_MS = 500;
const RISE_MS = 150;
const ON_BOX_MS = 250;
const OFF_BOX_MS = 100;
const FLOOR_MS = 150;
const SETTLE_MS = 550;
const LEVEL_SHIFT_MS = 1000;
const MIN_CYCLE_MS = 1200;
const MAX_CYCLE_MS = 8000;
const MAX_STALL_MS = 12000;
const MAX_UNARMED_BOX_MS = 5000;
const RECENT_MS = 10000;
const MIN_RECENT_MS = 3000;
const FLOOR_PERCENTILE_SHARE = 0.15;
const BELOW_BASELINE_FRACTION = 0.25;
const BELOW_BASELINE_MS = 300;
const MAX_RISING_MS = 10000;
const MIN_SEQUENCE_MS = 80;

const RISE_FRACTION = 0.35;
const SEQUENCE_FRACTION = 0.5;
const ON_BOX_FRACTION = 0.5;
const HIP_ON_BOX_FRACTION = 0.6;
const OFF_BOX_FRACTION = 0.4;
const TAP_TRAIL_FRACTION = 0.5;
const PROVISIONAL_STEP_TORSO = 0.5;
const MIN_LEARNED_STEP_TORSO = 0.3;
const MAX_LEARNED_STEP_TORSO = 2.5;
const LEARN_AGREEMENT = 0.25;
const LEARN_HIP_AGREEMENT = 0.5;
const LEARNED_REPS_TO_LOCK = 2;
const ESTIMATE_SHOWN_MS = 8000;
const FLOOR_FRACTION = 0.25;
const BASELINE_UPDATE_FRACTION = 0.15;
const LEVEL_SHIFT_FRACTION = 0.15;
const LEVEL_SHIFT_FEET_MISMATCH_FRACTION = 0.2;
const BASELINE_TAU_MS = 10000;

const VELOCITY_WINDOW_MS = 1200;
const MIN_VELOCITY_SPAN_MS = 800;
const REPOSITION_SPEED = 1.0;
const REPOSITION_SPEED_EXPECTED = 0.7;
const MAX_SCALE_DEVIATION = 0.15;
const MAX_CYCLE_SCALE_DEVIATION = 0.25;
const SCALE_HOLD_MS = 300;
const MAX_SCALE_RATE = 0.12;
const MIN_SCALE_DRIFT = 0.08;
const RESUME_SCALE_TOLERANCE = 0.15;
const JUMP_TORSO_FRACTION = 0.8;
const JUMP_TORSO_RATIO = 0.5;
const JUMP_MAX_GAP_FRAMES = 1.5;
const EDGE_SAMPLES = 6;

const SETTLE_POSITION_TOL = 0.2;
const SETTLE_FEET_TOL = 0.12;
const SETTLE_TORSO_TOL = 0.25;

const GAP_FRAME_MULTIPLE = 3;
const MIN_GAP_LIMIT_MS = 100;
const MAX_GAP_PENALTY = 0.15;
const VISIBILITY_FULL = 0.7;
const VISIBILITY_ZERO = 0.4;
const FRAME_INTERVAL_SAMPLES = 15;
const TAP_CLOSE_HIP_FRACTION = 0.5;
const TAP_GUARD_MS = 400;
const GUARD_SLOPE_TOLERANCE = 0.02;
const MAX_INTERPOLATION_GAP_MS = 500;
const IDLE_MS = 2000;
const IDLE_SWAY_TORSO = 0.3;
const FPS_ACTIVE = 14;
const FPS_SETTLING = 10;
const FPS_IDLE = 8;
const FPS_LOST = 5;

interface Baseline {
  lAnkleY: number;
  rAnkleY: number;
  hipY: number;
  torso: number;
}

interface Features {
  lAnkle: number;
  rAnkle: number;
  hip: number;
  minAnkle: number;
  maxAnkle: number;
}

interface Cycle {
  startT: number;
  armed: boolean;
  visibilitySum: number;
  visibilityCount: number;
  maxGapMs: number;
  onBoxRatios: number[];
  hipRatios: number[];
  riseSeparationMs: number;
  dropT: { l: number | null; r: number | null };
}

interface LearnedCycle {
  t: number;
  plateau: number;
  hipPlateau: number;
  quality: number;
}

interface Smoothed {
  t: number;
  hipX: number;
  hipY: number;
  lAnkleY: number;
  rAnkleY: number;
  torso: number;
}

interface HistoryPoint {
  t: number;
  x: number;
  torso: number;
}

class Smoothers {
  hipX = new Smoother();
  hipY = new Smoother();
  lAnkleY = new Smoother();
  rAnkleY = new Smoother();
  torso = new Smoother();

  push(m: BodyMeasure): Smoothed {
    return {
      t: m.t,
      hipX: this.hipX.push(m.hipX),
      hipY: this.hipY.push(m.hipY),
      lAnkleY: this.lAnkleY.push(m.lAnkleY),
      rAnkleY: this.rAnkleY.push(m.rAnkleY),
      torso: this.torso.push(m.torso),
    };
  }

  reset(): void {
    for (const s of [this.hipX, this.hipY, this.lAnkleY, this.rAnkleY, this.torso]) s.reset();
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function averageFrom(history: HistoryPoint[], from: number): HistoryPoint {
  const start = Math.max(0, from);
  const part = history.slice(start, start + EDGE_SAMPLES);
  const mean = (pick: (h: HistoryPoint) => number) => part.reduce((a, h) => a + pick(h), 0) / part.length;
  return { t: mean((h) => h.t), x: mean((h) => h.x), torso: mean((h) => h.torso) };
}

export class RepDetector {
  private box: number;
  private learning: boolean;
  private learned: LearnedCycle[] = [];
  private queued: RepCandidate[] = [];
  private lockedAt: number | null = null;
  private readonly threshold: number;
  private readonly seed: CalibrationFloor | null;
  private currentPhase: Phase = "floor";
  private baseline: Baseline | null = null;
  private seedPending: boolean;
  private cycle: Cycle | null = null;
  private lastUsableT: number | null = null;
  private lastFrameT: number | null = null;
  private lastGapMs = 0;
  private lastMeasure: BodyMeasure | null = null;
  private frameIntervals: number[] = [];
  private transitionExpected = false;

  private readonly smoothers = new Smoothers();
  private readonly settle = new StabilityWindow();
  private readonly levelWindow = new StabilityWindow(IDLE_MS + 1000);
  private history: HistoryPoint[] = [];
  private recent: Smoothed[] = [];
  private readonly belowHold = new Sustain();
  private up: { l: number | null; r: number | null } = { l: null, r: null };
  private prevElevation: { t: number; l: number; r: number } | null = null;
  private prevMaxAnkle = 0;
  private guardUntil = -Infinity;
  private readonly riseHold = new Sustain();
  private readonly onBoxHold = new Sustain();
  private readonly offBoxHold = new Sustain();
  private readonly floorHold = new Sustain();
  private readonly scaleHold = new Sustain();

  constructor(calibration: Calibration | null, opts?: { confidenceThreshold?: number }) {
    this.learning = calibration === null;
    this.box = calibration?.boxHeightTorso ?? PROVISIONAL_STEP_TORSO;
    this.threshold = opts?.confidenceThreshold ?? 0.8;
    this.seed = calibration?.floor ?? null;
    this.seedPending = this.seed !== null;
  }

  get phase(): string {
    return this.currentPhase;
  }

  get diagnostic(): string {
    if (this.currentPhase === "lost") return "Lost you";
    if (this.learning) return "Learning your step…";
    if (this.lockedAt !== null && (this.lastFrameT ?? 0) - this.lockedAt < ESTIMATE_SHOWN_MS) {
      return `Step height: ${estimateStepInches(this.box)} in (est.)`;
    }
    return "";
  }

  pushAll(frame: PoseFrame): RepCandidate[] {
    const first = this.push(frame);
    const out = first ? [first, ...this.queued] : this.queued;
    this.queued = [];
    return out;
  }

  get suggestedFps(): number {
    switch (this.currentPhase) {
      case "lost":
        return FPS_LOST;
      case "repositioning":
        return FPS_SETTLING;
      case "floor":
        return this.levelWindow.spanMs >= IDLE_MS ? FPS_IDLE : FPS_ACTIVE;
      default:
        return FPS_ACTIVE;
    }
  }

  setContext(ctx: { repsIntoSet: number; setSize: number; reps?: number }): void {
    const finishedSet = ctx.repsIntoSet === 0 && (ctx.reps ?? 0) > 0;
    this.transitionExpected = finishedSet || ctx.repsIntoSet >= ctx.setSize - 1;
  }

  push(frame: PoseFrame): RepCandidate | null {
    this.trackFrameInterval(frame.t);
    const m = measureBody(frame);
    if (!m) {
      this.onMissing(frame.t);
      return null;
    }
    const gap = this.lastUsableT === null ? 0 : m.t - this.lastUsableT;
    this.lastUsableT = m.t;
    this.lastGapMs = gap;
    if (this.currentPhase !== "lost" && gap > LOST_MS) this.enterLost();
    if (this.currentPhase === "lost") this.enterRepositioning();
    else if (this.cycle) this.cycle.maxGapMs = Math.max(this.cycle.maxGapMs, gap);

    if (this.seedPending) this.trySeed(m);
    const jumped = this.isJump(m, gap);
    this.lastMeasure = m;
    if (jumped && this.currentPhase !== "repositioning") this.enterRepositioning();
    const s = this.smoothers.push(m);
    this.recordHistory(s);
    this.recordRecent(s);
    if (this.currentPhase !== "repositioning" && this.isRepositioning(s)) this.enterRepositioning();
    if (this.cycle) {
      this.cycle.visibilitySum += m.visibility;
      this.cycle.visibilityCount += 1;
    }
    this.pushLevelWindow(s);
    return this.step(s);
  }

  private step(s: Smoothed): RepCandidate | null {
    switch (this.currentPhase) {
      case "repositioning":
        this.updateSettling(s);
        return null;
      case "floor":
        return this.onFloor(s);
      case "rising":
        return this.onRising(s);
      case "onBox":
        return this.onBox(s);
      default:
        return this.onDescending(s);
    }
  }

  private trackFrameInterval(t: number): void {
    if (this.lastFrameT !== null && t > this.lastFrameT) {
      this.frameIntervals.push(t - this.lastFrameT);
      if (this.frameIntervals.length > FRAME_INTERVAL_SAMPLES) this.frameIntervals.shift();
    }
    this.lastFrameT = t;
  }

  private gapLimitMs(): number {
    return Math.max(MIN_GAP_LIMIT_MS, GAP_FRAME_MULTIPLE * median(this.frameIntervals));
  }

  private onMissing(t: number): void {
    if (this.currentPhase === "lost" || this.lastUsableT === null) return;
    if (t - this.lastUsableT > LOST_MS) this.enterLost();
  }

  private setPhase(phase: Phase): void {
    this.currentPhase = phase;
    for (const h of [this.riseHold, this.onBoxHold, this.offBoxHold, this.floorHold]) h.reset();
    if (phase === "floor") {
      this.history = [];
      this.scaleHold.reset();
    }
  }

  private enterLost(): void {
    this.cycle = null;
    this.setPhase("lost");
  }

  private enterRepositioning(): void {
    this.cycle = null;
    this.history = [];
    this.recent = [];
    this.scaleHold.reset();
    this.settle.reset();
    this.levelWindow.reset();
    this.smoothers.reset();
    this.lastMeasure = null;
    this.up = { l: null, r: null };
    this.setPhase("repositioning");
  }

  private forceRebaseline(): void {
    this.cycle = null;
    this.baseline = this.lowestLevelBaseline();
    this.seedPending = false;
    this.history = [];
    this.settle.reset();
    this.levelWindow.reset();
    this.up = { l: null, r: null };
    this.setPhase("floor");
  }

  private trySeed(m: BodyMeasure): void {
    this.seedPending = false;
    const seed = this.seed as CalibrationFloor;
    if (Math.abs(m.torso / seed.torso - 1) < RESUME_SCALE_TOLERANCE) this.baseline = { ...seed };
  }

  private isJump(m: BodyMeasure, gap: number): boolean {
    const last = this.lastMeasure;
    if (!last || gap > JUMP_MAX_GAP_FRAMES * median(this.frameIntervals)) return false;
    const travel = Math.hypot(m.hipX - last.hipX, m.hipY - last.hipY) / last.torso;
    const ratio = m.torso / last.torso;
    return travel > JUMP_TORSO_FRACTION || ratio < 1 - JUMP_TORSO_RATIO || ratio > 1 + JUMP_TORSO_RATIO;
  }

  private recordRecent(s: Smoothed): void {
    this.recent.push(s);
    while (s.t - this.recent[0].t > RECENT_MS) this.recent.shift();
  }

  private lowestLevelBaseline(): Baseline | null {
    const n = this.recent.length;
    if (n < 10 || this.recent[n - 1].t - this.recent[0].t < MIN_RECENT_MS) return null;
    const lowest = [...this.recent]
      .sort((a, b) => b.lAnkleY + b.rAnkleY - (a.lAnkleY + a.rAnkleY))
      .slice(0, Math.max(5, Math.floor(n * FLOOR_PERCENTILE_SHARE)));
    const mean = (pick: (x: Smoothed) => number) => lowest.reduce((a, x) => a + pick(x), 0) / lowest.length;
    return {
      lAnkleY: mean((x) => x.lAnkleY),
      rAnkleY: mean((x) => x.rAnkleY),
      hipY: mean((x) => x.hipY),
      torso: median(this.recent.map((x) => x.torso)),
    };
  }

  private recordHistory(s: Smoothed): void {
    this.history.push({ t: s.t, x: s.hipX, torso: s.torso });
    while (this.history.length > 1 && s.t - this.history[0].t > VELOCITY_WINDOW_MS) this.history.shift();
  }

  private isRepositioning(s: Smoothed): boolean {
    if (this.currentPhase === "lost") return false;
    const recentTorso = averageFrom(this.history, this.history.length - EDGE_SAMPLES).torso;
    const deviation = this.baseline ? Math.abs(recentTorso / this.baseline.torso - 1) : 0;
    if (this.currentPhase !== "floor") {
      return this.scaleHold.held(deviation > MAX_CYCLE_SCALE_DEVIATION, s.t, SCALE_HOLD_MS);
    }
    const spanMs = s.t - this.history[0].t;
    if (spanMs >= MIN_VELOCITY_SPAN_MS) {
      const start = averageFrom(this.history, 0);
      const end = averageFrom(this.history, this.history.length - EDGE_SAMPLES);
      const centersMs = end.t - start.t;
      const reference = this.baseline?.torso ?? s.torso;
      const speed = Math.abs(end.x - start.x) / reference / (centersMs / 1000);
      if (speed > (this.transitionExpected ? REPOSITION_SPEED_EXPECTED : REPOSITION_SPEED)) return true;
      const scaleRate = Math.abs(end.torso / start.torso - 1) / (centersMs / 1000);
      const drift = this.baseline ? Math.abs(end.torso / this.baseline.torso - 1) : 0;
      if (scaleRate > MAX_SCALE_RATE && drift > MIN_SCALE_DRIFT) return true;
    }
    return this.scaleHold.held(deviation > MAX_SCALE_DEVIATION, s.t, SCALE_HOLD_MS);
  }

  private pushSettle(s: Smoothed): void {
    const pos = s.torso * SETTLE_POSITION_TOL;
    const feet = s.torso * SETTLE_FEET_TOL;
    this.settle.push(
      s.t,
      [s.hipX, s.lAnkleY, s.rAnkleY, s.hipY, s.torso],
      [pos, feet, feet, pos, s.torso * SETTLE_TORSO_TOL],
    );
  }

  private pushLevelWindow(s: Smoothed): void {
    const pos = s.torso * SETTLE_POSITION_TOL;
    this.levelWindow.push(s.t, [s.lAnkleY, s.rAnkleY, s.hipY, s.hipX], [pos, pos, pos, s.torso * IDLE_SWAY_TORSO]);
  }

  private settledBaseline(): Baseline | null {
    if (this.settle.spanMs < SETTLE_MS) return null;
    return {
      lAnkleY: this.settle.mean(1),
      rAnkleY: this.settle.mean(2),
      hipY: this.settle.mean(3),
      torso: this.settle.mean(4),
    };
  }

  private updateSettling(s: Smoothed): void {
    this.pushSettle(s);
    const settled = this.settledBaseline();
    if (!settled) return;
    this.history = [];
    this.scaleHold.reset();
    const previous = this.baseline ?? (this.seed as Baseline | null);
    if (previous && Math.abs(settled.torso / previous.torso - 1) < RESUME_SCALE_TOLERANCE) {
      const f = this.features(settled, previous);
      if (f.minAnkle > ON_BOX_FRACTION * this.box && f.hip > HIP_ON_BOX_FRACTION * this.box) {
        this.baseline = previous;
        this.cycle = this.newCycle(s.t, false);
        this.setPhase("onBox");
        return;
      }
    }
    this.baseline = settled;
    this.setPhase("floor");
  }

  private features(s: { lAnkleY: number; rAnkleY: number; hipY: number }, b: Baseline): Features {
    const lAnkle = (b.lAnkleY - s.lAnkleY) / b.torso;
    const rAnkle = (b.rAnkleY - s.rAnkleY) / b.torso;
    return {
      lAnkle,
      rAnkle,
      hip: (b.hipY - s.hipY) / b.torso,
      minAnkle: Math.min(lAnkle, rAnkle),
      maxAnkle: Math.max(lAnkle, rAnkle),
    };
  }

  private newCycle(startT: number, armed: boolean): Cycle {
    return {
      startT,
      armed,
      visibilitySum: 0,
      visibilityCount: 0,
      maxGapMs: 0,
      onBoxRatios: [],
      hipRatios: [],
      riseSeparationMs: 0,
      dropT: { l: null, r: null },
    };
  }

  private crossing(level: number, current: number, side: "l" | "r", t: number): number {
    const prev = this.prevElevation;
    if (!prev || t - prev.t > MAX_INTERPOLATION_GAP_MS || prev[side] === current) return t;
    return clamp(prev.t + ((level - prev[side]) / (current - prev[side])) * (t - prev.t), prev.t, t);
  }

  private trackRise(f: Features, t: number): void {
    const level = SEQUENCE_FRACTION * this.box;
    const reset = RISE_FRACTION * this.box;
    for (const [side, elevation] of [["l", f.lAnkle], ["r", f.rAnkle]] as const) {
      if (elevation > level) this.up[side] ??= this.crossing(level, elevation, side, t);
      else if (elevation < reset) this.up[side] = null;
    }
    this.prevElevation = { t, l: f.lAnkle, r: f.rAnkle };
  }

  private trackDrop(f: Features, t: number, cycle: Cycle): void {
    const level = SEQUENCE_FRACTION * this.box;
    const reset = ON_BOX_FRACTION * this.box;
    for (const [side, elevation] of [["l", f.lAnkle], ["r", f.rAnkle]] as const) {
      if (elevation < level) cycle.dropT[side] ??= this.crossing(level, elevation, side, t);
      else if (elevation > reset) cycle.dropT[side] = null;
    }
    this.prevElevation = { t, l: f.lAnkle, r: f.rAnkle };
  }

  private levelShifted(f: Features): boolean {
    if (this.levelWindow.spanMs < LEVEL_SHIFT_MS) return false;
    const feetTogether = Math.abs(f.lAnkle - f.rAnkle) < LEVEL_SHIFT_FEET_MISMATCH_FRACTION * this.box;
    const mean = (f.lAnkle + f.rAnkle) / 2;
    const offBaseline = this.currentPhase !== "floor" || Math.abs(mean) > LEVEL_SHIFT_FRACTION * this.box;
    return feetTogether && offBaseline && f.minAnkle < ON_BOX_FRACTION * this.box;
  }

  private rebaselineFromLevel(torso: number): void {
    this.baseline = {
      lAnkleY: this.levelWindow.mean(0),
      rAnkleY: this.levelWindow.mean(1),
      hipY: this.levelWindow.mean(2),
      torso,
    };
    this.cycle = null;
    this.setPhase("floor");
  }

  private onFloor(s: Smoothed): RepCandidate | null {
    if (!this.baseline) {
      this.pushSettle(s);
      this.baseline = this.settledBaseline();
      return null;
    }
    const f = this.features(s, this.baseline);
    this.trackRise(f, s.t);
    if (this.levelShifted(f)) {
      this.rebaselineFromLevel(s.torso);
      return null;
    }
    if (this.belowHold.held(f.maxAnkle < -BELOW_BASELINE_FRACTION * this.box, s.t, BELOW_BASELINE_MS)) {
      this.baseline = { lAnkleY: s.lAnkleY, rAnkleY: s.rAnkleY, hipY: s.hipY, torso: s.torso };
      return null;
    }
    const settledOnFloor =
      Math.abs(f.lAnkle) < BASELINE_UPDATE_FRACTION * this.box &&
      Math.abs(f.rAnkle) < BASELINE_UPDATE_FRACTION * this.box &&
      Math.abs(f.hip) < 2 * BASELINE_UPDATE_FRACTION * this.box;
    if (settledOnFloor) this.adaptBaseline(s);

    const settlingDown = s.t < this.guardUntil && f.maxAnkle < this.prevMaxAnkle - GUARD_SLOPE_TOLERANCE * this.box;
    this.prevMaxAnkle = f.maxAnkle;
    if (this.riseHold.held(f.maxAnkle > RISE_FRACTION * this.box && !settlingDown, s.t, RISE_MS)) {
      this.cycle = this.newCycle(this.riseHold.since ?? s.t, true);
      this.setPhase("rising");
      return this.onRising(s);
    }
    return null;
  }

  private adaptBaseline(s: Smoothed): void {
    const b = this.baseline as Baseline;
    const dt = clamp(this.lastGapMs, 0, 200);
    const alpha = 1 - Math.exp(-dt / BASELINE_TAU_MS);
    b.lAnkleY += alpha * (s.lAnkleY - b.lAnkleY);
    b.rAnkleY += alpha * (s.rAnkleY - b.rAnkleY);
    b.hipY += alpha * (s.hipY - b.hipY);
    b.torso += alpha * (s.torso - b.torso);
  }

  private onRising(s: Smoothed): RepCandidate | null {
    const cycle = this.cycle as Cycle;
    const f = this.features(s, this.baseline as Baseline);
    this.trackRise(f, s.t);
    const onBox = f.minAnkle > ON_BOX_FRACTION * this.box && f.hip > HIP_ON_BOX_FRACTION * this.box;
    if (this.onBoxHold.held(onBox, s.t, ON_BOX_MS)) {
      cycle.riseSeparationMs = this.up.l !== null && this.up.r !== null ? Math.abs(this.up.l - this.up.r) : 0;
      this.setPhase("onBox");
      return null;
    }
    if (this.floorHold.held(f.maxAnkle < FLOOR_FRACTION * this.box, s.t, FLOOR_MS)) {
      this.cycle = null;
      this.setPhase("floor");
      return this.reject(s.t, "never reached the box", cycle);
    }
    if (this.levelShifted(f)) this.rebaselineFromLevel(s.torso);
    else if (s.t - cycle.startT > MAX_RISING_MS) this.forceRebaseline();
    return null;
  }

  private onBox(s: Smoothed): RepCandidate | null {
    const cycle = this.cycle as Cycle;
    const f = this.features(s, this.baseline as Baseline);
    cycle.onBoxRatios.push(f.minAnkle / this.box);
    cycle.hipRatios.push(f.hip / this.box);
    this.trackDrop(f, s.t, cycle);
    if (this.stalled(s.t, cycle)) return null;
    if (this.offBoxHold.held(f.minAnkle < OFF_BOX_FRACTION * this.box, s.t, OFF_BOX_MS)) this.setPhase("descending");
    return null;
  }

  private stalled(t: number, cycle: Cycle): boolean {
    const limit = cycle.armed && cycle.riseSeparationMs >= MIN_SEQUENCE_MS ? MAX_STALL_MS : MAX_UNARMED_BOX_MS;
    if (t - cycle.startT <= limit) return false;
    this.forceRebaseline();
    return true;
  }

  private onDescending(s: Smoothed): RepCandidate | null {
    const cycle = this.cycle as Cycle;
    const f = this.features(s, this.baseline as Baseline);
    this.trackDrop(f, s.t, cycle);
    if (this.stalled(s.t, cycle)) return null;
    const backOnBox = f.minAnkle > ON_BOX_FRACTION * this.box && f.hip > HIP_ON_BOX_FRACTION * this.box;
    if (this.onBoxHold.held(backOnBox, s.t, ON_BOX_MS)) {
      this.setPhase("onBox");
      return null;
    }
    const leadGrounded = f.minAnkle < FLOOR_FRACTION * this.box;
    const trailDown = f.maxAnkle < TAP_TRAIL_FRACTION * this.box;
    if (leadGrounded && trailDown && f.hip < TAP_CLOSE_HIP_FRACTION * this.box) {
      this.cycle = null;
      this.up = { l: null, r: null };
      this.guardUntil = s.t + TAP_GUARD_MS;
      this.prevMaxAnkle = f.maxAnkle;
      this.setPhase("floor");
      return cycle.armed ? this.finishCycle(s.t, cycle) : null;
    }
    const onFloor = f.maxAnkle < FLOOR_FRACTION * this.box && f.hip < HIP_ON_BOX_FRACTION * this.box;
    if (!this.floorHold.held(onFloor, s.t, FLOOR_MS)) {
      if (this.levelShifted(f)) this.rebaselineFromLevel(s.torso);
      return null;
    }
    this.cycle = null;
    this.setPhase("floor");
    return cycle.armed ? this.finishCycle(s.t, cycle) : null;
  }

  private reject(t: number, reason: string, cycle: Cycle): RepCandidate | null {
    return cycle.armed ? { t, confidence: 0, accepted: false, reason } : null;
  }

  private cycleQuality(t: number, cycle: Cycle): { quality: number; plausible: boolean; sequenced: boolean; gapPenalty: number } {
    const meanVisibility = cycle.visibilityCount ? cycle.visibilitySum / cycle.visibilityCount : 0;
    const visibility = clamp((meanVisibility - VISIBILITY_ZERO) / (VISIBILITY_FULL - VISIBILITY_ZERO), 0, 1);
    const duration = t - cycle.startT;
    const plausible = duration >= MIN_CYCLE_MS && duration <= MAX_CYCLE_MS;
    const dropSeparation =
      cycle.dropT.l !== null && cycle.dropT.r !== null ? Math.abs(cycle.dropT.l - cycle.dropT.r) : 0;
    const sequenced = cycle.riseSeparationMs >= MIN_SEQUENCE_MS && dropSeparation >= MIN_SEQUENCE_MS;
    const gapLimit = this.gapLimitMs();
    const gapPenalty = clamp((cycle.maxGapMs - gapLimit) / (LOST_MS - gapLimit), 0, 1) * MAX_GAP_PENALTY;
    return {
      quality: visibility * (plausible ? 1 : 0.2) * (sequenced ? 1 : 0.2) * (1 - gapPenalty),
      plausible,
      sequenced,
      gapPenalty,
    };
  }

  private heightScore(plateauTorso: number): number {
    return clamp((plateauTorso / this.box - 0.4) / 0.3, 0, 1);
  }

  private finishCycle(t: number, cycle: Cycle): RepCandidate | null {
    return this.learning ? this.learnFrom(t, cycle) : this.evaluate(t, cycle);
  }

  private learnFrom(t: number, cycle: Cycle): RepCandidate | null {
    const q = this.cycleQuality(t, cycle);
    const plateau = percentile(cycle.onBoxRatios, 0.75) * this.box;
    const hipPlateau = percentile(cycle.hipRatios, 0.75) * this.box;
    const coherent = Math.abs(hipPlateau - plateau) <= LEARN_HIP_AGREEMENT * plateau;
    const sized = plateau >= MIN_LEARNED_STEP_TORSO && plateau <= MAX_LEARNED_STEP_TORSO;
    if (!q.plausible || !q.sequenced || !coherent || !sized) {
      this.learned = [];
      return null;
    }
    const previous = this.learned[this.learned.length - 1];
    if (previous && Math.abs(previous.plateau - plateau) > LEARN_AGREEMENT * ((previous.plateau + plateau) / 2)) {
      this.learned = [];
    }
    this.learned.push({ t, plateau, hipPlateau, quality: q.quality });
    if (this.learned.length < LEARNED_REPS_TO_LOCK) return null;

    this.box = this.learned.reduce((sum, c) => sum + c.plateau, 0) / this.learned.length;
    this.learning = false;
    this.lockedAt = t;
    const confirmed = this.learned.map((c): RepCandidate => {
      const confidence = c.quality * this.heightScore(c.plateau);
      return { t: c.t, confidence, accepted: confidence >= this.threshold };
    });
    this.learned = [];
    this.queued.push(...confirmed.slice(1));
    return confirmed[0];
  }

  private evaluate(t: number, cycle: Cycle): RepCandidate {
    const q = this.cycleQuality(t, cycle);
    const height = this.heightScore(percentile(cycle.onBoxRatios, 0.75) * this.box);
    const confidence = q.quality * height;
    const accepted = confidence >= this.threshold;
    let reason: string | undefined;
    if (!accepted) {
      if (!q.sequenced) reason = "feet did not move one after the other";
      else if (!q.plausible) reason = "implausible duration";
      else if (height < 0.9) reason = "did not reach full step height";
      else if (q.gapPenalty > 0.1) reason = "tracking dropped during rep";
      else reason = "low landmark visibility";
    }
    return { t, confidence, accepted, reason };
  }
}
