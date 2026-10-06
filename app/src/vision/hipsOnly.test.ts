import { describe, expect, it } from "vitest";
import { RepDetector } from "./repDetector.ts";
import { Scene, STANDING, smoothstep } from "./synthPose.ts";
import type { FigureState } from "./synthPose.ts";
import type { Calibration, PoseFrame, RepCandidate } from "../types.ts";

const CROPPED: FigureState = { ...STANDING, lAnkleVisibility: 0.1, rAnkleVisibility: 0.1 };

function accepted(frames: PoseFrame[], calibration: Calibration | null, fps?: number): RepCandidate[] {
  const detector = new RepDetector(calibration);
  let last = -Infinity;
  return frames.flatMap((f) => {
    if (fps && f.t - last < (1000 / detector.suggestedFps) * 0.8) return [];
    last = f.t;
    return detector.pushAll(f);
  }).filter((c) => c.accepted);
}

const SURFACES: [string, number, number][] = [
  ["couch with sag", 0.35, 0.1],
  ["stair", 0.55, 0],
  ["standard box", 1.0, 0],
  ["high box", 1.5, 0],
];

describe("counting by hips when the feet are out of frame", () => {
  for (const [name, height, sag] of SURFACES) {
    it(`counts 20 reps on a ${name} with calibration`, () => {
      const scene = new Scene({ seed: 51 });
      scene.still(1500, CROPPED);
      scene.reps(20, height, { base: CROPPED, sag, pauseMs: 250 });
      scene.still(1500, CROPPED);
      expect(accepted(scene.frames, { boxHeightTorso: height })).toHaveLength(20);
    });

    it(`learns a ${name} and counts all 25 reps in order`, () => {
      const scene = new Scene({ seed: 52 });
      scene.still(1500, CROPPED);
      scene.reps(25, height, { base: CROPPED, sag, pauseMs: 250 });
      scene.still(1500, CROPPED);
      const counted = accepted(scene.frames, null);
      expect(counted).toHaveLength(25);
      const times = counted.map((c) => c.t);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });
  }

  for (const fps of [10, 12, 15]) {
    it(`counts 25 tap-and-go reps at ${fps} fps`, () => {
      const scene = new Scene({ seed: 53, fps, jitterMs: 6 });
      scene.still(1500, CROPPED);
      scene.tapAndGo(25, 1.0, { cadenceMs: 3000, tapMs: 60, pauseMs: 200 }, CROPPED);
      scene.still(1500, CROPPED);
      expect(accepted(scene.frames, { boxHeightTorso: 1.0 })).toHaveLength(25);
    });
  }

  it("counts 75 reps through the adaptive frame-rate hint", () => {
    const scene = new Scene({ seed: 54, fps: 15, jitterMs: 5 });
    scene.still(2000, CROPPED);
    for (let set = 0; set < 3; set++) {
      scene.reps(25, 0.8, { base: CROPPED, pauseMs: 250 });
      scene.still(6000, CROPPED);
    }
    expect(accepted(scene.frames, null, 15)).toHaveLength(75);
  });

  it("switches between ankle and hip counting as the feet go in and out of frame", () => {
    const scene = new Scene({ seed: 55 });
    scene.still(1500);
    for (let block = 0; block < 8; block++) {
      const base = block % 2 ? CROPPED : STANDING;
      scene.reps(5, 1.0, { base, pauseMs: 300 });
      scene.still(1500, base);
    }
    expect(accepted(scene.frames, { boxHeightTorso: 1.0 })).toHaveLength(40);
  });

  it("reports the counting mode", () => {
    const scene = new Scene({ seed: 56 });
    scene.still(1500);
    const detector = new RepDetector({ boxHeightTorso: 1.0 });
    scene.frames.forEach((f) => detector.pushAll(f));
    expect(detector.diagnostic).toBe("");
    const blind = new Scene({ seed: 57 });
    blind.t = scene.t;
    blind.still(2000, CROPPED);
    blind.frames.forEach((f) => detector.pushAll(f));
    expect(detector.diagnostic).toBe("Counting by hips (feet not visible)");
  });
});

