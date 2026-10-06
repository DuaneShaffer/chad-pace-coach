import { describe, expect, it } from "vitest";
import { openLatch, showStartAnyway, startEnabled, updateLatch } from "./startLatch.ts";

describe("start latch", () => {
  it("stays disabled until the checks pass once, then stays enabled", () => {
    let latch = openLatch(0);
    expect(startEnabled(latch)).toBe(false);
    latch = updateLatch(latch, false);
    expect(startEnabled(latch)).toBe(false);
    latch = updateLatch(latch, true);
    expect(startEnabled(latch)).toBe(true);
    latch = updateLatch(latch, false);
    expect(startEnabled(latch)).toBe(true);
  });

  it("offers Start anyway only after the wait and only while not latched", () => {
    const latch = openLatch(1000);
    expect(showStartAnyway(latch, 5000)).toBe(false);
    expect(showStartAnyway(latch, 9000)).toBe(true);
    expect(showStartAnyway(updateLatch(latch, true), 20000)).toBe(false);
  });
});
