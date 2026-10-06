import { DEFAULT_SETTINGS } from "../types";
import type { AudioMode, Settings } from "../types";
import { getSettings, saveSettings, savePlan } from "../platform/settings";
import { app } from "./appState";
import { speech } from "../platform/speech";
import { h } from "./dom";
import { go } from "./router";
import type { Screen } from "./router";

const AUDIO_MODES: { id: AudioMode; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "Silent." },
  { id: "reps", label: "Rep coach", hint: "Calls rep milestones and revolutions." },
  { id: "pace", label: "Pace coach", hint: "Announces ahead/behind status." },
  { id: "full", label: "Full coach", hint: "Milestones plus pace feedback." },
];

type NumericKey = Exclude<keyof Settings, "audioMode">;

const NUMERIC: { key: NumericKey; label: string; unit: string; min: number; max: number; step: number }[] = [
  { key: "paceQuietThresholdSec", label: "Stay quiet under", unit: "sec", min: 0, max: 120, step: 1 },
  { key: "paceOccasionalThresholdSec", label: "Occasional status from", unit: "sec", min: 0, max: 120, step: 1 },
  { key: "paceProminentThresholdSec", label: "Prominent feedback from", unit: "sec", min: 0, max: 300, step: 1 },
  { key: "paceCorrectionThresholdSec", label: "Explicit correction from", unit: "sec", min: 0, max: 600, step: 1 },
  { key: "repConfidenceThreshold", label: "Rep confidence threshold", unit: "0–1", min: 0.3, max: 0.99, step: 0.01 },
  { key: "rollingWindowSec", label: "Rolling pace window", unit: "sec", min: 30, max: 900, step: 30 },
];

const THRESHOLD_ORDER: NumericKey[] = ["paceQuietThresholdSec", "paceOccasionalThresholdSec", "paceProminentThresholdSec", "paceCorrectionThresholdSec"];

export const settingsScreen: Screen = (root) => {
  const settings: Settings = { ...getSettings() };
  const modeRow = h("div", { class: "segmented four" });
  const modeHint = h("p", { class: "hint" });
  const inputs = new Map<NumericKey, HTMLInputElement>();

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
    for (const [key, input] of inputs) input.value = String(settings[key]);
  }

  function enforceOrder(changed: NumericKey): void {
    const at = THRESHOLD_ORDER.indexOf(changed);
    if (at < 0) return;
    for (let i = at + 1; i < THRESHOLD_ORDER.length; i++) settings[THRESHOLD_ORDER[i]] = Math.max(settings[THRESHOLD_ORDER[i]], settings[THRESHOLD_ORDER[i - 1]]);
    for (let i = at - 1; i >= 0; i--) settings[THRESHOLD_ORDER[i]] = Math.min(settings[THRESHOLD_ORDER[i]], settings[THRESHOLD_ORDER[i + 1]]);
  }

  const numericRows = NUMERIC.map((n) => {
    const input = h("input", { class: "field small mono", type: "number", min: n.min, max: n.max, step: n.step, value: settings[n.key] });
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (input.value.trim() !== "" && Number.isFinite(v)) {
        settings[n.key] = Math.min(n.max, Math.max(n.min, v));
        enforceOrder(n.key);
        persist();
      }
      syncInputs();
    });
    inputs.set(n.key, input);
    return h("label", { class: "setting-row" }, h("span", {}, n.label, h("small", {}, ` ${n.unit}`)), input);
  });

  const boxInput = h("input", { class: "field small mono", type: "number", min: 1, max: 60, step: 0.5, value: app.plan.boxHeightIn });
  boxInput.addEventListener("change", () => {
    const v = Number(boxInput.value);
    if (boxInput.value.trim() !== "" && Number.isFinite(v)) {
      app.plan = { ...app.plan, boxHeightIn: Math.min(60, Math.max(1, v)) };
      savePlan({ plan: app.plan, mode: app.mode });
    }
    boxInput.value = String(app.plan.boxHeightIn);
  });

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
      h("section", { class: "block" }, h("label", { class: "label" }, "Box"), h("label", { class: "setting-row" }, h("span", {}, "Box height", h("small", {}, " inches")), boxInput)),
      h("section", { class: "block" }, h("label", { class: "label" }, "Pace and counting"), ...numericRows),
      h("button", { type: "button", class: "btn", onClick: reset }, "Reset to defaults"),
    ),
  );
  renderMode();
};
