import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types.ts";
import type { AudioMode, PaceSnapshot, Settings, WorkoutPlan, WorkoutRecord } from "../types.ts";
import { computePace, isRequiredPaceRealistic, revolutionSplits } from "./pacing.ts";
import { summarize } from "./stats.ts";
import { CoachScript } from "./coach.ts";
import { WorkoutSession } from "./session.ts";

const plan: WorkoutPlan = { targetTimeSec: 3900, setSize: 25, setsPerRevolution: 4, boxHeightIn: 20 };
const settingsFor = (audioMode: AudioMode): Settings => ({ ...DEFAULT_SETTINGS, audioMode });

function snapAt(elapsedSec: number, aheadSec: number): PaceSnapshot {
  const rate = 1000 / plan.targetTimeSec;
  const reps = Math.round(elapsedSec * rate + aheadSec * rate);
  const times = Array.from({ length: reps }, (_, i) => ((i + 1) / reps) * elapsedSec * 1000);
  return { ...computePace(plan, times, elapsedSec * 1000, 180), aheadSec };
}

function drive(mode: AudioMode, count: number) {
  const clock = { t: 0 };
  const session = new WorkoutSession(plan, "manual", () => clock.t);
  const coach = new CoachScript(plan, settingsFor(mode));
  session.start();
  const spoken: string[] = [];
  for (let i = 0; i < count; i++) {
    clock.t += 3900;
    const update = session.addRep();
    spoken.push(...coach.onUpdate(update, session.snapshot(settingsFor(mode))));
  }
  return spoken;
}

describe("onStart", () => {
  it("announces target", () => {
    expect(new CoachScript(plan, settingsFor("full")).onStart()).toEqual(["Go. Target 65 minutes."]);
  });
  it("is silent when audio is off", () => {
    expect(new CoachScript(plan, settingsFor("off")).onStart()).toEqual([]);
  });
});

describe("milestones", () => {
  it("speaks set boundaries and revolutions", () => {
    const spoken = drive("reps", 100);
    expect(spoken).toHaveLength(4);
    expect(spoken.slice(0, 3)).toEqual(["25.", "50.", "75."]);
    expect(spoken[3]).toBe("100. Revolution 1 done in 6 30.");
  });

  it("reps mode keeps the split free of pacing status", () => {
    const clock = { t: 0 };
    const session = new WorkoutSession(plan, "manual", () => clock.t);
    const coach = new CoachScript(plan, settingsFor("reps"));
    session.start();
    let spoken: string[] = [];
    for (let i = 0; i < 100; i++) {
      clock.t += 3840;
      spoken = coach.onUpdate(session.addRep(), session.snapshot(DEFAULT_SETTINGS));
    }
    expect(spoken[0]).toBe("100. Revolution 1 done in 6 24.");
  });

  it("announces halfway at 500", () => {
    const spoken = drive("reps", 500);
    expect(spoken.at(-1)).toMatch(/^500\. Halfway\. Revolution 5 done in/);
  });

  it("announces halfway for non-aligned set sizes", () => {
    const odd: WorkoutPlan = { ...plan, setSize: 30 };
    const coach = new CoachScript(odd, settingsFor("reps"));
    const snap = computePace(odd, [1000], 1000, 180);
    expect(coach.onUpdate({ rep: { t: 1000, cumulativeRep: 500, confidence: 1 } }, snap)).toEqual(["500. Halfway."]);
  });

  it("announces completion", () => {
    const coach = new CoachScript(plan, settingsFor("reps"));
    const snap = computePace(plan, Array(1000).fill(1), 3822_000, 180);
    const out = coach.onUpdate({ completed: true }, snap);
    expect(out).toEqual(["Chad complete. 63 minutes 42 seconds."]);
  });

  it("speaks only revolution splits in pace mode and nothing when off", () => {
    expect(drive("pace", 100)).toEqual(["Revolution 1, 6 30, on target."]);
    expect(drive("off", 100)).toEqual([]);
    const coach = new CoachScript(plan, settingsFor("off"));
    expect(coach.onUpdate({ completed: true }, snapAt(3800, 0))).toEqual([]);
  });

  it("ignores updates with no boundary", () => {
    const coach = new CoachScript(plan, settingsFor("full"));
    expect(coach.onUpdate({ rep: { t: 1, cumulativeRep: 7, confidence: 1 } }, snapAt(30, 0))).toEqual([]);
  });
});

