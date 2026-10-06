import type { Landmark, PoseFrame } from "../types.ts";
import { LM } from "./geometry.ts";

export interface FigureState {
  x: number;
  scale: number;
  lAnkle: number;
  rAnkle: number;
  hip: number;
  visibility: number;
  hipVisibility?: number;
  lAnkleVisibility?: number;
  rAnkleVisibility?: number;
  globalDy?: number;
  globalDx?: number;
  floorDy?: number;
  hipForward?: number;
  ankleSeparation?: number;
}

export const STANDING: FigureState = { x: 0.5, scale: 1, lAnkle: 0, rAnkle: 0, hip: 0, visibility: 0.95 };

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

export function makeFrame(t: number, s: FigureState, noise: number, rng: () => number): PoseFrame {
  const torso = 0.16 * s.scale;
  const floorY = 0.35 + 0.55 * s.scale + (s.floorDy ?? 0) + (s.globalDy ?? 0);
  const hipY = floorY - (2 + s.hip) * torso;
  const shoulderY = hipY - torso;
  const x = s.x + (s.globalDx ?? 0);
  const hipX = x + (s.hipForward ?? 0) * torso;
  const sep = s.ankleSeparation ?? 0.03;
  const hipVis = s.hipVisibility ?? s.visibility;
  const lAnkleVis = s.lAnkleVisibility ?? s.visibility;
  const rAnkleVis = s.rAnkleVisibility ?? s.visibility;
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x, y: shoulderY, z: 0, visibility: 0.3 }));
  const set = (idx: number, px: number, y: number, visibility: number) => {
    lm[idx] = { x: px, y, z: 0, visibility };
  };
  const lAnkleY = floorY - s.lAnkle * torso;
  const rAnkleY = floorY - s.rAnkle * torso;
  const foot = 0.02;
  set(LM.nose, x, shoulderY - 0.6 * torso, s.visibility);
  set(LM.lShoulder, x - 0.04 * s.scale, shoulderY, s.visibility);
  set(LM.rShoulder, x + 0.04 * s.scale, shoulderY, s.visibility);
  set(LM.lHip, hipX - 0.03 * s.scale, hipY, hipVis);
  set(LM.rHip, hipX + 0.03 * s.scale, hipY, hipVis);
  set(LM.lKnee, x - sep * s.scale, (hipY + lAnkleY) / 2, lAnkleVis);
  set(LM.rKnee, x + sep * s.scale, (hipY + rAnkleY) / 2, rAnkleVis);
  set(LM.lAnkle, x - sep * s.scale, lAnkleY, lAnkleVis);
  set(LM.rAnkle, x + sep * s.scale, rAnkleY, rAnkleVis);
  set(LM.lHeel, x - sep * s.scale, lAnkleY + 0.15 * torso, lAnkleVis);
  set(LM.rHeel, x + sep * s.scale, rAnkleY + 0.15 * torso, rAnkleVis);
  set(LM.lFoot, x - sep * s.scale + foot, lAnkleY + 0.25 * torso, lAnkleVis);
  set(LM.rFoot, x + sep * s.scale + foot, rAnkleY + 0.25 * torso, rAnkleVis);
  const jitter = noise * torso;
  const landmarks = lm.map((l) => ({
    ...l,
    x: l.x + gaussian(rng) * jitter,
    y: l.y + gaussian(rng) * jitter,
    visibility: Math.min(1, Math.max(0, l.visibility + gaussian(rng) * 0.02)),
  }));
  return { t, landmarks, brightness: 120 };
}

export const smoothstep = (u: number): number => {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
};

const ramp = (t: number, from: number, to: number): number => smoothstep((t - from) / (to - from));

export interface CycleTiming {
  upMs: number;
  holdMs: number;
  downMs: number;
}

export const DEFAULT_TIMING: CycleTiming = { upMs: 700, holdMs: 500, downMs: 700 };

export function cycleState(tauMs: number, box: number, timing: CycleTiming, lead: "l" | "r" = "l"): Partial<FigureState> {
  const { upMs, holdMs, downMs } = timing;
  const downStart = upMs + holdMs;
  const leadElev = box * (ramp(tauMs, 0, upMs * 0.55) - ramp(tauMs, downStart, downStart + downMs * 0.6));
  const trailElev = box * (ramp(tauMs, upMs * 0.4, upMs) - ramp(tauMs, downStart + downMs * 0.4, downStart + downMs));
  const hip = box * (ramp(tauMs, 0, upMs) - ramp(tauMs, downStart, downStart + downMs));
  return lead === "l" ? { lAnkle: leadElev, rAnkle: trailElev, hip } : { rAnkle: leadElev, lAnkle: trailElev, hip };
}

export function realisticRep(
  tauMs: number,
  box: number,
  lead: "l" | "r",
  activeMs = 3700,
  opts: { hipForward?: number; kneeLift?: number; sag?: number } = {},
): Partial<FigureState> {
  const u = (tauMs * 3100) / activeMs;
  const lift = opts.kneeLift ?? 0.25;
  const bump = (from: number, to: number) => lift * Math.sin(Math.PI * Math.min(1, Math.max(0, (u - from) / (to - from))));
  let leadElev = box * ramp(u, 0, 550) + bump(0, 550);
  if (u > 2000) leadElev = box * (1 - ramp(u, 2000, 2600));
  let trailElev = box * ramp(u, 450, 1200) + bump(450, 1200);
  if (u > 2500) trailElev = box * (1 - ramp(u, 2500, 3100));
  const hip = box * (ramp(u, 200, 1300) - ramp(u, 2000, 3000));
  const hipForward = (opts.hipForward ?? 0) * (ramp(u, 100, 1200) - ramp(u, 2000, 3000));
  const sag = 1 - (opts.sag ?? 0) * ramp(u, 1300, 1700) * (1 - ramp(u, 2000, 2300));
  return lead === "l"
    ? { lAnkle: leadElev * sag, rAnkle: trailElev * sag, hip: hip * sag, hipForward }
    : { rAnkle: leadElev * sag, lAnkle: trailElev * sag, hip: hip * sag, hipForward };
}

