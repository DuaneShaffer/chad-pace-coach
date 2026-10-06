import { TOTAL_REPS } from "../types";
import type { PoseFrame } from "../types";
import { CoachScript } from "../core/coach";
import { formatClock, formatDelta } from "../core/format";
import { computePace, revolutionSplits } from "../core/pacing";
import { WorkoutSession } from "../core/session";
import type { SessionUpdate } from "../core/session";
import { saveWorkout } from "../platform/storage";
import { getSettings } from "../platform/settings";
import { speech } from "../platform/speech";
import { ScreenWakeLock } from "../platform/wakeLock";
import { RepDetector } from "../vision/repDetector";
import { drawPose, setCameraProfile } from "../vision/poseEngine";
import { app } from "./appState";
import { closeCamera } from "./camera";
import { h, sleep, svg } from "./dom";
import { go } from "./router";
import type { Screen } from "./router";

const UI_INTERVAL_MS = 500;
const LONG_PRESS_MS = 700;
const LOW_POWER_KEY = "chad.lowPower";
const FLASH_MS = 4500;
const AHEAD_DEADBAND_SEC = 2;

type Phase = "ready" | "countdown" | "running" | "finishing" | "done";

const FINISH_HOLD_MS = 5000;
const TAP_DEBOUNCE_MS = 400;
const END_CONFIRM = "End workout? Your progress will be saved as incomplete.";

function loadLowPower(): boolean {
  try {
    return localStorage.getItem(LOW_POWER_KEY) !== "off";
  } catch {
    return true;
  }
}

function storeLowPower(on: boolean): void {
  try {
    localStorage.setItem(LOW_POWER_KEY, on ? "on" : "off");
  } catch {
    // preference is best-effort
  }
}

