import type { Landmark, PoseFrame } from "../types.ts";

export const LM = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
  lHeel: 29,
  rHeel: 30,
  lFoot: 31,
  rFoot: 32,
} as const;

const MIN_SHOULDER_VISIBILITY = 0.4;
const MIN_HIP_VISIBILITY = 0.35;
const MIN_BEST_ANKLE_VISIBILITY = 0.5;
const MIN_WEAK_ANKLE_VISIBILITY = 0.3;

export interface BodyMeasure {
  t: number;
  torso: number;
  hipX: number;
  hipY: number;
  lAnkleY: number;
  rAnkleY: number;
  visibility: number;
}

function mid(a: Landmark, b: Landmark): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function measureBody(frame: PoseFrame): BodyMeasure | null {
  const lm = frame.landmarks;
  if (!lm || lm.length < 33) return null;
  const vis = (i: number) => lm[i].visibility;
  if (Math.min(vis(LM.lShoulder), vis(LM.rShoulder)) < MIN_SHOULDER_VISIBILITY) return null;
  if (Math.min(vis(LM.lHip), vis(LM.rHip)) < MIN_HIP_VISIBILITY) return null;
  const bestAnkle = Math.max(vis(LM.lAnkle), vis(LM.rAnkle));
  const weakAnkle = Math.min(vis(LM.lAnkle), vis(LM.rAnkle));
  if (bestAnkle < MIN_BEST_ANKLE_VISIBILITY || weakAnkle < MIN_WEAK_ANKLE_VISIBILITY) return null;
  const shoulders = mid(lm[LM.lShoulder], lm[LM.rShoulder]);
  const hips = mid(lm[LM.lHip], lm[LM.rHip]);
  const torso = Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y);
  if (torso < 0.02) return null;
  const hipVisibility = (vis(LM.lHip) + vis(LM.rHip)) / 2;
  const kneeVisibility = Math.max(vis(LM.lKnee), vis(LM.rKnee));
  const visibility = (hipVisibility + kneeVisibility + bestAnkle) / 3;
  return {
    t: frame.t,
    torso,
    hipX: hips.x,
    hipY: hips.y,
    lAnkleY: lm[LM.lAnkle].y,
    rAnkleY: lm[LM.rAnkle].y,
    visibility,
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export class Smoother {
  private recent: number[] = [];
  private ema: number | null = null;
  private readonly alpha: number;

  constructor(alpha = 0.6) {
    this.alpha = alpha;
  }

  push(v: number): number {
    this.recent.push(v);
    if (this.recent.length > 3) this.recent.shift();
    const m = median(this.recent);
    this.ema = this.ema === null ? m : this.alpha * m + (1 - this.alpha) * this.ema;
    return this.ema;
  }

  reset(): void {
    this.recent = [];
    this.ema = null;
  }
}

export class Sustain {
  since: number | null = null;

  held(condition: boolean, t: number, ms: number): boolean {
    if (!condition) {
      this.since = null;
      return false;
    }
    if (this.since === null) this.since = t;
    return t - this.since >= ms;
  }

  reset(): void {
    this.since = null;
  }
}

export class StabilityWindow {
  private samples: { t: number; values: number[] }[] = [];
  private readonly maxSpanMs: number;

  constructor(maxSpanMs = 5000) {
    this.maxSpanMs = maxSpanMs;
  }

  push(t: number, values: number[], tolerance: number[]): void {
    this.samples.push({ t, values });
    while (this.samples.length > 1 && t - this.samples[0].t > this.maxSpanMs) this.samples.shift();
    while (this.samples.length > 1 && this.exceeds(tolerance)) this.samples.shift();
  }

  private exceeds(tolerance: number[]): boolean {
    return tolerance.some((tol, c) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const s of this.samples) {
        lo = Math.min(lo, s.values[c]);
        hi = Math.max(hi, s.values[c]);
      }
      return hi - lo > tol;
    });
  }

  get spanMs(): number {
    const n = this.samples.length;
    return n < 2 ? 0 : this.samples[n - 1].t - this.samples[0].t;
  }

  mean(channel: number): number {
    return this.samples.reduce((s, x) => s + x.values[channel], 0) / this.samples.length;
  }

  reset(): void {
    this.samples = [];
  }
}
