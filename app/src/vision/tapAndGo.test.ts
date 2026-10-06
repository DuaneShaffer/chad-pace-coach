import { describe, expect, it } from "vitest";
import { RepDetector } from "./repDetector.ts";
import { Scene } from "./synthPose.ts";
import type { PoseFrame } from "../types.ts";

const BOX = 1.1;
const calibration = { boxHeightTorso: BOX };

function openLoopCount(frames: PoseFrame[]): number {
  const detector = new RepDetector(calibration);
  return frames.reduce((n, f) => n + (detector.push(f)?.accepted ? 1 : 0), 0);
}

function adaptiveCount(frames: PoseFrame[]): number {
  const detector = new RepDetector(calibration);
  let lastProcessed = -Infinity;
  let counted = 0;
  for (const f of frames) {
    if (f.t - lastProcessed < (1000 / detector.suggestedFps) * 0.8) continue;
    lastProcessed = f.t;
    if (detector.push(f)?.accepted) counted++;
  }
  return counted;
}

describe("tap-and-go step-ups (lead foot down first, trail foot taps and goes)", () => {
  for (const fps of [10, 12, 15]) {
    for (const cadenceMs of [2500, 3500, 4500]) {
      for (const tapMs of [0, 60, 120, 200]) {
        it(`counts 25 reps at ${fps} fps, ${cadenceMs} ms cadence, ${tapMs} ms tap`, () => {
          const scene = new Scene({ seed: 1 + fps + tapMs, fps, jitterMs: 6, noise: 0.04 });
          scene.still(1500);
          scene.tapAndGo(25, BOX, { cadenceMs, tapMs, pauseMs: tapMs % 120 === 0 ? 0 : 400 });
          scene.still(1500);
          expect(openLoopCount(scene.frames)).toBe(25);
        });
      }
    }
  }

  it("counts exactly 300 reps in a tap-and-go session at the adaptive rate with pauses", () => {
    const scene = new Scene({ seed: 21, fps: 15, jitterMs: 6, noise: 0.04 });
    scene.still(2000);
    for (let set = 0; set < 12; set++) {
      scene.tapAndGo(25, BOX, { cadenceMs: 2500 + (set % 3) * 1000, tapMs: [0, 60, 120, 200][set % 4], pauseMs: 300 });
      scene.still(5000);
    }
    expect(adaptiveCount(scene.frames)).toBe(300);
  });

  it("does not count a one-footed tap-and-go that never reaches the box with both feet", () => {
    const scene = new Scene({ seed: 22, fps: 12, jitterMs: 6 });
    scene.still(1500);
    for (let i = 0; i < 10; i++) {
      scene.run(1800, (t) => ({ [i % 2 ? "lAnkle" : "rAnkle"]: BOX * Math.sin((Math.PI * t) / 1800), hip: 0.5 * BOX * Math.sin((Math.PI * t) / 1800) }));
    }
    scene.still(1500);
    expect(openLoopCount(scene.frames)).toBe(0);
  });
});
