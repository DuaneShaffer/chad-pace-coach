import { describe, expect, it } from "vitest";
import { BoxCalibrator } from "./calibrator.ts";
import { RepDetector } from "./repDetector.ts";
import { realisticRep, Scene, smoothstep, STANDING } from "./synthPose.ts";
import type { FigureState } from "./synthPose.ts";
import type { Calibration, PoseFrame } from "../types.ts";

const BOX = 1.1;
const calibration: Calibration = { boxHeightTorso: BOX };

function acceptedCount(frames: PoseFrame[], cal: Calibration = calibration): number {
  const detector = new RepDetector(cal);
  return frames.reduce((n, f) => n + (detector.push(f)?.accepted ? 1 : 0), 0);
}

function bump(tau: number, upMs: number, holdMs: number, downMs: number): number {
  if (tau < upMs) return smoothstep(tau / upMs);
  if (tau < upMs + holdMs) return 1;
  return 1 - smoothstep((tau - upMs - holdMs) / downMs);
}

describe("phantom reps from global motion", () => {
  for (const hold of [200, 500, 800]) {
    for (const dy of [0.12, 0.2]) {
      it(`camera bump up by ${dy} held ${hold} ms`, () => {
        const scene = new Scene({ seed: 7 });
        scene.still(1500);
        scene.run(hold + 300, (t) => ({ globalDy: -dy * bump(t, 100, hold, 100) }));
        scene.still(2000);
        expect(acceptedCount(scene.frames)).toBe(0);
      });
    }
  }

  it("ignores a neighbouring athlete on a box replacing the tracked person", () => {
    const scene = new Scene({ seed: 7 });
    scene.still(1500);
    scene.run(800, () => ({ floorDy: -0.18, x: 0.52 }));
    scene.still(2000);
    expect(acceptedCount(scene.frames)).toBe(0);
  });

  it("ignores a bystander at a different position", () => {
    const scene = new Scene({ seed: 7 });
    scene.still(1500);
    scene.run(1200, () => ({ x: 0.75 }));
    scene.still(2000);
    expect(acceptedCount(scene.frames)).toBe(0);
  });

  it("does not count two-footed jumps or box jumps", () => {
    const scene = new Scene({ seed: 4 });
    scene.still(1500);
    for (let i = 0; i < 5; i++) {
      scene.run(600, (t) => {
        const e = 1.0 * Math.sin((Math.PI * t) / 600);
        return { lAnkle: e, rAnkle: e, hip: e };
      });
      scene.still(600);
    }
    const onBox: FigureState = { ...STANDING, lAnkle: BOX, rAnkle: BOX, hip: BOX };
    for (let i = 0; i < 3; i++) {
      scene.run(500, (t) => {
        const e = smoothstep(t / 500);
        return { lAnkle: BOX * e, rAnkle: BOX * e, hip: BOX * e };
      });
      scene.still(1500, onBox);
      scene.run(800, (t) => {
        const e = 1 - smoothstep(t / 800);
        return { lAnkle: BOX * e, rAnkle: BOX * e, hip: BOX * e };
      });
      scene.still(800);
    }
    expect(acceptedCount(scene.frames)).toBe(0);
  });

  it("does not count other movements", () => {
    const scene = new Scene({ seed: 4 });
    scene.still(1500);
    for (let i = 0; i < 5; i++) scene.run(2000, (t) => ({ hip: -0.8 * Math.sin((Math.PI * t) / 2000) }));
    for (let i = 0; i < 20; i++) {
      scene.run(600, (t) => ({ [i % 2 ? "lAnkle" : "rAnkle"]: 1.2 * Math.sin((Math.PI * t) / 600), hip: 0.1 }));
    }
    for (let i = 0; i < 10; i++) {
      scene.run(1200, (t) => {
        const e = Math.sin((Math.PI * t) / 1200);
        return { lAnkle: 0.25 * e, rAnkle: 0.25 * e, hip: 0.2 * e };
      });
    }
    for (let i = 0; i < 5; i++) {
      scene.run(3000, (t) => ({
        lAnkle: BOX * Math.sin((Math.PI * t) / 3000),
        rAnkle: t > 800 && t < 2200 ? 0.7 * BOX * Math.sin((Math.PI * (t - 800)) / 1400) : 0,
        hip: 0.6 * BOX * Math.sin((Math.PI * t) / 3000),
      }));
    }
    expect(acceptedCount(scene.frames)).toBe(0);
  });
});

