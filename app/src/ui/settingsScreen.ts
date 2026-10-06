import { DEFAULT_SETTINGS } from "../types";
import type { AudioMode, Settings } from "../types";
import { getSettings, saveSettings, savePlan } from "../platform/settings";
import { app } from "./appState";
import { speech } from "../platform/speech";
import { stepper } from "./controls";
import type { Stepper } from "./controls";
import { h } from "./dom";
import { playSplash } from "./splash";
import { go } from "./router";
import type { Screen } from "./router";

const AUDIO_MODES: { id: AudioMode; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "Silent." },
  { id: "reps", label: "Rep coach", hint: "Calls rep milestones and revolutions." },
  { id: "pace", label: "Pace coach", hint: "Announces ahead/behind status." },
  { id: "full", label: "Full coach", hint: "Milestones plus pace feedback." },
];

const sec = (v: number) => `${v}s`;

type NumericKey = Exclude<keyof Settings, "audioMode">;

const NUMERIC: { key: NumericKey; label: string; format: (v: number) => string; min: number; max: number; step: number }[] = [
  { key: "paceQuietThresholdSec", label: "Stay quiet under", format: sec, min: 0, max: 120, step: 5 },
  { key: "paceOccasionalThresholdSec", label: "Occasional status from", format: sec, min: 0, max: 120, step: 5 },
  { key: "paceProminentThresholdSec", label: "Prominent feedback from", format: sec, min: 0, max: 300, step: 5 },
  { key: "paceCorrectionThresholdSec", label: "Explicit correction from", format: sec, min: 0, max: 600, step: 5 },
  { key: "repConfidenceThreshold", label: "Rep confidence threshold", format: (v) => v.toFixed(2), min: 0.3, max: 0.99, step: 0.05 },
  { key: "rollingWindowSec", label: "Rolling pace window", format: sec, min: 30, max: 900, step: 30 },
];

const THRESHOLD_ORDER: NumericKey[] = ["paceQuietThresholdSec", "paceOccasionalThresholdSec", "paceProminentThresholdSec", "paceCorrectionThresholdSec"];

export const settingsScreen: Screen = (root) => {
  const settings: Settings = { ...getSettings() };
  const modeRow = h("div", { class: "segmented four" });
  const modeHint = h("p", { class: "hint" });
  const steppers = new Map<NumericKey, Stepper>();

  function persist(): void {
    saveSettings({ ...settings });
  }

  function renderMode(): void {
    modeRow.replaceChildren(
      ...AUDIO_MODES.map((m) =>
        h("button", { type: "button", class: settings.audioMode === m.id ? "active" : "", onClick: () => ((settings.audioMode = m.id), persist(), renderMode()) }, m.label),
      ),
    );
    modeHint.textContent = AUDIO_MODES.find((m) => m.id === settings.audioMode)?.hint ?? "";
  }

  function syncInputs(): void {
    for (const [key, control] of steppers) control.set(settings[key]);
  }

  function enforceOrder(changed: NumericKey): void {
    const at = THRESHOLD_ORDER.indexOf(changed);
    if (at < 0) return;
    for (let i = at + 1; i < THRESHOLD_ORDER.length; i++) settings[THRESHOLD_ORDER[i]] = Math.max(settings[THRESHOLD_ORDER[i]], settings[THRESHOLD_ORDER[i - 1]]);
    for (let i = at - 1; i >= 0; i--) settings[THRESHOLD_ORDER[i]] = Math.min(settings[THRESHOLD_ORDER[i]], settings[THRESHOLD_ORDER[i + 1]]);
  }

  const numericRows = NUMERIC.map((n) => {
    const control = stepper({
      value: settings[n.key],
      min: n.min,
      max: n.max,
      step: n.step,
      format: n.format,
      label: n.label,
      onChange: (v) => {
        settings[n.key] = v;
        enforceOrder(n.key);
        persist();
        syncInputs();
      },
    });
    steppers.set(n.key, control);
    return h("div", { class: "setting-row" }, h("span", {}, n.label), control.el);
  });

  const boxControl = stepper({
    value: app.plan.boxHeightIn,
    min: 1,
    max: 60,
    step: 1,
    format: (v) => `${v}"`,
    label: "box height",
    onChange: (v) => {
      app.plan = { ...app.plan, boxHeightIn: v };
      savePlan({ plan: app.plan, mode: app.mode });
    },
  });

  function replayIntro(): void {
    go("home");
    window.setTimeout(() => playSplash({ full: true }), 60);
  }

  function testVoice(): void {
    speech.unlock();
    speech.setMuted(false);
    speech.sayNow("Chad pace coach. You're 22 seconds ahead. Keep it smooth.");
  }

  function reset(): void {
    Object.assign(settings, DEFAULT_SETTINGS);
    persist();
    renderMode();
    syncInputs();
  }

  root.append(
    h(
      "main",
      { class: "screen settings" },
      h("header", { class: "topbar" }, h("button", { type: "button", class: "btn round", "aria-label": "Back", onClick: () => go("home") }, "‹"), h("h2", {}, "Settings")),
      h("section", { class: "block" }, h("label", { class: "label" }, "Audio"), modeRow, modeHint, h("button", { type: "button", class: "btn", onClick: testVoice }, "Test voice")),
      h("section", { class: "block" }, h("label", { class: "label" }, "Box"), h("div", { class: "setting-row" }, h("span", {}, "Box height"), boxControl.el)),
      h("section", { class: "block" }, h("label", { class: "label" }, "Pace and counting"), ...numericRows),
      h("section", { class: "block" }, h("label", { class: "label" }, "Intro"), h("button", { type: "button", class: "btn", onClick: replayIntro }, "Replay intro")),
      h("button", { type: "button", class: "btn", onClick: reset }, "Reset to defaults"),
    ),
  );
  renderMode();
};