interface Segment {
  from: number;
  to: number;
  fromElevation: number;
  toElevation: number;
}

function evaluateSegments(segments: Segment[], t: number): number {
  let value = 0;
  for (const seg of segments) {
    if (t < seg.from) break;
    value = t >= seg.to ? seg.toElevation : seg.fromElevation + (seg.toElevation - seg.fromElevation) * smoothstep((t - seg.from) / (seg.to - seg.from));
  }
  return value;
}

export interface TapAndGoOptions {
  cadenceMs: number;
  tapMs: number;
  pauseMs?: number;
  upMs?: number;
  downMs?: number;
}

export interface TapAndGoPlan {
  durationMs: number;
  at: (tauMs: number) => Partial<FigureState>;
}

export function planTapAndGo(count: number, box: number, opts: TapAndGoOptions, rng: () => number): TapAndGoPlan {
  const upMs = opts.upMs ?? 700;
  const downMs = opts.downMs ?? 750;
  const legs: Record<"l" | "r", Segment[]> = { l: [], r: [] };
  let start = 0;
  let lead: "l" | "r" = "l";
  for (let i = 0; i < count; i++) {
    const trail: "l" | "r" = lead === "l" ? "r" : "l";
    const jitter = 1 + (rng() - 0.5) * 0.2;
    const pause = (opts.pauseMs ?? 0) * rng();
    const period = opts.cadenceMs * jitter;
    const holdMs = Math.max(200, period - upMs - 0.75 * downMs - opts.tapMs - pause);
    const down = start + upMs + holdMs;
    legs[lead].push({ from: start, to: start + upMs * 0.55, fromElevation: 0, toElevation: box });
    legs[trail].push({ from: start + upMs * 0.4, to: start + upMs, fromElevation: 0, toElevation: box });
    legs[lead].push({ from: down, to: down + downMs * 0.45, fromElevation: box, toElevation: 0 });
    legs[trail].push({ from: down + downMs * 0.3, to: down + downMs * 0.75, fromElevation: box, toElevation: 0 });
    start = down + downMs * 0.75 + opts.tapMs + pause;
    lead = trail;
  }
  return {
    durationMs: start,
    at: (tau) => {
      const lAnkle = evaluateSegments(legs.l, tau);
      const rAnkle = evaluateSegments(legs.r, tau);
      return { lAnkle, rAnkle, hip: (lAnkle + rAnkle) / 2 };
    },
  };
}

export class Scene {
  readonly frames: PoseFrame[] = [];
  t = 0;
  noise: number;
  private readonly rng: () => number;
  private dtMs: number;
  private readonly jitterMs: number;

  constructor(opts?: { seed?: number; fps?: number; noise?: number; jitterMs?: number }) {
    this.rng = mulberry32(opts?.seed ?? 1);
    this.dtMs = 1000 / (opts?.fps ?? 20);
    this.noise = opts?.noise ?? 0.03;
    this.jitterMs = opts?.jitterMs ?? 0;
  }

  setFps(fps: number): void {
    this.dtMs = 1000 / fps;
  }

  private nextDt(): number {
    return this.dtMs + (this.jitterMs ? (this.rng() * 2 - 1) * this.jitterMs : 0);
  }

  emit(state: FigureState): void {
    this.frames.push(makeFrame(this.t, state, this.noise, this.rng));
    this.t += this.nextDt();
  }

  missing(ms: number): void {
    const end = this.t + ms;
    while (this.t < end) {
      this.frames.push({ t: this.t, landmarks: null, brightness: 120 });
      this.t += this.nextDt();
    }
  }

  run(ms: number, at: (tauMs: number) => Partial<FigureState>, base: FigureState = STANDING): void {
    const start = this.t;
    while (this.t - start < ms) this.emit({ ...base, ...at(this.t - start) });
  }

  still(ms: number, base: FigureState = STANDING): void {
    this.run(ms, () => ({}), base);
  }

  cycle(box: number, timing: CycleTiming = DEFAULT_TIMING, base: FigureState = STANDING, lead: "l" | "r" = "l"): void {
    this.run(timing.upMs + timing.holdMs + timing.downMs, (tau) => cycleState(tau, box, timing, lead), base);
  }

  tapAndGo(count: number, box: number, opts: TapAndGoOptions, base: FigureState = STANDING): void {
    const plan = planTapAndGo(count, box, opts, this.rng);
    this.run(plan.durationMs, plan.at, base);
  }

  reps(
    count: number,
    box: number,
    opts: { base?: FigureState; pauseMs?: number; activeMs?: number; hipForward?: number; sag?: number } = {},
  ): void {
    const base = opts.base ?? STANDING;
    const activeMs = opts.activeMs ?? 3700;
    for (let i = 0; i < count; i++) {
      this.run(activeMs, (tau) => realisticRep(tau, box, i % 2 ? "r" : "l", activeMs, { hipForward: opts.hipForward, sag: opts.sag }), base);
      this.still(opts.pauseMs ?? 200, base);
    }
  }
}