describe("stalls and recovery", () => {
  for (const dy of [0.08, 0.12]) {
    it(`recovers after the camera is permanently shifted up by ${dy}`, () => {
      const scene = new Scene({ seed: 7 });
      scene.still(1500);
      scene.run(500, (t) => ({ globalDy: -dy * smoothstep(t / 200) }));
      scene.reps(10, BOX, { base: { ...STANDING, globalDy: -dy } });
      scene.still(1000, { ...STANDING, globalDy: -dy });
      expect(acceptedCount(scene.frames)).toBeGreaterThanOrEqual(5);
    });
  }

  it("recovers after the camera is permanently shifted down", () => {
    const scene = new Scene({ seed: 7 });
    scene.still(1500);
    scene.run(500, (t) => ({ globalDy: 0.08 * smoothstep(t / 200) }));
    scene.reps(10, BOX, { base: { ...STANDING, globalDy: 0.08 } });
    expect(acceptedCount(scene.frames)).toBeGreaterThanOrEqual(8);
  });

  it("resumes counting after a long rest on the box", () => {
    const scene = new Scene({ seed: 4 });
    scene.still(1500);
    scene.run(1300, (t) => realisticRep(t, BOX, "l", 3600));
    scene.run(20000, () => ({ lAnkle: BOX, rAnkle: BOX, hip: BOX }));
    scene.run(1500, (t) => realisticRep(t + (2000 * 3600) / 3100, BOX, "l", 3600));
    scene.still(3000);
    scene.reps(10, BOX);
    expect(acceptedCount(scene.frames)).toBeGreaterThanOrEqual(9);
  });
});

describe("first set", () => {
  const floorCalibration = (): Calibration => {
    const scene = new Scene({ seed: 5 });
    scene.still(2000);
    scene.run(1300, (t) => realisticRep(t, BOX, "l", 3600));
    scene.still(2500, { ...STANDING, lAnkle: BOX, rAnkle: BOX, hip: BOX });
    const cal = new BoxCalibrator();
    scene.frames.forEach((f) => cal.push(f));
    return cal.result() as Calibration;
  };

  it("records the calibrated floor", () => {
    const result = floorCalibration();
    expect(result.floor?.torso).toBeCloseTo(0.16, 1);
  });

  for (const stillMs of [0, 200, 400]) {
    it(`counts every rep when stepping ${stillMs} ms after the first frame`, () => {
      const scene = new Scene({ seed: 2 });
      scene.still(stillMs);
      scene.reps(25, BOX);
      scene.still(1500);
      expect(acceptedCount(scene.frames, floorCalibration())).toBe(25);
    });
  }

  it("does not trust the calibrated floor when the athlete is at a different distance", () => {
    const scene = new Scene({ seed: 2 });
    const far = { ...STANDING, scale: 0.7 };
    scene.still(1500, far);
    scene.reps(5, BOX, { base: far });
    scene.still(1000, far);
    expect(acceptedCount(scene.frames, floorCalibration())).toBe(5);
  });
});

