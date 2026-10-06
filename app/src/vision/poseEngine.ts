import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark, PoseFrame } from "../types.ts";

const TASKS_VISION_VERSION = "1.0.1";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const DEFAULT_TARGET_FPS = 20;
const INTERVAL_TOLERANCE = 0.8;
const STATS_WINDOW_MS = 2000;
const MAX_CONSECUTIVE_ERRORS = 5;
const BRIGHTNESS_INTERVAL_MS = 1000;
const BRIGHTNESS_WIDTH = 32;
const BRIGHTNESS_HEIGHT = 24;
const VISIBILITY_DRAW_MIN = 0.4;
const CAMERA_STOPPED = "Camera stopped";

export type CameraFacing = "user" | "environment";

export type CameraProfile = "setup" | "workout";

const PROFILES: Record<CameraProfile, MediaTrackConstraints> = {
  setup: { width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } },
  workout: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 20 } },
};

export async function setCameraProfile(stream: MediaStream, profile: CameraProfile): Promise<void> {
  try {
    await stream.getVideoTracks()[0]?.applyConstraints(PROFILES[profile]);
  } catch {
    // the camera keeps its current mode
  }
}

export interface EngineStats {
  fps: number;
  inferenceMs: number;
  targetFps: number;
}

export async function openCamera(
  video: HTMLVideoElement,
  facing: CameraFacing = "environment",
  profile: CameraProfile = "setup",
): Promise<MediaStream> {
  // Safari can ignore an `ideal` facingMode when resolution is also requested, so ask for the exact
  // camera first and fall back to a preference on devices that only have one.
  const request = (facingMode: ConstrainDOMString) =>
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode, ...PROFILES[profile] } });
  const stream = await request({ exact: facing }).catch((err: unknown) => {
    const name = (err as { name?: string } | null)?.name;
    if (name === "OverconstrainedError" || name === "NotFoundError") {
      return request({ ideal: facing });
    }
    throw err;
  });
  video.playsInline = true;
  video.muted = true;
  video.setAttribute("playsinline", "");
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

async function createLandmarker(delegate: "GPU" | "CPU"): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

class BrightnessMeter {
  private readonly ctx: CanvasRenderingContext2D;
  private lastMeasuredAt = -Infinity;
  private lastValue: number | undefined;
  enabled = true;

  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = BRIGHTNESS_WIDTH;
    canvas.height = BRIGHTNESS_HEIGHT;
    this.ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  }

  measure(video: HTMLVideoElement, now: number): number | undefined {
    if (!this.enabled || now - this.lastMeasuredAt < BRIGHTNESS_INTERVAL_MS) return this.lastValue;
    this.lastMeasuredAt = now;
    this.ctx.drawImage(video, 0, 0, BRIGHTNESS_WIDTH, BRIGHTNESS_HEIGHT);
    const { data } = this.ctx.getImageData(0, 0, BRIGHTNESS_WIDTH, BRIGHTNESS_HEIGHT);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    this.lastValue = sum / (data.length / 4);
    return this.lastValue;
  }
}

type LoopHandle = { kind: "video" | "animation"; id: number };

export class PoseEngine {
  private readonly landmarker: PoseLandmarker;
  private readonly brightness = new BrightnessMeter();
  private running = false;
  private lastDetectAt = -Infinity;
  private lastVideoTime = -1;
  private handle: LoopHandle | null = null;
  private video: HTMLVideoElement | null = null;
  private teardown: (() => void) | null = null;
  private consecutiveErrors = 0;
  private minIntervalMs = (1000 / DEFAULT_TARGET_FPS) * INTERVAL_TOLERANCE;
  private targetFps = DEFAULT_TARGET_FPS;
  private statFrames = 0;
  private statStart = 0;
  private measuredFps = 0;
  private inferenceMs = 0;

  private constructor(landmarker: PoseLandmarker) {
    this.landmarker = landmarker;
  }

  static async create(): Promise<PoseEngine> {
    try {
      return new PoseEngine(await createLandmarker("GPU"));
    } catch {
      return new PoseEngine(await createLandmarker("CPU"));
    }
  }

  start(video: HTMLVideoElement, onFrame: (f: PoseFrame) => void, onError?: (message: string) => void): void {
    this.stop();
    this.running = true;
    this.video = video;
    this.consecutiveErrors = 0;

    const fail = (message: string): void => {
      this.stop();
      onError?.(message);
    };
    const tick = (): void => {
      if (!this.running) return;
      this.schedule(video, tick);
      try {
        this.process(video, onFrame);
        this.consecutiveErrors = 0;
      } catch (err) {
        this.consecutiveErrors += 1;
        if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) fail(err instanceof Error ? err.message : CAMERA_STOPPED);
      }
    };
    const onVisible = (): void => {
      if (!this.running) return;
      if (document.visibilityState !== "visible") {
        this.cancelLoop();
        return;
      }
      void video.play().catch(() => {});
      this.cancelLoop();
      onFrame({ t: performance.now(), landmarks: null });
      this.schedule(video, tick);
    };
    const onTrackEnded = (): void => fail(CAMERA_STOPPED);

