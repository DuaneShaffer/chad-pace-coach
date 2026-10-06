import { describe, expect, it } from "vitest";
import { BoxCalibrator } from "./calibrator.ts";
import { RepDetector } from "./repDetector.ts";
import { evaluateSetup } from "./setup.ts";
import { makeFrame, mulberry32, realisticRep, Scene, STANDING } from "./synthPose.ts";
import type { FigureState } from "./synthPose.ts";
import type { PoseFrame, RepCandidate } from "../types.ts";

const BOX = 1.1;

function feed(detector: RepDetector, frames: PoseFrame[]): RepCandidate[] {
  return frames.flatMap((f) => detector.push(f) ?? []);
}

function accepted(c: RepCandidate[]): number {
  return c.filter((x) => x.accepted).length;
}

function warmedUp(scene: Scene, base: FigureState = STANDING): void {
  scene.still(1500, base);
}

describe("BoxCalibrator", () => {
  function calibrate(box: number, scale = 1, stopAtRejection = false): BoxCalibrator {
    const scene = new Scene({ seed: 3 });
    const base = { ...STANDING, scale };
    scene.still(2000, base);
    scene.run(1300, (tau) => realisticRep(tau, box, "l", 3600), base);
    scene.still(2000, { ...base, lAnkle: box, rAnkle: box, hip: box });
    const cal = new BoxCalibrator();
    let reachedBox = false;
    for (const f of scene.frames) {
      cal.push(f);
      reachedBox ||= cal.step === "box";
      if (stopAtRejection && reachedBox && cal.step === "floor") break;
    }
    return cal;
  }

  it("measures box height in torso units", () => {
    const cal = calibrate(1.1);
    expect(cal.step).toBe("done");
    expect(cal.instruction).toBe("Step detected");
    expect(cal.result()?.boxHeightTorso).toBeCloseTo(1.1, 1);
  });

  it("is distance invariant", () => {
    expect(calibrate(1.1, 0.6).result()?.boxHeightTorso).toBeCloseTo(1.1, 1);
  });

  it("walks through steps with progress", () => {
    const scene = new Scene();
    scene.still(800);
    const cal = new BoxCalibrator();
    for (const f of scene.frames) cal.push(f);
    expect(cal.step).toBe("floor");
    expect(cal.instruction).toBe("Stand next to the step");
    expect(cal.progress).toBeGreaterThan(0.4);
    expect(cal.progress).toBeLessThan(0.7);
  });

  it("rejects implausibly small and large boxes", () => {
    for (const box of [0.2, 2.6]) {
      const cal = calibrate(box, 1, true);
      expect(cal.result()).toBeNull();
      expect(cal.step).toBe("floor");
      expect(cal.instruction).toContain("try again");
    }
  });

  it("asks to step into view when the person is lost", () => {
    const cal = new BoxCalibrator();
    cal.push({ t: 0, landmarks: null });
    expect(cal.instruction).toBe("Step into view");
  });
});

