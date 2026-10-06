import type { PoseFrame, SetupCheck } from "../types";
import { getSettings, savePlan } from "../platform/settings";
import { speech } from "../platform/speech";
import { BoxCalibrator } from "../vision/calibrator";
import { PoseEngine, drawPose } from "../vision/poseEngine";
import { estimateStepInches } from "../vision/geometry";
import { evaluateSetup } from "../vision/setup";
import { app } from "./appState";
import type { CameraSession } from "./appState";
import { cameraErrorMessage, closeCamera, openCameraFacing } from "./camera";
import { h } from "./dom";
import { go } from "./router";
import type { Screen } from "./router";

const RECENT_FRAMES = 20;
const CHECK_INTERVAL_MS = 300;
const SPEAK_REPEAT_MS = 14000;
const HINT_STABLE_MS = 1500;
const HINT_GAP_MS = 5000;

export const cameraSetupScreen: Screen = (root) => {
  closeCamera();
  let disposed = false;
  let handedOff = false;
  let facing: CameraSession["facing"] = "environment";
  let calibrator = new BoxCalibrator();
  let recent: PoseFrame[] = [];
  let lastSpoken = { text: "", at: 0 };
  let pending = { text: "", since: 0 };
  let announcedReady = false;
  let checkTimer = 0;

  const video = h("video", { playsInline: true, muted: true });
  video.muted = true;
  const canvas = h("canvas", { class: "overlay" });
  const cam = h("div", { class: "cam" }, video, canvas);
  const stage = h("div", { class: "cam-stage" }, cam);
  const status = h("div", { class: "status" }, "Starting camera…");
  const instruction = h("div", { class: "instruction", "aria-live": "polite" });
  const progress = h("progress", { max: 1, value: 0 });
  const checklist = h("ul", { class: "checks" });
  const startBtn = h("button", { type: "button", class: "btn primary huge", disabled: true, onClick: onStart }, "Ready");
  const flipBtn = h("button", { type: "button", class: "btn round", "aria-label": "Switch camera", disabled: true, onClick: flip }, "⟲");
  const manualBtn = h("button", { type: "button", class: "btn link", onClick: useManual }, "Use manual counting instead");
  const errorBox = h("div", { class: "error-box", hidden: true });

  const panel = h("div", { class: "panel" }, instruction, progress, checklist, startBtn, manualBtn);
  root.append(
    h(
      "main",
      { class: "screen setup" },
      h("header", { class: "topbar" }, h("button", { type: "button", class: "btn round", "aria-label": "Back", onClick: () => go("home") }, "‹"), h("h2", {}, "Camera setup"), flipBtn),
      stage,
      status,
      errorBox,
      panel,
    ),
  );

  function say(text: string): void {
    const now = performance.now();
    if (text !== pending.text) {
      pending = { text, since: now };
      return;
    }
    if (now - pending.since < HINT_STABLE_MS || now - lastSpoken.at < HINT_GAP_MS) return;
    if (text === lastSpoken.text && now - lastSpoken.at < SPEAK_REPEAT_MS) return;
    lastSpoken = { text, at: now };
    if (getSettings().audioMode !== "off") speech.say(text, { droppable: true });
  }

  function showError(message: string): void {
    window.clearInterval(checkTimer);
    stage.hidden = true;
    panel.hidden = true;
    status.hidden = true;
    errorBox.hidden = false;
    errorBox.replaceChildren(
      h("h3", {}, "Camera counting unavailable"),
      h("p", {}, message),
      h("button", { type: "button", class: "btn primary huge", onClick: useManual }, "Use manual counting instead"),
      h("button", { type: "button", class: "btn", onClick: () => go("setup") }, "Try again"),
    );
  }

  function useManual(): void {
    app.mode = "manual";
    savePlan({ plan: app.plan, mode: "manual" });
    go("workout");
  }

  function checksWithBox(): SetupCheck[] {
    const checks = evaluateSetup(recent).filter((c) => c.id !== "box");
    const calibration = calibrator.step === "done" ? calibrator.result() : null;
    checks.push({
      id: "box",
      ok: calibration !== null,
      label: calibration ? `Step: ${estimateStepInches(calibration.boxHeightTorso)} in (est.)` : "Step (optional)",
      hint: calibration ? undefined : calibrator.instruction,
    });
    return checks;
  }

  function updateChecks(): void {
    const checks = checksWithBox();
    const calibration = calibrator.step === "done" ? calibrator.result() : null;
    if (app.camera) app.camera.calibration = calibration;
    const required = checks.filter((c) => c.id !== "box");
    const ready = required.every((c) => c.ok);
    const blocker = required.find((c) => !c.ok);

    checklist.replaceChildren(
      ...checks.map((c) =>
        h("li", { class: c.ok ? "ok" : c.id === "box" ? "optional" : "bad" }, h("span", { class: "mark", "aria-hidden": "true" }, c.ok ? "✓" : c.id === "box" ? "○" : "✗"), c.label, !c.ok && c.hint ? h("small", {}, c.hint) : null),
      ),
    );
    const readyText = calibration ? "Ready to start" : "Ready. Calibrating your step is optional";
    instruction.textContent = ready ? readyText : (blocker?.hint ?? "");
    instruction.classList.toggle("ready", ready);
    progress.value = calibrator.progress;
    progress.hidden = calibrator.step === "done" || !ready;
    startBtn.disabled = !ready;

    if (ready) {
      if (!announcedReady) say("Ready. Tap start when you are set.");
      announcedReady = true;
    } else {
      announcedReady = false;
      if (blocker?.hint) say(blocker.hint);
    }
  }

  function onCameraError(message: string): void {
    if (getSettings().audioMode !== "off") speech.say(message);
    showError(message);
  }

  function onFrame(frame: PoseFrame): void {
    recent.push(frame);
    if (recent.length > RECENT_FRAMES) recent.shift();
    calibrator.push(frame);
    drawPose(canvas, frame, video);
  }

  function fitCamera(): void {
    if (video.videoWidth) cam.style.setProperty("--ar", `${video.videoWidth} / ${video.videoHeight}`);
  }

  function applyFacing(): void {
    cam.classList.toggle("mirror", facing === "user");
  }

  async function flip(): Promise<void> {
    const session = app.camera;
    if (!session) return;
    flipBtn.disabled = true;
    facing = facing === "environment" ? "user" : "environment";
    try {
      session.stream.getTracks().forEach((t) => t.stop());
      const stream = await openCameraFacing(video, facing);
      if (disposed) return void stream.getTracks().forEach((t) => t.stop());
      session.stream = stream;
      session.facing = facing;
      calibrator = new BoxCalibrator();
      recent = [];
      applyFacing();
      session.engine.start(video, onFrame, onCameraError);
    } catch (err) {
      showError(cameraErrorMessage(err));
    }
    flipBtn.disabled = false;
  }

  function onStart(): void {
    if (!app.camera) return;
    speech.unlock();
    handedOff = true;
    app.mode = "camera";
    go("workout");
  }

  async function init(): Promise<void> {
    try {
      const stream = await openCameraFacing(video, facing);
      if (disposed) return void stream.getTracks().forEach((t) => t.stop());
      video.addEventListener("loadedmetadata", fitCamera);
      fitCamera();
      status.textContent = "Loading pose model…";
      const engine = await PoseEngine.create();
      if (disposed) {
        engine.close();
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      app.camera = { video, stream, engine, calibration: null, facing };
      applyFacing();
      engine.start(video, onFrame, onCameraError);
      status.hidden = true;
      flipBtn.disabled = false;
      checkTimer = window.setInterval(updateChecks, CHECK_INTERVAL_MS);
      updateChecks();
    } catch (err) {
      const phase = status.textContent?.startsWith("Loading") ? "The pose model could not be loaded. " : "";
      showError(phase + cameraErrorMessage(err));
    }
  }

  void init();

  return () => {
    disposed = true;
    window.clearInterval(checkTimer);
    if (!handedOff) {
      speech.clear();
      if (app.camera) closeCamera();
      else video.srcObject && (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
    }
  };
};