describe("hips-only phantom protection", () => {
  for (const calibration of [null, { boxHeightTorso: 1.0 }, { boxHeightTorso: 0.4 }] as (Calibration | null)[]) {
    const label = calibration ? `calibrated ${calibration.boxHeightTorso}` : "learning";
    const run = (name: string, build: (s: Scene) => void) =>
      it(`counts nothing for ${name} with feet cropped (${label})`, () => {
        const scene = new Scene({ seed: 61 });
        scene.still(1500, CROPPED);
        build(scene);
        scene.still(2000, CROPPED);
        expect(accepted(scene.frames, calibration)).toHaveLength(0);
      });

    run("camera bumps", (s) => {
      for (const hold of [200, 500, 800]) {
        s.run(hold + 300, (t) => ({ globalDy: -0.16 * (t < 100 ? t / 100 : t < hold + 100 ? 1 : (hold + 300 - t) / 200) }), CROPPED);
        s.still(1500, CROPPED);
      }
    });
    run("a neighbour on a box replacing the athlete", (s) => {
      s.run(800, () => ({ floorDy: -0.18, x: 0.52 }), CROPPED);
      s.still(1500, CROPPED);
      s.run(1200, () => ({ x: 0.75 }), CROPPED);
    });
    run("squats", (s) => {
      for (let i = 0; i < 6; i++) s.run(2200, (t) => ({ hip: -0.8 * Math.sin((Math.PI * t) / 2200) }), CROPPED);
    });
    run("squat then stand", (s) => {
      for (let i = 0; i < 4; i++) {
        s.run(1200, (t) => ({ hip: -0.9 * smoothstep(t / 1200) }), CROPPED);
        s.still(1500, { ...CROPPED, hip: -0.9 });
        s.run(1200, (t) => ({ hip: -0.9 * (1 - smoothstep(t / 1200)) }), CROPPED);
        s.still(1500, CROPPED);
      }
    });
    run("jumps", (s) => {
      for (const h of [0.4, 0.8, 1.2]) {
        for (let i = 0; i < 3; i++) {
          s.run(650, (t) => ({ hip: h * Math.sin((Math.PI * t) / 650) }), CROPPED);
          s.still(1200, CROPPED);
        }
      }
    });
    run("calf raises", (s) => {
      for (let i = 0; i < 10; i++) s.run(1400, (t) => ({ hip: 0.1 * Math.sin((Math.PI * t) / 1400) }), CROPPED);
    });
    run("sitting on a couch", (s) => {
      for (let i = 0; i < 4; i++) {
        s.run(1200, (t) => ({ hip: -0.9 * smoothstep(t / 1200) }), CROPPED);
        s.still(2500, { ...CROPPED, hip: -0.9 });
        s.run(1200, (t) => ({ hip: -0.9 * (1 - smoothstep(t / 1200)) }), CROPPED);
        s.still(1500, CROPPED);
      }
    });
    run("kneeling on a couch", (s) => {
      for (let i = 0; i < 4; i++) {
        s.run(1300, (t) => ({ hip: -0.2 * smoothstep(t / 1300) }), CROPPED);
        s.still(2500, { ...CROPPED, hip: -0.2 });
        s.run(1300, (t) => ({ hip: -0.2 * (1 - smoothstep(t / 1300)) }), CROPPED);
        s.still(1500, CROPPED);
      }
    });
    run("walking toward and away from the camera", (s) => {
      s.run(3000, (t) => ({ scale: 1 - 0.35 * (t / 3000) }), CROPPED);
      s.still(2500, { ...CROPPED, scale: 0.65 });
      s.run(3000, (t) => ({ scale: 0.65 + 0.35 * (t / 3000) }), { ...CROPPED, scale: 0.65 });
      s.still(2500, CROPPED);
      s.run(5000, (t) => ({ scale: 1 - 0.1 * (t / 5000) }), CROPPED);
      s.still(2500, { ...CROPPED, scale: 0.9 });
    });
    run("walking around the box", (s) => {
      s.run(6000, (t) => {
        const u = t / 6000;
        return { x: 0.5 + 0.3 * Math.sin(u * Math.PI * 2), scale: 1 - 0.3 * Math.sin(u * Math.PI) };
      }, CROPPED);
    });
  }
});

describe("never seen", () => {
  it("reports Lost you when nobody has appeared", () => {
    const detector = new RepDetector(null);
    for (let t = 0; t < 2000; t += 66) detector.pushAll({ t, landmarks: null });
    expect(detector.diagnostic).toBe("Lost you");
    expect(detector.phase).toBe("lost");
  });
});
