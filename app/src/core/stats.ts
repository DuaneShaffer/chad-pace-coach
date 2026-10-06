import type { RepEvent, WorkoutRecord } from "../types.ts";
import { repsPerRevolution } from "../types.ts";
import { normalizePlan, revolutionSplits } from "./pacing.ts";

export interface WorkoutSummary {
  timeSec: number;
  targetSec: number;
  deltaSec: number | null;
  avgRpm: number;
  revolutions: number;
  fastestRevSec: number | null;
  slowestRevSec: number | null;
  isPR: boolean;
}

export function summarize(record: WorkoutRecord, history: WorkoutRecord[]): WorkoutSummary {
  const lastRep = record.reps[record.reps.length - 1];
  const timeSec = record.actualTimeSec ?? (lastRep ? lastRep.t / 1000 : 0);
  const targetSec = record.plan.targetTimeSec;
  const perRev = repsPerRevolution(normalizePlan(record.plan));
  const durations = revolutionSplits(record.plan, record.revolutions)
    .filter((_, i) => record.revolutions[i].cumulativeRep - (record.revolutions[i - 1]?.cumulativeRep ?? 0) >= perRev)
    .map((s) => s.durationSec);

  const isPR =
    record.actualTimeSec !== null &&
    history
      .filter((h) => h.id !== record.id && h.actualTimeSec !== null)
      .every((h) => record.actualTimeSec! < h.actualTimeSec!);

  return {
    timeSec,
    targetSec,
    deltaSec: record.actualTimeSec === null ? null : Math.floor(targetSec) - Math.floor(timeSec),
    avgRpm: timeSec > 0 ? record.totalReps / (timeSec / 60) : 0,
    revolutions: record.revolutions.length,
    fastestRevSec: durations.length ? Math.min(...durations) : null,
    slowestRevSec: durations.length ? Math.max(...durations) : null,
    isPR,
  };
}

export function ghostDeltaSec(current: RepEvent[], previous: RepEvent[], rep: number): number | null {
  const cur = current.find((r) => r.cumulativeRep === rep);
  const prev = previous.find((r) => r.cumulativeRep === rep);
  if (!cur || !prev) return null;
  return (prev.t - cur.t) / 1000;
}