describe("RepDetector", () => {
  const calibration = { boxHeightTorso: BOX };

  it("counts exactly 10 clean cycles", () => {
    const scene = new Scene({ seed: 5 });
    warmedUp(scene);
    for (let i = 0; i < 10; i++) {
      scene.cycle(BOX, undefined, STANDING, i % 2 ? "r" : "l");
      scene.still(600);
    }
    const out = feed(new RepDetector(calibration), scene.frames);
    expect(out).toHaveLength(10);
    expect(accepted(out)).toBe(10);
    expect(out.every((c) => c.confidence >= 0.8)).toBe(true);
  });

  it("counts reliably with heavier landmark jitter", () => {
    const scene = new Scene({ seed: 21, noise: 0.08 });
    warmedUp(scene);
    for (let i = 0; i < 10; i++) {
      scene.cycle(BOX);
      scene.still(500);
    }
    expect(accepted(feed(new RepDetector(calibration), scene.frames))).toBe(10);
  });

  it("counts at a fast cadence with brief floor contact", () => {
    const scene = new Scene({ seed: 6 });
    warmedUp(scene);
    for (let i = 0; i < 10; i++) {
      scene.cycle(BOX, { upMs: 750, holdMs: 450, downMs: 750 });
      scene.still(250);
    }
    scene.still(500);
    expect(accepted(feed(new RepDetector(calibration), scene.frames))).toBe(10);
  });

  it("counts at varied distances from the camera", () => {
    for (const scale of [0.55, 0.8, 1.15]) {
      const scene = new Scene({ seed: 7 });
      const base = { ...STANDING, scale };
      warmedUp(scene, base);
      for (let i = 0; i < 5; i++) {
        scene.cycle(BOX, undefined, base);
        scene.still(500, base);
      }
      expect(accepted(feed(new RepDetector(calibration), scene.frames))).toBe(5);
    }
  });

  it("tolerates a modest horizontal sway during reps", () => {
    const scene = new Scene({ seed: 8 });
    warmedUp(scene);
    for (let i = 0; i < 6; i++) {
      scene.run(1900, (tau) => ({ x: 0.5 + 0.03 * Math.sin(tau / 300) }), STANDING);
      scene.cycle(BOX, undefined, { ...STANDING, x: 0.52 });
    }
    scene.still(500);
    expect(accepted(feed(new RepDetector(calibration), scene.frames))).toBe(6);
  });

  it("counts reps again after walking around the box", () => {
    const scene = new Scene({ seed: 9 });
    warmedUp(scene);
    for (let i = 0; i < 3; i++) scene.cycle(BOX);
    scene.still(400);
    scene.run(3000, (tau) => ({ x: 0.5 - 0.3 * (tau / 3000), scale: 1 - 0.25 * (tau / 3000), lAnkle: 0.2 * Math.max(0, Math.sin(tau / 150)), rAnkle: 0.2 * Math.max(0, Math.sin(tau / 150 + 3)) }));
    const far = { ...STANDING, x: 0.2, scale: 0.75 };
    scene.still(1500, far);
    for (let i = 0; i < 4; i++) scene.cycle(BOX, undefined, far);
    scene.still(400, far);
    expect(accepted(feed(new RepDetector(calibration), scene.frames))).toBe(7);
  });

  it("produces no reps while walking around the box with foot lifts and scale change", () => {
    const scene = new Scene({ seed: 10 });
    warmedUp(scene);
    scene.run(6000, (tau) => {
      const u = tau / 6000;
      return {
        x: 0.5 + 0.3 * Math.sin(u * Math.PI * 2),
        scale: 1 - 0.3 * Math.sin(u * Math.PI),
        lAnkle: 0.25 * Math.max(0, Math.sin(tau / 140)),
        rAnkle: 0.25 * Math.max(0, Math.sin(tau / 140 + Math.PI)),
      };
    });
    scene.still(1500);
    const detector = new RepDetector(calibration);
    const out = feed(detector, scene.frames);
    expect(accepted(out)).toBe(0);
  });

  it("produces no reps while walking toward the camera with no sideways motion", () => {
    const scene = new Scene({ seed: 11 });
    warmedUp(scene);
    scene.run(3000, (tau) => ({ scale: 1 - 0.35 * (tau / 3000) }));
    scene.still(2000, { ...STANDING, scale: 0.65 });
    expect(accepted(feed(new RepDetector(calibration), scene.frames))).toBe(0);
  });

  it("produces no reps when standing still with noise", () => {
    const scene = new Scene({ seed: 12, noise: 0.1 });
    scene.still(30000);
    const detector = new RepDetector(calibration);
    expect(feed(detector, scene.frames)).toHaveLength(0);
    expect(detector.phase).toBe("floor");
  });

  it("does not accept a partial step with one foot", () => {
    const scene = new Scene({ seed: 13 });
    warmedUp(scene);
    for (let i = 0; i < 3; i++) {
      scene.run(1600, (tau) => ({ lAnkle: BOX * Math.sin((tau / 1600) * Math.PI) }));
      scene.still(500);
    }
    expect(accepted(feed(new RepDetector(calibration), scene.frames))).toBe(0);
  });

  it("does not accept a half-height step", () => {
    const scene = new Scene({ seed: 14 });
    warmedUp(scene);
    scene.cycle(BOX * 0.5);
    scene.still(500);
    expect(accepted(feed(new RepDetector(calibration), scene.frames))).toBe(0);
  });

  it("does not accept a rep interrupted by occlusion", () => {
    const scene = new Scene({ seed: 15 });
    warmedUp(scene);
    scene.run(1000, (tau) => ({ lAnkle: BOX * Math.min(1, tau / 600), rAnkle: BOX * Math.min(1, tau / 700), hip: BOX * Math.min(1, tau / 700) }));
    const onBox = { ...STANDING, lAnkle: BOX, rAnkle: BOX, hip: BOX };
    scene.still(200, onBox);
    scene.missing(1200);
    scene.still(300, onBox);
    scene.run(700, (tau) => ({ lAnkle: BOX * (1 - tau / 700), rAnkle: BOX * (1 - tau / 700), hip: BOX * (1 - tau / 700) }), STANDING);
    scene.still(1500);
    expect(accepted(feed(new RepDetector(calibration), scene.frames))).toBe(0);
  });

  it("does not accept a rep with low landmark visibility", () => {
    const scene = new Scene({ seed: 16 });
    warmedUp(scene);
    scene.cycle(BOX, undefined, { ...STANDING, visibility: 0.5 });
    scene.still(500);
    expect(accepted(feed(new RepDetector(calibration), scene.frames))).toBe(0);
  });

  it("enters lost phase and recovers", () => {
    const scene = new Scene({ seed: 17 });
    warmedUp(scene);
    scene.missing(800);
    const detector = new RepDetector(calibration);
    feed(detector, scene.frames);
    expect(detector.phase).toBe("lost");
    const later = new Scene({ seed: 18 });
    later.t = scene.t;
    later.still(1500);
    for (let i = 0; i < 3; i++) later.cycle(BOX);
    later.still(500);
    expect(accepted(feed(detector, later.frames))).toBe(3);
  });

  it("lowers the repositioning threshold when a transition is expected", () => {
    const walk = (expected: boolean): string => {
      const scene = new Scene({ seed: 19 });
      warmedUp(scene);
      scene.run(1500, (tau) => ({ x: 0.5 + 0.2 * (tau / 1500) }));
      const detector = new RepDetector(calibration);
      detector.setContext({ repsIntoSet: expected ? 24 : 5, setSize: 25 });
      feed(detector, scene.frames);
      return detector.phase;
    };
    expect(walk(false)).toBe("floor");
    expect(walk(true)).toBe("repositioning");
  });
});

