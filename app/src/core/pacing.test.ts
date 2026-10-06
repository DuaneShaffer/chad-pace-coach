import { describe, expect, it } from "vitest";
import type { WorkoutPlan } from "../types.ts";
import { computePace, revolutionSplits, setSplits } from "./pacing.ts";

const plan: WorkoutPlan = { targetTimeSec: 3900, setSize: 25, setsPerRevolution: 4, boxHeightIn: 20 };
const evenReps = (count: number, intervalMs: number) => Array.from({ length: count }, (_, i) => (i + 1) * intervalMs);

describe("computePace", () => {
  it("derives target rate from target time", () => {
    expect(computePace(plan, [], 0, 180).targetRepsPerSec).toBeCloseTo(0.2564, 4);
  });

  it("computes required rpm (40:00 elapsed, 590 reps)", () => {
    const snap = computePace(plan, evenReps(590, 4068), 2400_000, 180);
    expect(snap.requiredRpm).toBeCloseTo(16.4, 1);
    expect(snap.expectedReps).toBeCloseTo(615.38, 1);
    expect(snap.aheadSec).toBeCloseTo((590 - 615.38) / 0.25641, 1);
    expect(snap.aheadSec).toBeLessThan(0);
  });

  it("reports ahead as positive", () => {
    const snap = computePace(plan, evenReps(100, 1000), 100_000, 180);
    expect(snap.aheadSec).toBeGreaterThan(0);
    expect(snap.aheadSec).toBeCloseTo(100 / 0.25641 - 100, 0);
  });

  it("has null requiredRpm once target time has passed", () => {
    expect(computePace(plan, evenReps(900, 4400), 3_960_000, 180).requiredRpm).toBeNull();
  });

  it("computes overall and rolling rpm", () => {
    const times = [...evenReps(100, 3000)];
    const snap = computePace(plan, times, 300_000, 60);
    expect(snap.overallRpm).toBeCloseTo(20, 5);
    expect(snap.rollingRpm).toBeCloseTo(20, 5);
  });

  it("divides rolling window by elapsed when shorter than the window", () => {
    const snap = computePace(plan, evenReps(10, 3000), 30_000, 180);
    expect(snap.rollingRpm).toBeCloseTo(20, 5);
  });

  it("only counts reps inside the rolling window", () => {
    const fast = evenReps(120, 1000);
    const snap = computePace(plan, fast, 600_000, 60);
    expect(snap.rollingRpm).toBe(0);
    expect(snap.overallRpm).toBeCloseTo(12, 5);
    expect(snap.projectedFinishSec).toBeCloseTo(600 + 880 / 12 * 60, 3);
  });

  it("projects finish from rolling pace", () => {
    const snap = computePace(plan, evenReps(300, 3000), 900_000, 180);
    expect(snap.rollingRpm).toBeCloseTo(20, 5);
    expect(snap.projectedFinishSec).toBeCloseTo(900 + 700 / 20 * 60, 3);
  });

  it("has null projection with no pace", () => {
    expect(computePace(plan, [], 0, 180).projectedFinishSec).toBeNull();
    expect(computePace(plan, [], 30_000, 180).projectedFinishSec).toBeNull();
  });

  it("tracks revolution, set and rep position", () => {
    const times = evenReps(130, 3000);
    const snap = computePace(plan, times, 400_000, 180);
    expect(snap.revolution).toBe(2);
    expect(snap.totalRevolutions).toBe(10);
    expect(snap.repsIntoRevolution).toBe(30);
    expect(snap.repsPerRevolution).toBe(100);
    expect(snap.setInRevolution).toBe(2);
    expect(snap.repsIntoSet).toBe(5);
    expect(snap.revolutionElapsedSec).toBeCloseTo(400 - 300, 5);
    expect(snap.targetRevolutionSec).toBeCloseTo(390, 5);
  });

  it("starts a new set/revolution exactly on the boundary", () => {
    const snap = computePace(plan, evenReps(100, 3000), 300_000, 180);
    expect(snap.revolution).toBe(2);
    expect(snap.repsIntoRevolution).toBe(0);
    expect(snap.setInRevolution).toBe(1);
    expect(snap.repsIntoSet).toBe(0);
    expect(snap.revolutionElapsedSec).toBeCloseTo(0, 5);
  });

  it("clamps to the final revolution at completion", () => {
    const snap = computePace(plan, evenReps(1000, 3000), 3_000_000, 180);
    expect(snap.revolution).toBe(10);
    expect(snap.repsIntoRevolution).toBe(100);
    expect(snap.setInRevolution).toBe(4);
    expect(snap.repsIntoSet).toBe(25);
    expect(snap.remainingReps).toBe(0);
    expect(snap.projectedFinishSec).toBeCloseTo(3000, 5);
  });

  it("handles revolutions that do not divide 1000", () => {
    const odd: WorkoutPlan = { ...plan, setSize: 30, setsPerRevolution: 4 };
    const snap = computePace(odd, evenReps(1000, 3000), 3_000_000, 180);
    expect(snap.totalRevolutions).toBe(9);
    expect(snap.revolution).toBe(9);
    expect(snap.repsIntoRevolution).toBe(40);
    expect(snap.targetRevolutionSec).toBeCloseTo(3900 * 40 / 1000, 5);
    expect(snap.setInRevolution).toBe(2);
    expect(snap.repsIntoSet).toBe(10);
  });
});

