import { describe, expect, it } from "vitest";
import { formatClock, formatDelta, isPlausibleTarget, parseClock } from "./format.ts";

describe("formatClock", () => {
  it("formats minutes and seconds", () => {
    expect(formatClock(3904)).toBe("65:04");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9)).toBe("0:09");
  });
  it("floors fractional seconds", () => {
    expect(formatClock(3725.4)).toBe("62:05");
    expect(formatClock(59.99)).toBe("0:59");
  });
  it("switches to hours at 100 minutes", () => {
    expect(formatClock(5999)).toBe("99:59");
    expect(formatClock(6125)).toBe("1:42:05");
  });
  it("clamps negatives", () => {
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("formatDelta", () => {
  it("signs values", () => {
    expect(formatDelta(22)).toBe("+0:22");
    expect(formatDelta(-75)).toBe("-1:15");
    expect(formatDelta(0)).toBe("+0:00");
  });
  it("rounds to nearest second", () => {
    expect(formatDelta(21.6)).toBe("+0:22");
    expect(formatDelta(-0.2)).toBe("+0:00");
  });
});

describe("parseClock", () => {
  it("parses mm:ss, bare minutes and h:mm:ss", () => {
    expect(parseClock("65:00")).toBe(3900);
    expect(parseClock("65")).toBe(3900);
    expect(parseClock(" 62:30 ")).toBe(3750);
    expect(parseClock("1:05:00")).toBe(3900);
  });
  it("parses colon-free digits typed on a numeric keypad", () => {
    expect(parseClock("5500")).toBe(3300);
    expect(parseClock("4530")).toBe(2730);
    expect(parseClock("10500")).toBe(3900);
    expect(parseClock("5560")).toBeNull();
  });
  it("rejects invalid input", () => {
    for (const bad of ["", "abc", "65:60", "-5", "1:2:3:4", "0", "0:00", "6.5", "65:", "1:5", "1:05:5", "1:5:00"]) {
      expect(parseClock(bad)).toBeNull();
    }
  });
});

describe("non-finite and plausibility", () => {
  it("renders placeholders for non-finite values", () => {
    for (const v of [NaN, Infinity, -Infinity]) {
      expect(formatClock(v)).toBe("--:--");
      expect(formatDelta(v)).toBe("--:--");
    }
  });
  it("checks plausible targets between 10 and 180 minutes", () => {
    expect(isPlausibleTarget(599)).toBe(false);
    expect(isPlausibleTarget(600)).toBe(true);
    expect(isPlausibleTarget(10800)).toBe(true);
    expect(isPlausibleTarget(10801)).toBe(false);
    expect(isPlausibleTarget(NaN)).toBe(false);
  });
});
