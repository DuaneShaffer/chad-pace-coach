import { describe, expect, it } from "vitest";
import { RepDetector } from "./repDetector.ts";
import { Scene, STANDING, smoothstep } from "./synthPose.ts";
import type { Calibration, PoseFrame, RepCandidate } from "../types.ts";

function accepted(frames: PoseFrame[], calibration: Calibration | null): RepCandidate[] {
  const detector = new RepDetector(calibration);
  return frames.flatMap((f) => detector.pushAll(f)).filter((c) => c.accepted);
}

function sitDown(scene: Scene): void {
  for (let i = 0; i < 5; i++) {
    scene.run(1200, (t) => ({ hip: -0.9 * smoothstep(t / 1200) }));
    scene.still(2500, { ...STANDING, hip: -0.9 });
    scene.run(1200, (t) => ({ hip: -0.9 * (1 - smoothstep(t / 1200)) }));
    scene.still(1500);
  }
}

function kneelOnCouch(scene: Scene, couch: number): void {
  for (let i = 0; i < 5; i++) {
    scene.run(2600, (t) => {
      const first = couch * smoothstep(t / 700);
      const second = couch * smoothstep((t - 600) / 700);
      return { lAnkle: first, rAnkle: second, hip: -0.2 * smoothstep(t / 1300) };
    });
    scene.still(2500, { ...STANDING, lAnkle: couch, rAnkle: couch, hip: -0.2 });
    scene.run(1500, (t) => ({ lAnkle: couch * (1 - smoothstep(t / 700)), rAnkle: couch * (1 - smoothstep((t - 500) / 700)), hip: -0.2 * (1 - smoothstep(t / 1300)) }));
    scene.still(1500);
  }
}

const SURFACES: [string, number, number][] = [
  ["couch cushion", 0.45, 0.1],
  ["low couch", 0.35, 0.1],
  ["stair", 0.4, 0],
  ["standard box", 1.0, 0],
  ["high box", 1.5, 0],
];

describe("any clear step-up surface", () => {
  for (const [name, height, sag] of SURFACES) {
    it(`counts 20 reps on a ${name} (${height} torso, ${sag * 100}% sag) with calibration`, () => {
      const scene = new Scene({ seed: 31 });
      scene.still(1500);
      scene.reps(20, height, { sag, pauseMs: 250 });
      scene.still(1500);
      expect(accepted(scene.frames, { boxHeightTorso: height * (1 - sag / 2) })).toHaveLength(20);
    });

    it(`learns the ${name} without calibration and counts every rep in order`, () => {
      const scene = new Scene({ seed: 32 });
      scene.still(1500);
      scene.reps(25, height, { sag, pauseMs: 250 });
      scene.still(1500);
      const counted = accepted(scene.frames, null);
      expect(counted).toHaveLength(25);
      const times = counted.map((c) => c.t);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });
  }

  it("reports the first two learned reps together with their own timestamps", () => {
    const scene = new Scene({ seed: 33 });
    scene.still(1500);
    scene.reps(4, 1.0, { pauseMs: 250 });
    scene.still(1000);
    const detector = new RepDetector(null);
    const batches = scene.frames.map((f) => ({ t: f.t, out: detector.pushAll(f).filter((c) => c.accepted) }));
    const first = batches.find((b) => b.out.length > 0);
    expect(first?.out).toHaveLength(2);
    expect(first!.out[0].t).toBeLessThan(first!.out[1].t);
    expect(first!.out[1].t).toBeLessThanOrEqual(first!.t);
    expect(detector.diagnostic).not.toBe("Learning your step…");
  });

  it("shows a learning diagnostic until the step is locked, then an estimate", () => {
    const scene = new Scene({ seed: 34 });
    scene.still(1500);
    scene.reps(1, 1.0, { pauseMs: 250 });
    const detector = new RepDetector(null);
    scene.frames.forEach((f) => detector.pushAll(f));
    expect(detector.diagnostic).toBe("Learning your step…");
    const more = new Scene({ seed: 35 });
    more.t = scene.t;
    more.reps(2, 1.0, { pauseMs: 250 });
    more.frames.forEach((f) => detector.pushAll(f));
    expect(detector.diagnostic).toMatch(/^Step height: [12]\d in \(est\.\)$/);
  });
});

describe("phantom protection while learning and when calibrated", () => {
  for (const calibration of [null, { boxHeightTorso: 0.45 }, { boxHeightTorso: 1.0 }] as (Calibration | null)[]) {
    const label = calibration ? `calibrated ${calibration.boxHeightTorso}` : "learning";

    it(`counts nothing for sitting down on a couch (${label})`, () => {
      const scene = new Scene({ seed: 36 });
      scene.still(1500);
      sitDown(scene);
      expect(accepted(scene.frames, calibration)).toHaveLength(0);
    });

    it(`counts nothing for kneeling on a couch (${label})`, () => {
      const scene = new Scene({ seed: 37 });
      scene.still(1500);
      kneelOnCouch(scene, 0.4);
      expect(accepted(scene.frames, calibration)).toHaveLength(0);
    });

    it(`counts nothing for simultaneous bumps, jumps and calf raises (${label})`, () => {
      const scene = new Scene({ seed: 38 });
      scene.still(1500);
      for (let i = 0; i < 6; i++) {
        scene.run(900, (t) => ({ globalDy: -0.1 * (t < 100 ? t / 100 : t < 800 ? 1 : (900 - t) / 100) }));
        scene.still(1500);
        scene.run(600, (t) => {
          const e = 0.8 * Math.sin((Math.PI * t) / 600);
          return { lAnkle: e, rAnkle: e, hip: e };
        });
        scene.still(1200);
        scene.run(1500, (t) => {
          const e = 0.35 * Math.sin((Math.PI * t) / 1500);
          return { lAnkle: e, rAnkle: e, hip: 0.3 * e };
        });
        scene.still(1500);
      }
      expect(accepted(scene.frames, calibration)).toHaveLength(0);
    });
  }
});