describe("camera angles", () => {
  for (const hipForward of [0.3, 0.5, 0.6]) {
    it(`counts side-on reps with ${hipForward} torso of forward hip travel`, () => {
      const scene = new Scene({ seed: 4 });
      scene.still(1500);
      scene.reps(10, BOX, { hipForward, base: { ...STANDING, ankleSeparation: 0 } });
      scene.still(1500);
      expect(acceptedCount(scene.frames)).toBe(10);
    });
  }

  for (const growth of [0.06, 0.1]) {
    it(`counts reps when stepping toward the camera (torso +${growth})`, () => {
      const scene = new Scene({ seed: 4 });
      scene.still(1500);
      for (let i = 0; i < 10; i++) {
        scene.run(3700, (t) => {
          const p = realisticRep(t, BOX, i % 2 ? "r" : "l", 3700);
          return { ...p, scale: 1 + growth * ((p.hip ?? 0) / BOX) };
        });
        scene.still(200);
      }
      expect(acceptedCount(scene.frames)).toBe(10);
    });
  }

  it("counts reps when stepping away from the camera", () => {
    const scene = new Scene({ seed: 4 });
    scene.still(1500);
    for (let i = 0; i < 10; i++) {
      scene.run(3700, (t) => {
        const p = realisticRep(t, BOX, i % 2 ? "r" : "l", 3700);
        return { ...p, scale: 1 - 0.1 * ((p.hip ?? 0) / BOX) };
      });
      scene.still(200);
    }
    expect(acceptedCount(scene.frames)).toBe(10);
  });
});

describe("landmark quality", () => {
  for (const visibility of [0.7, 0.75, 0.85]) {
    it(`counts reps at uniform visibility ${visibility}`, () => {
      const scene = new Scene({ seed: 4 });
      const base = { ...STANDING, visibility };
      scene.still(1500, base);
      scene.reps(10, BOX, { base });
      expect(acceptedCount(scene.frames)).toBe(10);
    });
  }

  it("counts reps with a plate covering the hips", () => {
    const scene = new Scene({ seed: 4 });
    const base = { ...STANDING, hipVisibility: 0.45 };
    scene.still(1500, base);
    scene.reps(10, BOX, { base });
    expect(acceptedCount(scene.frames)).toBe(10);
  });

  it("counts side-on reps when the far ankle has low visibility", () => {
    const scene = new Scene({ seed: 4 });
    const base = { ...STANDING, ankleSeparation: 0, rAnkleVisibility: 0.45 };
    scene.still(1500, base);
    scene.reps(10, BOX, { base });
    expect(acceptedCount(scene.frames)).toBe(10);
  });

  it("counts reps with dropped frames and frame-time jitter", () => {
    const scene = new Scene({ seed: 4, fps: 8, jitterMs: 20 });
    scene.still(1500);
    scene.reps(10, BOX);
    scene.still(1500);
    const dropped = scene.frames.map((f, i): PoseFrame => (i % 5 === 4 ? { ...f, landmarks: null } : f));
    expect(acceptedCount(dropped)).toBe(10);
  });

  it("counts reps with a 300 ms tracking dropout in every rep", () => {
    const scene = new Scene({ seed: 4 });
    scene.still(1500);
    for (let i = 0; i < 5; i++) {
      scene.run(1500, (t) => realisticRep(t, BOX, i % 2 ? "r" : "l", 3700));
      scene.missing(300);
      scene.run(2200, (t) => realisticRep(t + 1800, BOX, i % 2 ? "r" : "l", 3700));
      scene.still(200);
    }
    expect(acceptedCount(scene.frames)).toBe(5);
  });
});

describe("transition hint", () => {
  it("lowers the repositioning threshold right after finishing a set", () => {
    const walk = (reps: number | undefined, repsIntoSet: number): string => {
      const scene = new Scene({ seed: 19 });
      scene.still(1500);
      scene.run(1500, (t) => ({ x: 0.5 + 0.2 * (t / 1500) }));
      const detector = new RepDetector(calibration);
      detector.setContext({ repsIntoSet, setSize: 25, reps });
      scene.frames.forEach((f) => detector.push(f));
      return detector.phase;
    };
    expect(walk(25, 0)).toBe("repositioning");
    expect(walk(undefined, 0)).toBe("floor");
    expect(walk(10, 10)).toBe("floor");
  });
});