describe("pace announcements", () => {
  it("never speaks in the first 60 seconds", () => {
    const coach = new CoachScript(plan, settingsFor("full"));
    expect(coach.onTick(snapAt(59, -100))).toEqual([]);
  });

  it("stays quiet below the quiet threshold", () => {
    const coach = new CoachScript(plan, settingsFor("full"));
    expect(coach.onTick(snapAt(300, 5))).toEqual([]);
    expect(coach.onTick(snapAt(300, -8))).toEqual([]);
  });

  it("is silent in reps and off modes", () => {
    expect(new CoachScript(plan, settingsFor("reps")).onTick(snapAt(300, -40))).toEqual([]);
    expect(new CoachScript(plan, settingsFor("off")).onTick(snapAt(300, -40))).toEqual([]);
  });

  it("rate-limits occasional announcements to ~3 minutes", () => {
    const coach = new CoachScript(plan, settingsFor("pace"));
    expect(coach.onTick(snapAt(300, 20))).toHaveLength(1);
    expect(coach.onTick(snapAt(400, 20))).toEqual([]);
    expect(coach.onTick(snapAt(479, 20))).toEqual([]);
    expect(coach.onTick(snapAt(481, 20))).toHaveLength(1);
  });

  it("speaks every ~90 seconds when prominent", () => {
    const coach = new CoachScript(plan, settingsFor("pace"));
    expect(coach.onTick(snapAt(300, 40))[0]).toMatch(/^You're 40 seconds ahead\.$/);
    expect(coach.onTick(snapAt(380, 40))).toEqual([]);
    expect(coach.onTick(snapAt(391, 40))).toHaveLength(1);
  });

  it("gives an explicit correction with required pace when far behind", () => {
    const coach = new CoachScript(plan, settingsFor("full"));
    const snap = { ...computePace(plan, Array(590).fill(1), 2400_000, 180), aheadSec: -65 };
    expect(coach.onTick(snap)).toEqual(["You're 1 minute 5 seconds behind. Required pace 16.4 per minute."]);
  });

  it("does not give a correction when far ahead", () => {
    const coach = new CoachScript(plan, settingsFor("full"));
    expect(coach.onTick(snapAt(600, 90))[0]).toBe("You're 1 minute 30 seconds ahead.");
  });

  it("does not stack on a recent milestone, then retries", () => {
    const coach = new CoachScript(plan, settingsFor("full"));
    const milestone = snapAt(300, 40);
    coach.onUpdate({ set: { t: 300_000, setNumber: 1, cumulativeRep: 25 } }, milestone);
    expect(coach.onTick(snapAt(304, 40))).toEqual([]);
    expect(coach.onTick(snapAt(309, 40))).toHaveLength(1);
  });

  it("stops once the workout is complete", () => {
    const coach = new CoachScript(plan, settingsFor("full"));
    expect(coach.onTick(computePace(plan, Array(1000).fill(1), 4000_000, 180))).toEqual([]);
  });
});

function revUpdate(durationSec: number, targetSec = 390, number = 1, rep = 100) {
  return {
    rev: {
      rep: { t: 0, cumulativeRep: rep, confidence: 1 },
      revolution: { t: 0, revolutionNumber: number, cumulativeRep: rep },
      revolutionDurationSec: durationSec,
      revolutionTargetSec: targetSec,
    },
  };
}

describe("revolution splits from session data", () => {
  it("uses the session-provided duration after undo and re-count", () => {
    const clock = { t: 0 };
    const session = new WorkoutSession(plan, "manual", () => clock.t);
    const coach = new CoachScript(plan, settingsFor("reps"));
    session.start();
    for (let i = 0; i < 100; i++) {
      clock.t += 3900;
      session.addRep();
    }
    session.removeLastRep();
    clock.t += 4000;
    const update = session.addRep();
    expect(update.revolutionDurationSec).toBeCloseTo(394, 5);
    expect(coach.onUpdate(update, session.snapshot(DEFAULT_SETTINGS))[0]).toBe("100. Revolution 1 done in 6 34.");
  });

  it("session reports duration relative to previous revolution and its target", () => {
    const clock = { t: 0 };
    const session = new WorkoutSession(plan, "manual", () => clock.t);
    session.start();
    let last = {} as ReturnType<typeof session.addRep>;
    for (let i = 0; i < 200; i++) {
      clock.t += i < 100 ? 3800 : 4000;
      last = session.addRep();
    }
    expect(last.revolutionDurationSec).toBeCloseTo(400, 5);
    expect(last.revolutionTargetSec).toBeCloseTo(390, 5);
  });

  it("says flat for whole-minute splits", () => {
    const coach = new CoachScript(plan, settingsFor("reps"));
    expect(coach.onUpdate(revUpdate(600).rev, snapAt(600, 0))[0]).toBe("100. Revolution 1 done in 10 minutes flat.");
  });

  it("uses the revolution's own delta in pace modes", () => {
    const ahead = new CoachScript(plan, settingsFor("full"));
    expect(ahead.onUpdate(revUpdate(384).rev, snapAt(384, -200))[0]).toBe(
      "100. Revolution 1, 6 24, 6 seconds under target.",
    );
    const behind = new CoachScript(plan, settingsFor("full"));
    expect(behind.onUpdate(revUpdate(400).rev, snapAt(400, 50))[0]).toBe(
      "100. Revolution 1, 6 40, 10 seconds over target.",
    );
    const exact = new CoachScript(plan, settingsFor("full"));
    expect(exact.onUpdate(revUpdate(390).rev, snapAt(390, 0))[0]).toContain("on target");
  });
});

describe("small set sizes", () => {
  const small: WorkoutPlan = { ...plan, setSize: 5, setsPerRevolution: 4 };
  const setUpdate = (n: number) => ({ set: { t: 0, setNumber: n / 5, cumulativeRep: n } });

  it("skips set milestones within 20 seconds of the last one", () => {
    const coach = new CoachScript(small, settingsFor("reps"));
    expect(coach.onUpdate(setUpdate(5), snapAt(30, 0))).toEqual(["5."]);
    expect(coach.onUpdate(setUpdate(10), snapAt(40, 0))).toEqual([]);
    expect(coach.onUpdate(setUpdate(15), snapAt(51, 0))).toEqual(["15."]);
  });

  it("always announces revolution numbers but drops short splits", () => {
    const coach = new CoachScript(small, settingsFor("reps"));
    coach.onUpdate(setUpdate(5), snapAt(30, 0));
    expect(coach.onUpdate(revUpdate(40, 40, 1, 20).rev, snapAt(45, 0))).toEqual(["20."]);
  });

  it("speaks a split only when 60 s have passed since the last revolution call", () => {
    const coach = new CoachScript(plan, settingsFor("reps"));
    expect(coach.onUpdate(revUpdate(90).rev, snapAt(100, 0))[0]).toBe("100. Revolution 1 done in 90 seconds.".replace("90 seconds", "1 30"));
    expect(coach.onUpdate(revUpdate(90, 390, 2, 200).rev, snapAt(130, 0))).toEqual(["200."]);
  });

  it("halfway and completion always speak", () => {
    const coach = new CoachScript(small, settingsFor("full"));
    coach.onUpdate(setUpdate(5), snapAt(30, 0));
    expect(coach.onUpdate({ rep: { t: 0, cumulativeRep: 500, confidence: 1 }, set: setUpdate(500).set }, snapAt(31, 0))).toEqual([
      "500. Halfway.",
    ]);
    expect(coach.onUpdate({ completed: true }, snapAt(32, 0))[0]).toMatch(/^Chad complete/);
  });
});

describe("occasional threshold", () => {
  const custom: Settings = {
    ...DEFAULT_SETTINGS,
    audioMode: "pace",
    paceQuietThresholdSec: 10,
    paceOccasionalThresholdSec: 25,
    paceProminentThresholdSec: 50,
  };

  it("stays silent between quiet and occasional thresholds", () => {
    const coach = new CoachScript(plan, custom);
    expect(coach.onTick(snapAt(300, 20))).toEqual([]);
    expect(coach.onTick(snapAt(300, 26))).toHaveLength(1);
  });

  it("uses 180 s below prominent and 90 s from prominent", () => {
    const coach = new CoachScript(plan, custom);
    coach.onTick(snapAt(300, 30));
    expect(coach.onTick(snapAt(400, 30))).toEqual([]);
    expect(coach.onTick(snapAt(481, 30))).toHaveLength(1);
    const prominent = new CoachScript(plan, custom);
    prominent.onTick(snapAt(300, 55));
    expect(prominent.onTick(snapAt(391, 55))).toHaveLength(1);
  });
});

describe("integrated QA fixes", () => {
  it("converts large target deltas to minutes", () => {
    const coach = new CoachScript(plan, settingsFor("full"));
    expect(coach.onUpdate(revUpdate(507).rev, snapAt(507, 0))[0]).toBe(
      "100. Revolution 1, 8 27, 1 minute 57 seconds over target.",
    );
  });

  it("derives spoken deltas from floored seconds like the displayed clock", () => {
    const coach = new CoachScript(plan, settingsFor("full"));
    expect(coach.onUpdate(revUpdate(398.9).rev, snapAt(400, 0))[0]).toBe("100. Revolution 1, 6 38, 8 seconds over target.");
  });

  it("deltas are computed from floored whole seconds", () => {
    const splits = revolutionSplits(plan, [{ t: 398_900, revolutionNumber: 1, cumulativeRep: 100 }]);
    expect(splits[0].deltaSec).toBe(-8);
    const rec = { ...baseRecord(), actualTimeSec: 4514.4 };
    expect(summarize(rec, []).deltaSec).toBe(3900 - 4514);
  });

  it("does not re-announce a milestone after an undo/redo", () => {
    const coach = new CoachScript(plan, settingsFor("reps"));
    const set = (n: number) => ({ set: { t: 0, setNumber: n / 25, cumulativeRep: n } });
    expect(coach.onUpdate(set(200), snapAt(600, 0))).toEqual(["200."]);
    expect(coach.onUpdate(set(200), snapAt(609, 0))).toEqual([]);
    expect(coach.onUpdate(set(225), snapAt(700, 0))).toEqual(["225."]);
  });

  it("speaks the revolution split in pace mode without a rep number", () => {
    const coach = new CoachScript(plan, settingsFor("pace"));
    expect(coach.onUpdate(revUpdate(384).rev, snapAt(384, 0))).toEqual(["Revolution 1, 6 24, 6 seconds under target."]);
    expect(coach.onUpdate({ set: { t: 0, setNumber: 5, cumulativeRep: 125 } }, snapAt(500, 0))).toEqual([]);
  });

  it("announces projected finish instead of unrealistic required pace", () => {
    const coach = new CoachScript(plan, settingsFor("full"));
    const times = Array.from({ length: 300 }, (_, i) => (i + 1) * 12_000);
    const snap = computePace(plan, times, 3600_000, 180);
    expect(snap.requiredRealistic).toBe(false);
    const [text] = coach.onTick(snap);
    expect(text).toMatch(/^On pace for \d+ minutes( \d+ seconds?)?\.$/);
    expect(coach.onTick({ ...snap, elapsedSec: snap.elapsedSec + 100 })).toEqual([]);
    expect(coach.onTick({ ...snap, elapsedSec: snap.elapsedSec + 181 })).toHaveLength(1);
  });

  it("after the target passes never says minutes behind every 90 s", () => {
    const coach = new CoachScript(plan, settingsFor("full"));
    const times = Array.from({ length: 900 }, (_, i) => (i + 1) * 4400);
    const snap = computePace(plan, times, 3960_000, 180);
    expect(snap.requiredRpm).toBeNull();
    expect(coach.onTick(snap)[0]).toMatch(/^On pace for/);
    expect(coach.onTick({ ...snap, elapsedSec: snap.elapsedSec + 91 })).toEqual([]);
  });

  it("keeps required pace when it is realistic", () => {
    const snap = computePace(plan, Array.from({ length: 590 }, (_, i) => (i + 1) * 4068), 2400_000, 180);
    expect(snap.requiredRealistic).toBe(true);
    expect(isRequiredPaceRealistic(30, 15, 15)).toBe(false);
    expect(isRequiredPaceRealistic(null, 15, 15)).toBe(false);
    expect(isRequiredPaceRealistic(20, 15, 15)).toBe(true);
  });
});

function baseRecord(): WorkoutRecord {
  return {
    id: "x",
    date: "2026-01-01T00:00:00.000Z",
    plan,
    actualTimeSec: 3900,
    totalReps: 1000,
    countingMode: "manual",
    reps: [],
    sets: [],
    revolutions: [],
  };
}
