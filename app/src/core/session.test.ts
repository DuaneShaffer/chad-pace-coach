import { describe, expect, it } from "vitest";
import { revolutionSplits, setSplits } from "./pacing.ts";
import { summarize } from "./stats.ts";
import { DEFAULT_SETTINGS } from "../types.ts";
import type { WorkoutPlan } from "../types.ts";
import { WorkoutSession } from "./session.ts";

const plan: WorkoutPlan = { targetTimeSec: 3900, setSize: 25, setsPerRevolution: 4, boxHeightIn: 20 };

function setup(p: WorkoutPlan = plan) {
  const clock = { t: 1000 };
  const session = new WorkoutSession(p, "manual", () => clock.t);
  return { clock, session };
}

describe("WorkoutSession", () => {
  it("measures elapsed time from start", () => {
    const { clock, session } = setup();
    expect(session.elapsedMs()).toBe(0);
    session.start();
    clock.t += 5000;
    expect(session.elapsedMs()).toBe(5000);
    expect(session.started).toBe(true);
  });

  it("stamps retroactive reps with their own times, in order and never in the future", () => {
    const { clock, session } = setup();
    session.start();
    clock.t += 10000;
    expect(session.addRep(1, 4000).rep?.t).toBe(4000);
    expect(session.addRep(1, 2000).rep?.t).toBe(4000);
    expect(session.addRep(1, 99000).rep?.t).toBe(10000);
  });

  it("emits set events every 25 reps and a revolution at 100", () => {
    const { clock, session } = setup();
    session.start();
    const updates = Array.from({ length: 100 }, () => {
      clock.t += 1000;
      return session.addRep();
    });
    const sets = updates.filter((u) => u.set).map((u) => u.set!.cumulativeRep);
    expect(sets).toEqual([25, 50, 75, 100]);
    const revs = updates.filter((u) => u.revolution);
    expect(revs).toHaveLength(1);
    expect(revs[0].revolution).toEqual({ t: 100_000, revolutionNumber: 1, cumulativeRep: 100 });
    expect(updates[99].set!.setNumber).toBe(4);
  });

  it("completes at 1000, freezes time and ignores further reps", () => {
    const { clock, session } = setup();
    session.start();
    let last = {};
    for (let i = 0; i < 1000; i++) {
      clock.t += 3000;
      last = session.addRep();
    }
    expect(last).toMatchObject({ completed: true, revolution: { revolutionNumber: 10 } });
    expect(session.completed).toBe(true);
    clock.t += 99_999;
    expect(session.elapsedMs()).toBe(3_000_000);
    expect(session.addRep()).toEqual({});
    expect(session.reps()).toBe(1000);
    const record = session.toRecord();
    expect(record.actualTimeSec).toBe(3000);
    expect(record.sets).toHaveLength(40);
    expect(record.revolutions).toHaveLength(10);
  });

  it("emits a final partial set/revolution when sizes do not divide 1000", () => {
    const { clock, session } = setup({ ...plan, setSize: 30 });
    session.start();
    const updates = Array.from({ length: 1000 }, () => {
      clock.t += 1000;
      return session.addRep();
    });
    expect(updates[999].set).toMatchObject({ cumulativeRep: 1000, setNumber: 34 });
    expect(updates[999].revolution).toMatchObject({ revolutionNumber: 9 });
    expect(updates[119].revolution).toMatchObject({ revolutionNumber: 1 });
  });

  it("removes the last rep along with later boundary events", () => {
    const { clock, session } = setup();
    session.start();
    for (let i = 0; i < 100; i++) {
      clock.t += 1000;
      session.addRep();
    }
    session.removeLastRep();
    expect(session.reps()).toBe(99);
    const record = session.toRecord();
    expect(record.sets.map((s) => s.cumulativeRep)).toEqual([25, 50, 75]);
    expect(record.revolutions).toHaveLength(0);
    clock.t += 1000;
    expect(session.addRep().revolution?.cumulativeRep).toBe(100);
  });

  it("is safe to remove from an empty session", () => {
    const { session } = setup();
    session.removeLastRep();
    expect(session.reps()).toBe(0);
  });

  it("returns a pace snapshot", () => {
    const { clock, session } = setup();
    session.start();
    for (let i = 0; i < 30; i++) {
      clock.t += 2000;
      session.addRep();
    }
    const snap = session.snapshot(DEFAULT_SETTINGS);
    expect(snap.reps).toBe(30);
    expect(snap.elapsedSec).toBe(60);
    expect(snap.repsIntoSet).toBe(5);
  });

  it("builds a record for an abandoned workout", () => {
    const { clock, session } = setup();
    session.start();
    clock.t += 1000;
    session.addRep(0.9);
    const record = session.toRecord();
    expect(record.actualTimeSec).toBeNull();
    expect(record.totalReps).toBe(1);
    expect(record.countingMode).toBe("manual");
    expect(record.reps[0].confidence).toBe(0.9);
    expect(record.id).toBeTruthy();
  });

  it("survives a degenerate plan", () => {
    const { clock, session } = setup({ targetTimeSec: 0, setSize: 0, setsPerRevolution: 0, boxHeightIn: 20 });
    session.start();
    clock.t += 1000;
    expect(session.addRep().revolution).toBeDefined();
    expect(Number.isFinite(session.snapshot(DEFAULT_SETTINGS).aheadSec)).toBe(true);
  });

  it("uses the wall clock date when recorded before start", () => {
    const { session } = setup();
    const before = Date.now();
    const date = Date.parse(session.toRecord().date);
    expect(date).toBeGreaterThanOrEqual(before);
    expect(date).toBeLessThanOrEqual(Date.now());
  });
});