    const tracks = video.srcObject instanceof MediaStream ? video.srcObject.getTracks() : [];
    document.addEventListener("visibilitychange", onVisible);
    for (const track of tracks) track.addEventListener("ended", onTrackEnded);
    this.teardown = () => {
      document.removeEventListener("visibilitychange", onVisible);
      for (const track of tracks) track.removeEventListener("ended", onTrackEnded);
    };
    this.schedule(video, tick);
  }

  stop(): void {
    this.running = false;
    this.cancelLoop();
    this.teardown?.();
    this.teardown = null;
    this.video = null;
  }

  setTargetFps(fps: number): void {
    this.targetFps = fps;
    this.minIntervalMs = (1000 / fps) * INTERVAL_TOLERANCE;
  }

  setBrightnessEnabled(enabled: boolean): void {
    this.brightness.enabled = enabled;
  }

  get stats(): EngineStats {
    return { fps: this.measuredFps, inferenceMs: this.inferenceMs, targetFps: this.targetFps };
  }

  close(): void {
    this.stop();
    this.landmarker.close();
  }

  private cancelLoop(): void {
    const handle = this.handle;
    this.handle = null;
    if (!handle || !this.video) return;
    if (handle.kind === "video") this.video.cancelVideoFrameCallback(handle.id);
    else cancelAnimationFrame(handle.id);
  }

  private schedule(video: HTMLVideoElement, tick: () => void): void {
    this.handle =
      "requestVideoFrameCallback" in video
        ? { kind: "video", id: video.requestVideoFrameCallback(tick) }
        : { kind: "animation", id: requestAnimationFrame(tick) };
  }

  private recordStats(now: number, inferenceMs: number): void {
    this.inferenceMs = this.inferenceMs === 0 ? inferenceMs : this.inferenceMs * 0.9 + inferenceMs * 0.1;
    this.statFrames += 1;
    if (now - this.statStart < STATS_WINDOW_MS) return;
    this.measuredFps = (this.statFrames * 1000) / (now - this.statStart);
    this.statStart = now;
    this.statFrames = 0;
  }

  private process(video: HTMLVideoElement, onFrame: (f: PoseFrame) => void): void {
    const now = performance.now();
    if (video.readyState < 2 || video.videoWidth === 0) return;
    if (now - this.lastDetectAt < this.minIntervalMs || video.currentTime === this.lastVideoTime) return;
    this.lastDetectAt = now;
    this.lastVideoTime = video.currentTime;

    const result = this.landmarker.detectForVideo(video, now);
    this.recordStats(now, performance.now() - now);
    const pose = result.landmarks[0];
    const landmarks: Landmark[] | null = pose
      ? pose.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility ?? 0 }))
      : null;
    onFrame({ t: now, landmarks, brightness: this.brightness.measure(video, now) });
  }
}

interface OverlayGeometry {
  video: HTMLVideoElement;
  contain: boolean;
}

const overlays = new WeakMap<HTMLCanvasElement, OverlayGeometry>();

function sizeCanvas(canvas: HTMLCanvasElement): void {
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * scale));
  const height = Math.max(1, Math.round(canvas.clientHeight * scale));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function overlayGeometry(canvas: HTMLCanvasElement, video: HTMLVideoElement): OverlayGeometry {
  let geometry = overlays.get(canvas);
  if (geometry?.video === video) return geometry;
  geometry = { video, contain: getComputedStyle(video).objectFit !== "cover" };
  const refresh = (): void => {
    sizeCanvas(canvas);
    (geometry as OverlayGeometry).contain = getComputedStyle(video).objectFit !== "cover";
  };
  new ResizeObserver(refresh).observe(canvas);
  overlays.set(canvas, geometry);
  sizeCanvas(canvas);
  return geometry;
}

export function drawPose(canvas: HTMLCanvasElement, frame: PoseFrame, video: HTMLVideoElement): void {
  const geometry = overlayGeometry(canvas, video);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const lm = frame.landmarks;
  if (!lm) return;

  const vw = video.videoWidth || canvas.width;
  const vh = video.videoHeight || canvas.height;
  const fit = geometry.contain ? Math.min : Math.max;
  const scale = fit(canvas.width / vw, canvas.height / vh);
  const offsetX = (canvas.width - vw * scale) / 2;
  const offsetY = (canvas.height - vh * scale) / 2;
  const point = (l: Landmark): { x: number; y: number } => ({ x: offsetX + l.x * vw * scale, y: offsetY + l.y * vh * scale });

  ctx.lineWidth = Math.max(2, canvas.width / 200);
  ctx.strokeStyle = "rgba(80, 220, 140, 0.9)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
    const a = lm[start];
    const b = lm[end];
    if (!a || !b || a.visibility < VISIBILITY_DRAW_MIN || b.visibility < VISIBILITY_DRAW_MIN) continue;
    const pa = point(a);
    const pb = point(b);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  for (const l of lm) {
    if (l.visibility < VISIBILITY_DRAW_MIN) continue;
    const p = point(l);
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