describe("full sessions", () => {
  it("counts exactly 100 reps across four sets with walks between them", () => {
    const scene = new Scene({ seed: 8, noise: 0.03, jitterMs: 8 });
    const detector = new RepDetector(calibration);
    let counted = 0;
    const flush = (): void => {
      for (const f of scene.frames) {
        detector.setContext({ repsIntoSet: counted % 25, setSize: 25, reps: counted });
        if (detector.push(f)?.accepted) counted++;
      }
      scene.frames.length = 0;
    };
    let base: FigureState = STANDING;
    scene.still(1500, base);
    for (let set = 0; set < 4; set++) {
      scene.reps(25, BOX, { base, pauseMs: 250 });
      flush();
      const next: FigureState = set % 2 ? STANDING : { ...STANDING, scale: 0.8 };
      const lift = (t: number) => ((t / 500) % 2 < 1 ? { rAnkle: 0.35 * Math.sin(Math.PI * (t % 500) / 500) } : { lAnkle: 0.35 * Math.sin(Math.PI * (t % 500) / 500) });
      scene.run(2500, (t) => ({ ...lift(t), x: 0.5 + 0.3 * smoothstep(t / 2500) }), base);
      scene.run(3000, (t) => ({ ...lift(t), x: 0.8 - 0.3 * smoothstep(t / 3000), scale: base.scale + (next.scale - base.scale) * smoothstep(t / 3000) }), base);
      base = next;
      scene.still(1000, base);
      flush();
    }
    expect(counted).toBe(100);
  });
});

describe("BoxCalibrator regressions", () => {
  function calibrateWith(build: (scene: Scene) => void): BoxCalibrator {
    const scene = new Scene({ seed: 5 });
    build(scene);
    const cal = new BoxCalibrator();
    scene.frames.forEach((f) => cal.push(f));
    return cal;
  }
  const onBox = (h: number): FigureState => ({ ...STANDING, lAnkle: h, rAnkle: h, hip: h });

  it("rejects a camera bump too small to be a step", () => {
    const cal = calibrateWith((s) => {
      s.still(2000);
      s.still(2500, { ...STANDING, globalDy: -0.03 });
    });
    expect(cal.result()).toBeNull();
  });

  it("rejects a step that is too low", () => {
    const cal = calibrateWith((s) => {
      s.still(2000);
      s.run(1300, (t) => realisticRep(t, 0.2, "l", 3600));
      s.still(2500, onBox(0.2));
    });
    expect(cal.result()).toBeNull();
  });

  it("rejects an absurdly tall surface", () => {
    const cal = calibrateWith((s) => {
      s.still(2000);
      s.run(1300, (t) => realisticRep(t, 3.2, "l", 3600));
      s.still(2500, onBox(3.2));
    });
    expect(cal.result()).toBeNull();
  });

  for (const height of [0.4, 0.55, 1.5, 2.2]) {
    it(`accepts a ${height} torso step`, () => {
      const cal = calibrateWith((s) => {
        s.still(2000);
        s.run(1300, (t) => realisticRep(t, height, "l", 3600));
        s.still(2500, onBox(height));
      });
      expect(cal.result()?.boxHeightTorso).toBeCloseTo(height, 1);
    });
  }

  it("does not calibrate on a two-footed jump that lands back on the floor", () => {
    const cal = calibrateWith((s) => {
      s.still(2000);
      s.run(500, (t) => {
        const e = BOX * Math.sin((Math.PI * t) / 500);
        return { lAnkle: e, rAnkle: e, hip: e };
      });
      s.still(3000);
    });
    expect(cal.result()).toBeNull();
  });

  it("rejects a change in distance between the floor and box steps", () => {
    const cal = calibrateWith((s) => {
      s.still(2000, { ...STANDING, scale: 0.8 });
      s.run(1300, (t) => realisticRep(t, BOX, "l", 3600));
      s.still(2500, onBox(BOX));
    });
    expect(cal.result()).toBeNull();
  });
});
