import { describe, expect, it } from "vitest";
import { RepDetector } from "./repDetector.ts";
import { realisticRep, Scene, smoothstep, STANDING } from "./synthPose.ts";
import type { FigureState } from "./synthPose.ts";
import type { PoseFrame } from "../types.ts";

const BOX = 1.1;
const calibration = { boxHeightTorso: BOX };
const CAPTURE_FPS = 15;

function openLoopCount(frames: PoseFrame[]): number {
  const detector = new RepDetector(calibration);
  return frames.reduce((n, f) => n + (detector.push(f)?.accepted ? 1 : 0), 0);
}

function adaptiveCount(frames: PoseFrame[]): { counted: number; processed: number; idleShare: number } {
  const detector = new RepDetector(calibration);
  let lastProcessed = -Infinity;
  let counted = 0;
  let processed = 0;
  let idle = 0;
  for (const f of frames) {
    if (f.t - lastProcessed < (1000 / detector.suggestedFps) * 0.8) continue;
    lastProcessed = f.t;
    processed += 1;
    if (detector.suggestedFps <= 8) idle += 1;
    if (detector.push(f)?.accepted) counted++;
  }
  return { counted, processed, idleShare: idle / processed };
}

function walkAround(scene: Scene, from: FigureState, to: FigureState): void {
  const lift = (t: number) =>
    (t / 500) % 2 < 1
      ? { rAnkle: 0.35 * Math.sin((Math.PI * (t % 500)) / 500) }
      : { lAnkle: 0.35 * Math.sin((Math.PI * (t % 500)) / 500) };
  scene.run(2500, (t) => ({ ...lift(t), x: 0.5 + 0.3 * smoothstep(t / 2500) }), from);
  scene.run(
    3000,
    (t) => ({
      ...lift(t),
      x: 0.8 - 0.3 * smoothstep(t / 3000),
      scale: from.scale + (to.scale - from.scale) * smoothstep(t / 3000),
    }),
    from,
  );
}

describe("detection at reduced frame rates", () => {
  for (const fps of [10, 12, 15]) {
    it(`counts 25 reps at a fixed ${fps} fps`, () => {
      const scene = new Scene({ seed: 3, fps, jitterMs: 6 });
      scene.still(1500);
      scene.reps(25, BOX);
      scene.still(1500);
      expect(openLoopCount(scene.frames)).toBe(25);
    });
  }

  it("counts reps at 12 fps with mixed lead feet and fast cadence", () => {
    const scene = new Scene({ seed: 4, fps: 12 });
    scene.still(1500);
    scene.reps(20, BOX, { activeMs: 2600, pauseMs: 150 });
    scene.still(1500);
    expect(openLoopCount(scene.frames)).toBe(20);
  });

  it("produces no phantom reps at 12 fps from bumps, swaps or jumps", () => {
    const scene = new Scene({ seed: 5, fps: 12 });
    scene.still(1500);
    scene.run(900, (t) => ({ globalDy: -0.16 * (t < 100 ? t / 100 : t < 800 ? 1 : (900 - t) / 100) }));
    scene.still(1500);
    scene.run(800, () => ({ floorDy: -0.18, x: 0.52 }));
    scene.still(1500);
    for (let i = 0; i < 4; i++) {
      scene.run(500, (t) => {
        const e = smoothstep(t / 500);
        return { lAnkle: BOX * e, rAnkle: BOX * e, hip: BOX * e };
      });
      scene.still(1200, { ...STANDING, lAnkle: BOX, rAnkle: BOX, hip: BOX });
      scene.run(700, (t) => {
        const e = 1 - smoothstep(t / 700);
        return { lAnkle: BOX * e, rAnkle: BOX * e, hip: BOX * e };
      });
      scene.still(800);
    }
    expect(openLoopCount(scene.frames)).toBe(0);
  });

  it("survives frame-rate switches between rests and sets", () => {
    const scene = new Scene({ seed: 6, fps: 14 });
    scene.still(1500);
    let expected = 0;
    for (let set = 0; set < 4; set++) {
      scene.setFps(14);
      scene.reps(8, BOX);
      expected += 8;
      scene.setFps(6);
      scene.still(6000);
      scene.setFps(set % 2 ? 14 : 10);
    }
    scene.still(1500);
    expect(openLoopCount(scene.frames)).toBe(expected);
  });
});

describe("closed-loop adaptive frame rate", () => {
  it("reports idle rates while resting and active rates during reps", () => {
    const scene = new Scene({ seed: 7, fps: CAPTURE_FPS });
    const detector = new RepDetector(calibration);
    scene.still(4000);
    scene.frames.forEach((f) => detector.push(f));
    expect(detector.suggestedFps).toBeLessThanOrEqual(8);
    const rep = new Scene({ seed: 8, fps: CAPTURE_FPS });
    rep.t = scene.t;
    rep.run(1500, (t) => realisticRep(t, BOX, "l", 3700));
    rep.frames.forEach((f) => detector.push(f));
    expect(detector.suggestedFps).toBeGreaterThanOrEqual(14);
    const gap = new Scene({ seed: 9, fps: CAPTURE_FPS });
    gap.t = rep.t;
    gap.missing(1000);
    gap.frames.forEach((f) => detector.push(f));
    expect(detector.phase).toBe("lost");
    expect(detector.suggestedFps).toBeLessThanOrEqual(5);
  });

  it("counts every rep when throttled by the detector's own rate hint", () => {
    const scene = new Scene({ seed: 10, fps: CAPTURE_FPS, jitterMs: 5 });
    scene.still(2000);
    for (let set = 0; set < 3; set++) {
      scene.reps(25, BOX);
      scene.still(8000);
    }
    const result = adaptiveCount(scene.frames);
    expect(result.counted).toBe(75);
    expect(result.idleShare).toBeGreaterThan(0.01);
  });

  it("counts exactly 100 reps over four sets with walks between them", () => {
    const scene = new Scene({ seed: 11, fps: CAPTURE_FPS, jitterMs: 5 });
    let base: FigureState = STANDING;
    scene.still(2000, base);
    for (let set = 0; set < 4; set++) {
      scene.reps(25, BOX, { base, pauseMs: 250 });
      const next: FigureState = set % 2 ? STANDING : { ...STANDING, scale: 0.8 };
      walkAround(scene, base, next);
      base = next;
      scene.still(4000, base);
    }
    scene.still(1000, base);
    expect(adaptiveCount(scene.frames).counted).toBe(100);
  });

  it("produces no phantom reps while throttled", () => {
    const scene = new Scene({ seed: 12, fps: CAPTURE_FPS });
    scene.still(5000);
    scene.run(1200, (t) => ({ globalDy: -0.2 * (t < 100 ? t / 100 : t < 1100 ? 1 : (1200 - t) / 100) }));
    scene.still(5000);
    walkAround(scene, STANDING, { ...STANDING, scale: 0.8 });
    scene.still(5000, { ...STANDING, scale: 0.8 });
    for (let i = 0; i < 5; i++) scene.run(2000, (t) => ({ hip: -0.8 * Math.sin((Math.PI * t) / 2000) }), { ...STANDING, scale: 0.8 });
    scene.still(5000, { ...STANDING, scale: 0.8 });
    expect(adaptiveCount(scene.frames).counted).toBe(0);
  });
});
