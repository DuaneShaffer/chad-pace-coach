import { describe, expect, it } from "vitest";
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