function icon(...paths: string[]): SVGElement {
  return svg(
    "svg",
    { viewBox: "0 0 24 24", width: 24, height: 24, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
    ...paths.map((d) => svg("path", { d })),
  );
}

const SPEAKER = "M4 9v6h4l5 4V5L8 9H4z";
const SOUND_WAVES = ["M16.5 8.5a5 5 0 0 1 0 7", "M19 6a8.5 8.5 0 0 1 0 12"];
const MUTED_CROSS = ["M16 9l5 6", "M21 9l-5 6"];
const DOTS = "M12 5h.01M12 12h.01M12 19h.01";

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setClass(el: Element, value: string): void {
  if (el.getAttribute("class") !== value) el.setAttribute("class", value);
}

function pace(rpm: number | null): string {
  return rpm === null || !isFinite(rpm) || rpm <= 0 ? "—" : rpm.toFixed(1);
}

export const workoutScreen: Screen = (root) => {
  const plan = app.plan;
  const settings = getSettings();
  const cameraMode = app.mode === "camera";
  const cam = cameraMode ? app.camera : null;
  if (cameraMode && !cam?.calibration) {
    go("setup");
    return;
  }

  const session = new WorkoutSession(plan, app.mode);
  const coach = new CoachScript(plan, settings);
  const wake = new ScreenWakeLock();
  const detector = cam?.calibration ? new RepDetector(cam.calibration, { confidenceThreshold: settings.repConfidenceThreshold }) : null;
  let phase: Phase = "ready";
  let disposed = false;
  let saved = false;
  let lastCoachSecond = -1;
  let uiTimer = 0;
  let flashTimer = 0;
  let finishTimer = 0;
  let lastTapAt = -Infinity;
  let lowPower = loadLowPower();
  let showCamera = false;
  let lastFps = 0;
  let setListSignature = "";
  let perfTimer = 0;
  const recordId = crypto.randomUUID();

  const count = h("div", { class: "count mono" }, "0");
  const clock = h("div", { class: "clock mono" }, "0:00");
  const delta = h("div", { class: "delta" }, "ON PACE");
  const need = h("div", { class: "need" });
  const statValues = {
    overall: h("b", { class: "mono" }),
    rolling: h("b", { class: "mono" }),
    projected: h("b", { class: "mono" }),
    remaining: h("b", { class: "mono" }),
  };
  const stat = (label: string, value: HTMLElement) => h("div", { class: "stat" }, h("span", {}, label), value);
  const revTitle = h("div", { class: "rev-title" });
  const setList = h("ul", { class: "sets" });
  const phaseBadge = h("div", { class: "phase" });
  const muteButtons: HTMLButtonElement[] = [];
  const makeMuteButton = () => {
    const btn = h("button", { type: "button", class: "btn small", onClick: toggleMute });
    muteButtons.push(btn);
    return btn;
  };
  const muteIcon = h("button", { type: "button", class: "btn icon", onClick: toggleMute });
  const cameraAlert = h("div", { class: "finish-bar", hidden: true, role: "alert" });
  const finishBar = h("div", { class: "finish-bar", hidden: true, role: "status" }, h("span", {}, "Finishing… saving shortly"), h("button", { type: "button", class: "btn small", onClick: () => correct(-1) }, "Undo"));
  const mainZone = h("section", cameraMode ? { class: "w-main" } : { class: "w-main tappable", role: "button", tabIndex: 0, "aria-label": "Tap to count a rep" }, h("div", { class: "count-wrap" }, count, h("div", { class: "of mono" }, `/ ${TOTAL_REPS.toLocaleString("en-US")}`)), clock, delta, need);
  const flash = h("div", { class: "flash", hidden: true, role: "status" });
  const overlay = h("div", { class: "overlay-screen" });
  const canvas = h("canvas", { class: "overlay" });
  const previewBox = cam ? h("div", { class: "preview tucked" }, h("div", { class: "cam" }, cam.video, canvas), phaseBadge) : null;
  const perfReadout = h("div", { class: "perf mono", hidden: true });
  const brand = h("span", { class: "brand" }, "CHAD");
  const powerBtn = h("button", { type: "button", class: "btn small", onClick: toggleLowPower });
  const cameraBtn = cam ? h("button", { type: "button", class: "btn small", onClick: toggleCamera }, "Show camera") : null;
  const perfBtn = h("button", { type: "button", class: "btn small", onClick: togglePerf }, "Performance readout");
  const menu = h("div", { class: "w-menu", hidden: true }, powerBtn, cameraBtn, perfBtn);
  const menuBtn = h("button", { type: "button", class: "btn icon", "aria-label": "More options", "aria-expanded": "false", onClick: toggleMenu }, icon(DOTS));

  if (cam) {
    cam.video.addEventListener("loadedmetadata", fitPreview);
    cam.video.addEventListener("resize", fitPreview);
    fitPreview();
    cam.video.classList.toggle("mirror", cam.facing === "user");
    canvas.classList.toggle("mirror", cam.facing === "user");
  }

  function fitPreview(): void {
    if (cam?.video.videoWidth) previewBox?.firstElementChild?.setAttribute("style", `--ar: ${cam.video.videoWidth} / ${cam.video.videoHeight}`);
  }

  root.append(
    h(
      "main",
      { class: `screen workout${cameraMode ? " with-cam" : ""}` },
      h("header", { class: "w-top" }, brand, muteIcon, menuBtn, h("button", { type: "button", class: "btn small danger end", onClick: onEnd }, "End")),
      menu,
      mainZone,
      h(
        "section",
        { class: "w-side" },
        h("div", { class: "stats" }, stat("Avg", statValues.overall), stat(`Last ${Math.round(settings.rollingWindowSec / 60)}m`, statValues.rolling), stat("Proj", statValues.projected), stat("Left", statValues.remaining)),
        h("div", { class: "rev" }, revTitle, setList),
      ),
      previewBox,
      perfReadout,
      cameraAlert,
      finishBar,
      h(
        "footer",
        { class: "w-controls" },
        h("button", { type: "button", class: "btn", onClick: () => correct(-1), "aria-label": "Remove one rep" }, "−1"),
        h("button", { type: "button", class: "btn", onClick: () => correct(1), "aria-label": "Add one rep" }, "+1"),
      ),
      flash,
      overlay,
    ),
  );

  function applyLowPower(): void {
    document.documentElement.classList.toggle("lowpower", lowPower);
    powerBtn.textContent = lowPower ? "Dim: on" : "Dim: off";
    powerBtn.setAttribute("aria-pressed", String(lowPower));
  }

  function toggleMenu(): void {
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute("aria-expanded", String(!menu.hidden));
  }

  function toggleLowPower(): void {
    lowPower = !lowPower;
    storeLowPower(lowPower);
    applyLowPower();
  }

  function toggleCamera(): void {
    showCamera = !showCamera;
    void cam?.video.play().catch(() => {});
    previewBox?.classList.toggle("tucked", !showCamera);
    if (cameraBtn) cameraBtn.textContent = showCamera ? "Hide camera" : "Show camera";
    if (!showCamera) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function togglePerf(): void {
    perfReadout.hidden = !perfReadout.hidden;
    window.clearInterval(perfTimer);
    if (perfReadout.hidden) return;
    perfTimer = window.setInterval(updatePerf, 1000);
    updatePerf();
  }

  function updatePerf(): void {
    const stats = cam?.engine.stats;
    setText(perfReadout, stats ? `${stats.fps.toFixed(1)} fps (target ${stats.targetFps})  ${stats.inferenceMs.toFixed(1)} ms/frame  ${detector?.phase ?? ""}` : "manual mode");
  }

  let brandPress = 0;
  brand.addEventListener("pointerdown", () => {
    brandPress = window.setTimeout(togglePerf, LONG_PRESS_MS);
  });
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) brand.addEventListener(type, () => window.clearTimeout(brandPress));

  function speakLines(lines: string[], droppable: boolean): void {
    if (settings.audioMode === "off") return;
    for (const line of lines) speech.say(line, { droppable });
  }

  function toggleMute(): void {
    speech.setMuted(!speech.muted);
    syncMute();
  }

  function syncMute(): void {
    muteIcon.replaceChildren(speech.muted ? icon(SPEAKER, ...MUTED_CROSS) : icon(SPEAKER, ...SOUND_WAVES));
    muteIcon.setAttribute("aria-label", speech.muted ? "Sound is off, tap to turn on" : "Sound is on, tap to turn off");
    muteIcon.setAttribute("aria-pressed", String(speech.muted));
    for (const btn of muteButtons) {
      btn.textContent = speech.muted ? "Sound off" : "Sound on";
      btn.setAttribute("aria-pressed", String(speech.muted));
    }
  }

  function showReady(): void {
    overlay.hidden = false;
    overlay.replaceChildren(
      h("div", { class: "ready" }, h("h2", {}, "Ready"), h("p", {}, `Target ${formatClock(plan.targetTimeSec)}  ·  ${plan.setSize} × ${plan.setsPerRevolution}`), h("button", { type: "button", class: "btn primary huge", onClick: () => void begin() }, "START"), makeMuteButton(), h("button", { type: "button", class: "btn link", onClick: () => go("home") }, "Cancel")),
    );
  }

  function showCountdown(text: string): void {
    overlay.replaceChildren(h("div", { class: "countdown mono" }, text));
  }

  async function begin(): Promise<void> {
    if (phase !== "ready") return;
    phase = "countdown";
    speech.unlock();
    startVision();
    if (settings.audioMode !== "off") speech.sayNow("3");
    showCountdown("3");
    for (const n of ["2", "1"]) {
      await sleep(1000);
      if (disposed) return;
      if (settings.audioMode !== "off") speech.sayNow(n);
      showCountdown(n);
    }
    await sleep(1000);
    if (disposed) return;
    showCountdown("GO");
    session.start();
    phase = "running";
    void wake.acquire();
    armLeaveGuard();
    speakLines(coach.onStart(), false);
    window.setTimeout(() => {
      if (phase === "running") overlay.hidden = true;
    }, 700);
  }

  function startVision(): void {
    if (!cam || !detector) return;
    void setCameraProfile(cam.stream, "workout");
    cam.engine.setBrightnessEnabled(false);
    void cam.video.play().catch(() => {});
    cam.engine.start(cam.video, onFrame, onCameraError);
  }

  function onCameraError(message: string): void {
    if (disposed) return;
    cameraAlert.hidden = false;
    cameraAlert.textContent = `${message}. Use −1 / +1 to keep counting.`;
    setText(phaseBadge, "lost");
    if (settings.audioMode !== "off") speech.sayNow(message);
  }

  function onFrame(frame: PoseFrame): void {
    if ((phase !== "running" && phase !== "countdown") || !detector) return;
    const candidate = detector.push(frame);
    const fps = detector.suggestedFps;
    if (cam && fps !== lastFps) {
      lastFps = fps;
      cam.engine.setTargetFps(fps);
    }
    if (showCamera && cam) {
      drawPose(canvas, frame, cam.video);
      setText(phaseBadge, detector.phase);
    }
    if (phase === "running" && candidate?.accepted) handleRep(candidate.confidence);
  }

  function handleRep(confidence: number): void {
    if (phase !== "running") return;
    applyUpdate(session.addRep(confidence));
  }

  function applyUpdate(update: SessionUpdate): void {
    const snap = session.snapshot(settings);
    speakLines(coach.onUpdate(update, snap), false);
    if (update.revolution && !update.completed) showRevolutionFlash(FLASH_MS);
    if (update.set && !update.completed) void checkpoint();
    render();
    if (update.completed) beginFinishing();
  }

  function correct(delta: number): void {
    if (phase === "running" && delta > 0) applyUpdate(session.addRep(1));
    else if (delta < 0 && (phase === "running" || phase === "finishing")) {
      session.removeLastRep();
      if (phase === "finishing") resumeFromFinishing();
      render();
    }
  }

  function beginFinishing(): void {
    phase = "finishing";
    finishBar.hidden = false;
    window.clearTimeout(finishTimer);
    finishTimer = window.setTimeout(() => void finalize(), FINISH_HOLD_MS);
  }

  function resumeFromFinishing(): void {
    window.clearTimeout(finishTimer);
    finishBar.hidden = true;
    phase = "running";
  }

  function showRevolutionFlash(durationMs: number): void {
    const splits = revolutionSplits(plan, session.toRecord().revolutions);
    const split = splits[splits.length - 1];
    if (!split) return;
    const ahead = split.deltaSec >= 0;
    flash.hidden = false;
    flash.className = `flash ${ahead ? "ahead" : "behind"}`;
    flash.replaceChildren(
      h("div", { class: "flash-title" }, `REVOLUTION ${split.revolutionNumber}`),
      h("div", { class: "flash-time mono" }, formatClock(split.durationSec)),
      h("div", { class: "flash-delta" }, `${formatDelta(split.deltaSec)} ${ahead ? "AHEAD" : "BEHIND"}`),
    );
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => (flash.hidden = true), durationMs);
  }

  function render(): void {
    const snap = session.started ? session.snapshot(settings) : computePace(plan, [], 0, settings.rollingWindowSec);
    setText(count, String(snap.reps));
    setText(clock, formatClock(snap.elapsedSec));

    const ahead = snap.aheadSec >= AHEAD_DEADBAND_SEC;
    const behind = snap.aheadSec <= -AHEAD_DEADBAND_SEC;
    setText(delta, ahead ? `${formatDelta(snap.aheadSec)} AHEAD` : behind ? `${formatDelta(snap.aheadSec)} BEHIND` : "ON PACE");
    setClass(delta, `delta ${ahead ? "ahead" : behind ? "behind" : ""}`);
    const needText =
      !behind || snap.requiredRpm === null
        ? ""
        : snap.requiredRealistic
          ? `NEED ${pace(snap.requiredRpm)} / MIN`
          : snap.projectedFinishSec !== null
            ? `ON PACE FOR ${formatClock(snap.projectedFinishSec)}`
            : "";
    setText(need, needText);

    setText(statValues.overall, pace(snap.overallRpm));
    setText(statValues.rolling, pace(snap.rollingRpm));
    setText(statValues.projected, snap.projectedFinishSec !== null && session.started && snap.reps > 0 ? formatClock(snap.projectedFinishSec) : "—");
    setText(statValues.remaining, String(snap.remainingReps));

    setText(revTitle, `REVOLUTION ${snap.revolution} / ${snap.totalRevolutions}`);
    const complete = snap.remainingReps === 0;
    const revStart = (snap.revolution - 1) * snap.repsPerRevolution;
    const repsInRevolution = Math.min(snap.repsPerRevolution, TOTAL_REPS - revStart);
    const setCount = Math.max(1, Math.ceil(repsInRevolution / plan.setSize));
    const signature = `${setCount}|${repsInRevolution}|${snap.setInRevolution}|${snap.repsIntoSet}|${complete}`;
    if (signature !== setListSignature) {
      setListSignature = signature;
      setList.replaceChildren(
        ...Array.from({ length: setCount }, (_, i) => {
          const state = complete || i + 1 < snap.setInRevolution ? "done" : i + 1 === snap.setInRevolution ? "current" : "todo";
          const glyph = state === "done" ? "✓" : state === "current" ? "●" : "○";
          const setEnd = Math.min((i + 1) * plan.setSize, repsInRevolution);
          const progress = state === "current" ? h("small", {}, `${snap.repsIntoSet}/${setEnd - i * plan.setSize}`) : null;
          return h("li", { class: state }, h("span", { "aria-hidden": "true" }, glyph), ` ${setEnd}`, progress);
        }),
      );
    }

    if (!cameraMode || phase !== "running") return;
    detector?.setContext({ repsIntoSet: snap.repsIntoSet, setSize: plan.setSize, reps: snap.reps });
  }

  function tick(): void {
    if (phase !== "running") return;
    render();
    const second = Math.floor(session.elapsedMs() / 1000);
    if (second !== lastCoachSecond) {
      lastCoachSecond = second;
      speakLines(coach.onTick(session.snapshot(settings)), true);
    }
  }

  function snapshotRecord() {
    return { ...session.toRecord(), id: recordId };
  }

  async function checkpoint(): Promise<void> {
    try {
      await saveWorkout(snapshotRecord());
    } catch {
      // checkpoint is best-effort
    }
  }

  async function persist(): Promise<string | null> {
    if (saved || !session.started || session.reps() === 0) return null;
    saved = true;
    try {
      await saveWorkout(snapshotRecord());
    } catch {
      saved = false;
      return null;
    }
    return recordId;
  }

  async function finalize(): Promise<void> {
    if (phase !== "finishing") return;
    phase = "done";
    window.clearTimeout(finishTimer);
    finishBar.hidden = true;
    closeCamera();
    wake.release();
    const id = await persist();
    if (!disposed) go(id ? `complete/${id}` : "home");
  }

  async function endEarly(): Promise<void> {
    phase = "done";
    speech.clear();
    closeCamera();
    const id = await persist();
    go(id ? `history/${id}` : "home");
  }

  function onEnd(): void {
    if (phase === "done") return;
    if (phase === "finishing") return void finalize();
    if (phase === "running" && !confirm(END_CONFIRM)) return;
    void endEarly();
  }

  function isActive(): boolean {
    return phase === "running" || phase === "finishing";
  }

  function onPopState(): void {
    if (!isActive()) return;
    history.pushState({ chadGuard: true }, "");
    if (phase === "running" && confirm(END_CONFIRM)) void endEarly();
  }

  function onBeforeUnload(e: BeforeUnloadEvent): void {
    if (isActive()) e.preventDefault();
  }

  function armLeaveGuard(): void {
    history.pushState({ chadGuard: true }, "");
    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onBeforeUnload);
  }

  function manualTap(): void {
    const now = performance.now();
    if (phase !== "running" || now - lastTapAt < TAP_DEBOUNCE_MS) return;
    lastTapAt = now;
    handleRep(1);
  }

  if (!cameraMode) {
    mainZone.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary) return;
      e.preventDefault();
      manualTap();
    });
    mainZone.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      manualTap();
    });
  }

  applyLowPower();
  showReady();
  syncMute();
  render();
  uiTimer = window.setInterval(tick, UI_INTERVAL_MS);

  return () => {
    disposed = true;
    window.clearInterval(uiTimer);
    window.clearInterval(perfTimer);
    window.clearTimeout(brandPress);
    document.documentElement.classList.remove("lowpower");
    window.clearTimeout(flashTimer);
    window.clearTimeout(finishTimer);
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("beforeunload", onBeforeUnload);
    wake.release();
    if (!session.completed) speech.clear();
    void persist();
    closeCamera();
  };
};
