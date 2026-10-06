import { describe, expect, it } from "vitest";
import type { WorkoutRecord } from "../types";
import { DEFAULT_TAGLINE, taglineFor } from "./splashTagline";

const rec = (actualTimeSec: number | null) => ({ actualTimeSec }) as WorkoutRecord;

describe("taglineFor", () => {
  it("uses the default with no history", () => {
    expect(taglineFor([])).toBe(DEFAULT_TAGLINE);
  });
  it("numbers the next Chad when nothing was completed", () => {
    expect(taglineFor([rec(null), rec(null)])).toBe("Chad #3");
  });
  it("reports the last completed time", () => {
    expect(taglineFor([rec(null), rec(3822), rec(3700)])).toBe("Last Chad 63:42. Beat it.");
  });
  it("calls out a PR", () => {
    expect(taglineFor([rec(3680), rec(3822)])).toBe("PR 61:20. Beat it.");
  });
  it("does not call a first completion a PR", () => {
    expect(taglineFor([rec(3680)])).toBe("Last Chad 61:20. Beat it.");
  });
});