describe("splits", () => {
  it("computes revolution splits against target", () => {
    const splits = revolutionSplits(plan, [
      { t: 380_000, revolutionNumber: 1, cumulativeRep: 100 },
      { t: 790_000, revolutionNumber: 2, cumulativeRep: 200 },
    ]);
    expect(splits[0]).toEqual({ revolutionNumber: 1, durationSec: 380, targetSec: 390, deltaSec: 10 });
    expect(splits[1].durationSec).toBe(410);
    expect(splits[1].deltaSec).toBe(-20);
  });

  it("uses reps in a partial final revolution for its target", () => {
    const odd: WorkoutPlan = { ...plan, setSize: 30 };
    const splits = revolutionSplits(odd, [
      { t: 100_000, revolutionNumber: 8, cumulativeRep: 960 },
      { t: 200_000, revolutionNumber: 9, cumulativeRep: 1000 },
    ]);
    expect(splits[1].targetSec).toBeCloseTo(156, 5);
  });

  it("computes set durations", () => {
    expect(
      setSplits([
        { t: 90_000, setNumber: 1, cumulativeRep: 25 },
        { t: 200_000, setNumber: 2, cumulativeRep: 50 },
      ]),
    ).toEqual([
      { setNumber: 1, durationSec: 90 },
      { setNumber: 2, durationSec: 110 },
    ]);
  });
});

describe("early and degenerate input", () => {
  it("reports zero rates before 10 s and no projection before 60 s", () => {
    const early = computePace(plan, evenReps(5, 1000), 5000, 180);
    expect(early.overallRpm).toBe(0);
    expect(early.rollingRpm).toBe(0);
    const mid = computePace(plan, evenReps(20, 2000), 40_000, 180);
    expect(mid.overallRpm).toBeCloseTo(30, 5);
    expect(mid.projectedFinishSec).toBeNull();
    expect(computePace(plan, evenReps(30, 2000), 60_000, 180).projectedFinishSec).not.toBeNull();
  });

  it("never returns NaN or Infinity for degenerate plans", () => {
    const bad: WorkoutPlan = { targetTimeSec: 0, setSize: 0, setsPerRevolution: 0, boxHeightIn: 20 };
    for (const reps of [0, 7, 1000]) {
      const snap = computePace(bad, evenReps(reps, 1000), reps * 1000, 180);
      for (const v of Object.values(snap)) if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
    }
  });
});
