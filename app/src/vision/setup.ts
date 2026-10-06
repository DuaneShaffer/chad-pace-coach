import type { Landmark, PoseFrame, SetupCheck } from "../types.ts";
import { LM } from "./geometry.ts";

const BODY_POINTS = [
  LM.nose, LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip,
  LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle,
];
const FOOT_POINTS = [LM.lAnkle, LM.rAnkle, LM.lHeel, LM.rHeel, LM.lFoot, LM.rFoot];
const BODY_VISIBILITY = 0.6;
const FOOT_VISIBILITY = 0.5;
const MARGIN = 0.02;
const MIN_BRIGHTNESS = 50;
const WINDOW = 10;
const PERSON_RATIO = 0.7;

function inFrame(l: Landmark): boolean {
  return l.x > MARGIN && l.x < 1 - MARGIN && l.y > MARGIN && l.y < 1 - MARGIN;
}

function allVisible(frames: Landmark[][], points: readonly number[], minVisibility: number): boolean {
  return points.every((p) => {
    const vis = frames.reduce((s, lm) => s + lm[p].visibility, 0) / frames.length;
    return vis >= minVisibility && frames.every((lm) => inFrame(lm[p]));
  });
}

export function evaluateSetup(recent: PoseFrame[]): SetupCheck[] {
  const frames = recent.slice(-WINDOW);
  const withPose = frames.filter((f) => f.landmarks && f.landmarks.length >= 33);
  const poses = withPose.map((f) => f.landmarks as Landmark[]);
  const person = frames.length > 0 && withPose.length / frames.length >= PERSON_RATIO;
  const fullBody = person && allVisible(poses, BODY_POINTS, BODY_VISIBILITY);
  const feet = person && allVisible(poses, FOOT_POINTS, FOOT_VISIBILITY);

  const brightnesses = frames.flatMap((f) => (f.brightness === undefined ? [] : [f.brightness]));
  const brightness = brightnesses.length ? brightnesses.reduce((a, b) => a + b, 0) / brightnesses.length : null;
  const light = brightness === null || brightness >= MIN_BRIGHTNESS;

  return [
    { id: "person", ok: person, label: "Person detected", hint: person ? undefined : "Step into view" },
    {
      id: "fullBody",
      ok: fullBody,
      label: "Full body in view",
      hint: person && !fullBody ? "Move the camera back" : undefined,
    },
    {
      id: "feet",
      ok: feet,
      label: "Feet visible",
      hint: person && !feet ? "Your feet are outside the frame" : undefined,
    },
    { id: "light", ok: light, label: "Good lighting", hint: light ? undefined : "More light is needed" },
  ];
}
