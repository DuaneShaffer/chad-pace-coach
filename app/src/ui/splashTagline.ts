import type { WorkoutRecord } from "../types";
import { formatClock } from "../core/format";

export const DEFAULT_TAGLINE = "Put your phone down. Let it coach you through Chad.";

export function taglineFor(newestFirst: readonly WorkoutRecord[]): string {
  if (newestFirst.length === 0) return DEFAULT_TAGLINE;
  const completed = newestFirst.filter((r) => r.actualTimeSec !== null);
  const [latest, ...earlier] = completed;
  if (!latest) return `Chad #${newestFirst.length + 1}`;
  const time = latest.actualTimeSec!;
  const isPr = earlier.length > 0 && earlier.every((r) => time < r.actualTimeSec!);
  return `${isPr ? "PR" : "Last Chad"} ${formatClock(time)}. Beat it.`;
}