describe("bulk entries", () => {
  it("logs +25 forty times with evenly spread timestamps", () => {
    const { clock, session } = setup();
    session.start();
    for (let i = 0; i < 40; i++) {
      clock.t += 100_000;
      const updates = session.addReps(25);
      expect(updates).toHaveLength(25);
      expect(updates[24].set?.cumulativeRep).toBe((i + 1) * 25);
      expect(updates.slice(0, 24).every((u) => !u.set)).toBe(true);
    }
    expect(session.completed).toBe(true);
    const record = session.toRecord();
    expect(record.totalReps).toBe(1000);
    expect(record.actualTimeSec).toBe(4000);
    expect(record.reps[0].t).toBe(4000);
    expect(record.reps[1].t - record.reps[0].t).toBeCloseTo(4000, 5);
    expect(record.sets).toHaveLength(40);
    expect(setSplits(record.sets).every((s) => s.durationSec === 100)).toBe(true);
    expect(record.revolutions).toHaveLength(10);
    expect(revolutionSplits(plan, record.revolutions).every((r) => r.durationSec === 400)).toBe(true);
    expect(summarize(record, []).fastestRevSec).toBe(400);
  });

  it("logs +100 ten times and keeps pace stats meaningful", () => {
    const { clock, session } = setup();
    session.start();
    let last: ReturnType<typeof session.addReps> = [];
    for (let i = 0; i < 3; i++) {
      clock.t += 380_000;
      last = session.addReps(100);
    }
    expect(last[99].revolution).toMatchObject({ revolutionNumber: 3, cumulativeRep: 300 });
    expect(last[99].revolutionDurationSec).toBe(380);
    const snap = session.snapshot(DEFAULT_SETTINGS);
    expect(snap.reps).toBe(300);
    expect(snap.overallRpm).toBeCloseTo(300 / 19, 5);
    expect(snap.projectedFinishSec).not.toBeNull();
    expect(snap.rollingRpm).toBeGreaterThan(15);
  });

  it("mixes single and bulk entries", () => {
    const { clock, session } = setup();
    session.start();
    clock.t += 1000;
    session.addRep();
    clock.t += 24_000;
    const updates = session.addReps(24);
    expect(updates[23].set?.cumulativeRep).toBe(25);
    expect(session.toRecord().reps[1].t).toBeCloseTo(1000 + 24_000 / 24, 5);
  });

  it("clamps at 1000 and completes", () => {
    const { clock, session } = setup({ ...plan, setSize: 7, setsPerRevolution: 4 });
    session.start();
    clock.t += 1000;
    session.addReps(995);
    clock.t += 1000;
    const updates = session.addReps(28);
    expect(updates).toHaveLength(5);
    expect(updates[4]).toMatchObject({ completed: true, set: { cumulativeRep: 1000 }, revolution: { cumulativeRep: 1000 } });
    expect(session.reps()).toBe(1000);
    expect(session.addReps(5)).toEqual([]);
    expect(session.addReps(0)).toEqual([]);
  });

  it("undoes the last entry across a revolution boundary", () => {
    const { clock, session } = setup();
    session.start();
    clock.t += 100_000;
    session.addReps(100);
    clock.t += 50_000;
    session.addReps(50);
    session.undoLastEntry();
    expect(session.reps()).toBe(100);
    session.undoLastEntry();
    expect(session.reps()).toBe(0);
    const record = session.toRecord();
    expect(record.sets).toHaveLength(0);
    expect(record.revolutions).toHaveLength(0);
    session.undoLastEntry();
    expect(session.reps()).toBe(0);
  });

  it("drops only the events past the new count", () => {
    const { clock, session } = setup();
    session.start();
    clock.t += 1000;
    session.addReps(75);
    clock.t += 1000;
    session.addReps(25);
    session.undoLastEntry();
    const record = session.toRecord();
    expect(record.sets.map((s) => s.cumulativeRep)).toEqual([25, 50, 75]);
    expect(record.revolutions).toHaveLength(0);
  });

  it("un-completes when undoing the final entry", () => {
    const { clock, session } = setup();
    session.start();
    clock.t += 1000;
    session.addReps(900);
    clock.t += 1000;
    session.addReps(100);
    expect(session.completed).toBe(true);
    session.undoLastEntry();
    expect(session.completed).toBe(false);
    expect(session.reps()).toBe(900);
    clock.t += 5000;
    expect(session.elapsedMs()).toBe(7000);
    expect(session.addReps(100)).toHaveLength(100);
  });

  it("removeLastRep inside a bulk entry shrinks that entry for undo", () => {
    const { clock, session } = setup();
    session.start();
    clock.t += 1000;
    session.addReps(25);
    session.removeLastRep();
    session.undoLastEntry();
    expect(session.reps()).toBe(0);
  });
});
