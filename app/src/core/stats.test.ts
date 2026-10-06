import { describe, expect, it } from "vitest";
import type { RepEvent, WorkoutPlan, WorkoutRecord } from "../types.ts";
import { ghostDeltaSec, summarize } from "./stats.ts";

const plan: WorkoutPlan = { targetTimeSec: 3900, setSize: 25, setsPerRevolution: 4, boxHeightIn: 20 };

function record(id: string, actualTimeSec: number | null, revTimesSec: number[] = []): WorkoutRecord {
  return {
    id,
    date: "2026-01-01T00:00:00.000Z",
    plan,
    actualTimeSec,
    totalReps: actualTimeSec === null ? 500 : 1000,
    countingMode: "manual",
    reps: [],
    sets: [],
    revolutions: revTimesSec.map((t, i) => ({ t: t * 1000, revolutionNumber: i + 1, cumulativeRep: (i + 1) * 100 })),
  };
}

describe("summarize", () => {
  it("summarizes a completed workout", () => {
    const s = summarize(record("a", 3800, [380, 790, 1160]), []);
    expect(s.timeSec).toBe(3800);
    expect(s.deltaSec).toBe(100);
    expect(s.avgRpm).toBeCloseTo(1000 / (3800 / 60), 5);
    expect(s.revolutions).toBe(3);
    expect(s.fastestRevSec).toBe(370);
    expect(s.slowestRevSec).toBe(410);
  });

  it("excludes a partial final revolution from fastest/slowest", () => {
    const rec = record("a", 3800, [380, 790]);
    rec.revolutions.push({ t: 800_000, revolutionNumber: 3, cumulativeRep: 240 });
    const s = summarize(rec, []);
    expect(s.revolutions).toBe(3);
    expect(s.fastestRevSec).toBe(380);
    expect(s.slowestRevSec).toBe(410);
    const onlyPartial = record("b", 3800);
    onlyPartial.revolutions.push({ t: 50_000, revolutionNumber: 1, cumulativeRep: 40 });
    expect(summarize(onlyPartial, []).fastestRevSec).toBeNull();
  });

  it("has null delta when abandoned", () => {
    expect(summarize(record("a", null), []).deltaSec).toBeNull();
  });

  it("returns null rev extremes without revolutions", () => {
    const s = summarize(record("a", 3800), []);
    expect(s.fastestRevSec).toBeNull();
    expect(s.slowestRevSec).toBeNull();
  });

  it("flags a PR when faster than all other completed records", () => {
    const history = [record("b", 3900), record("c", null), record("d", 4000)];
    expect(summarize(record("a", 3800), history).isPR).toBe(true);
    expect(summarize(record("a", 3950), history).isPR).toBe(false);
  });

  it("excludes itself from history and is not a PR on a tie", () => {
    const self = record("a", 3800);
    expect(summarize(self, [self]).isPR).toBe(true);
    expect(summarize(self, [record("b", 3800)]).isPR).toBe(false);
  });

  it("is never a PR when abandoned", () => {
    const s = summarize(record("a", null), []);
    expect(s.isPR).toBe(false);
    expect(s.timeSec).toBe(0);
  });
});

describe("ghostDeltaSec", () => {
  const ev = (n: number, t: number): RepEvent => ({ t, cumulativeRep: n, confidence: 1 });
  it("is positive when current is ahead of previous", () => {
    expect(ghostDeltaSec([ev(10, 40_000)], [ev(10, 62_000)], 10)).toBe(22);
    expect(ghostDeltaSec([ev(10, 70_000)], [ev(10, 62_000)], 10)).toBe(-8);
  });
  it("returns null when either run lacks the rep", () => {
    expect(ghostDeltaSec([ev(10, 1)], [], 10)).toBeNull();
    expect(ghostDeltaSec([], [ev(10, 1)], 10)).toBeNull();
  });
});
