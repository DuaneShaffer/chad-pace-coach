import { TOTAL_REPS } from "../types.ts";
import type { WorkoutPlan } from "../types.ts";
import { repsPerRevolution } from "../types.ts";

export interface EntryOption {
  count: number;
  label: string;
}

export function entryOptions(plan: WorkoutPlan, reps: number): EntryOption[] {
  const remaining = TOTAL_REPS - reps;
  if (remaining <= 0) return [];
  const set = Math.min(plan.setSize, remaining);
  const revolution = Math.min(repsPerRevolution(plan), remaining);
  const counts = revolution > set ? [set, revolution] : [set];
  return counts.map((count) => ({ count, label: `+${count}` }));
}
