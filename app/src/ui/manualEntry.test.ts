import { describe, expect, it } from "vitest";
import { entryOptions } from "./manualEntry.ts";
import type { WorkoutPlan } from "../types.ts";

const plan: WorkoutPlan = { targetTimeSec: 3900, setSize: 25, setsPerRevolution: 4, boxHeightIn: 20 };

describe("entryOptions", () => {
  it("offers one set and one revolution", () => {
    expect(entryOptions(plan, 0).map((o) => o.label)).toEqual(["+25", "+100"]);
  });

  it("offers a single button when a revolution is one set", () => {
    expect(entryOptions({ ...plan, setsPerRevolution: 1 }, 0).map((o) => o.label)).toEqual(["+25"]);
  });

  it("clamps to the reps remaining", () => {
    expect(entryOptions(plan, 980).map((o) => o.label)).toEqual(["+20"]);
    expect(entryOptions(plan, 910).map((o) => o.label)).toEqual(["+25", "+90"]);
    expect(entryOptions(plan, 999).map((o) => o.count)).toEqual([1]);
  });

  it("offers nothing once complete", () => {
    expect(entryOptions(plan, 1000)).toEqual([]);
  });
});