describe("evaluateSetup", () => {
  const rng = mulberry32(1);
  const frames = (s: FigureState, n = 10, brightness = 120): PoseFrame[] =>
    Array.from({ length: n }, (_, i) => ({ ...makeFrame(i * 50, s, 0.02, rng), brightness }));
  const ok = (checks: ReturnType<typeof evaluateSetup>, id: string) => checks.find((c) => c.id === id);

  it("passes a good setup", () => {
    expect(evaluateSetup(frames(STANDING)).every((c) => c.ok)).toBe(true);
  });

  it("asks to step into view with no person", () => {
    const checks = evaluateSetup(Array.from({ length: 10 }, (_, i) => ({ t: i, landmarks: null })));
    expect(ok(checks, "person")).toMatchObject({ ok: false, hint: "Step into view" });
  });

  it("flags feet cut off at the bottom", () => {
    const checks = evaluateSetup(frames({ ...STANDING, scale: 1.2 }));
    expect(ok(checks, "feet")?.ok).toBe(false);
    expect(ok(checks, "feet")?.hint).toBe("Tip: get your feet in frame for best accuracy");
  });

  it("flags a body too large for the frame", () => {
    const checks = evaluateSetup(frames({ ...STANDING, scale: 1.6 }));
    expect(ok(checks, "fullBody")).toMatchObject({ ok: false, hint: "Tip: move the camera back to fit your whole body" });
  });

  it("flags low light", () => {
    const checks = evaluateSetup(frames(STANDING, 10, 20));
    expect(ok(checks, "light")).toMatchObject({ ok: false, hint: "More light is needed" });
  });
});
