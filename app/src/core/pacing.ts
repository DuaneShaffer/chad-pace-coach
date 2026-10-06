import { TOTAL_REPS, repsPerRevolution } from "../types.ts";
import type { PaceSnapshot, RevolutionEvent, RevolutionSplit, SetEvent, WorkoutPlan } from "../types.ts";

const MIN_RATE_SEC = 10;
const MIN_PROJECTION_SEC = 60;

const REALISTIC_PACE_FACTOR = 1.5;

export function isRequiredPaceRealistic(requiredRpm: number | null, rollingRpm: number, overallRpm: number): boolean {
  if (requiredRpm === null) return false;
  const paceRpm = rollingRpm > 0 ? rollingRpm : overallRpm;
  return paceRpm <= 0 || requiredRpm <= paceRpm * REALISTIC_PACE_FACTOR;
}

export function normalizePlan(plan: WorkoutPlan): WorkoutPlan {
  const atLeast = (n: number, min: number) => (Number.isFinite(n) ? Math.max(min, n) : min);
  return {
    ...plan,
    targetTimeSec: atLeast(plan.targetTimeSec, 60),
    setSize: Math.floor(atLeast(plan.setSize, 1)),
    setsPerRevolution: Math.floor(atLeast(plan.setsPerRevolution, 1)),
  };
}

export function computePace(
  rawPlan: WorkoutPlan,
  repTimesMs: number[],
  elapsedMs: number,
  rollingWindowSec: number,
): PaceSnapshot {
  const plan = normalizePlan(rawPlan);
  const reps = Math.min(repTimesMs.length, TOTAL_REPS);
  const elapsedSec = Math.max(0, elapsedMs / 1000);
  const remainingReps = TOTAL_REPS - reps;
  const targetRepsPerSec = TOTAL_REPS / plan.targetTimeSec;
  const expectedReps = elapsedSec * targetRepsPerSec;
  const aheadSec = (reps - expectedReps) / targetRepsPerSec;

  const remainingTargetSec = plan.targetTimeSec - elapsedSec;
  const requiredRpm = remainingTargetSec > 0 ? remainingReps / (remainingTargetSec / 60) : null;

  const overallRpm = elapsedSec >= MIN_RATE_SEC ? reps / (elapsedSec / 60) : 0;
  const windowSec = Math.min(rollingWindowSec, elapsedSec);
  const windowStartMs = elapsedMs - rollingWindowSec * 1000;
  const repsInWindow = repTimesMs.slice(0, reps).filter((t) => t > windowStartMs).length;
  const rollingRpm = elapsedSec >= MIN_RATE_SEC && windowSec > 0 ? repsInWindow / (windowSec / 60) : 0;

  const paceRpm = rollingRpm > 0 ? rollingRpm : overallRpm;
  let projectedFinishSec: number | null = null;
  if (remainingReps === 0) projectedFinishSec = elapsedSec;
  else if (elapsedSec >= MIN_PROJECTION_SEC && paceRpm > 0) projectedFinishSec = elapsedSec + remainingReps / (paceRpm / 60);

  const perRev = repsPerRevolution(plan);
  const totalRevolutions = Math.ceil(TOTAL_REPS / perRev);
  const done = remainingReps === 0;
  const revolution = done ? totalRevolutions : Math.floor(reps / perRev) + 1;
  const revolutionStartRep = (revolution - 1) * perRev;
  const repsIntoRevolution = reps - revolutionStartRep;
  const setInRevolution = done
    ? Math.ceil(repsIntoRevolution / plan.setSize)
    : Math.floor(repsIntoRevolution / plan.setSize) + 1;
  const repsIntoSet = repsIntoRevolution - (setInRevolution - 1) * plan.setSize;
  const revolutionStartSec = revolutionStartRep > 0 ? (repTimesMs[revolutionStartRep - 1] ?? 0) / 1000 : 0;
  const repsInThisRevolution = Math.min(perRev, TOTAL_REPS - revolutionStartRep);

  return {
    elapsedSec,
    reps,
    remainingReps,
    targetRepsPerSec,
    expectedReps,
    aheadSec,
    requiredRpm,
    requiredRealistic: isRequiredPaceRealistic(requiredRpm, rollingRpm, overallRpm),
    overallRpm,
    rollingRpm,
    projectedFinishSec,
    revolution,
    totalRevolutions,
    repsIntoRevolution,
    repsPerRevolution: perRev,
    setInRevolution,
    repsIntoSet,
    revolutionElapsedSec: Math.max(0, elapsedSec - revolutionStartSec),
    targetRevolutionSec: (plan.targetTimeSec * repsInThisRevolution) / TOTAL_REPS,
  };
}

export function revolutionSplits(rawPlan: WorkoutPlan, revolutions: RevolutionEvent[]): RevolutionSplit[] {
  const plan = normalizePlan(rawPlan);
  let prevT = 0;
  let prevRep = 0;
  return revolutions.map((rev) => {
    const durationSec = (rev.t - prevT) / 1000;
    const targetSec = (plan.targetTimeSec * (rev.cumulativeRep - prevRep)) / TOTAL_REPS;
    prevT = rev.t;
    prevRep = rev.cumulativeRep;
    return { revolutionNumber: rev.revolutionNumber, durationSec, targetSec, deltaSec: Math.floor(targetSec) - Math.floor(durationSec) };
  });
}

export function setSplits(sets: SetEvent[]): { setNumber: number; durationSec: number }[] {
  let prevT = 0;
  return sets.map((set) => {
    const durationSec = (set.t - prevT) / 1000;
    prevT = set.t;
    return { setNumber: set.setNumber, durationSec };
  });
}
