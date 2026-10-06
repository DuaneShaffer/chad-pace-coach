import { TOTAL_REPS, repsPerRevolution } from "../types";
import type { CountingMode, WorkoutPlan } from "../types";
import { formatClock } from "../core/format";
import { savePlan } from "../platform/settings";
import { speech } from "../platform/speech";
import { app } from "./appState";
import { stepper, openSheet, wheel } from "./controls";
import { h, svg } from "./dom";
import { go } from "./router";
import type { Screen } from "./router";

const TARGET_PRESETS_MIN = [45, 50, 55, 60, 65, 70, 75, 80, 90];
const SET_SIZE_PRESETS = [10, 25, 50];
const MIN_TARGET_SEC = 600;
const MAX_TARGET_SEC = 10800;
const SECONDS_STEP = 5;

export const homeScreen: Screen = (root) => {
  const plan: WorkoutPlan = { ...app.plan };
  let mode: CountingMode = app.mode;
  let customSet = !SET_SIZE_PRESETS.includes(plan.setSize);

  const targetStepper = stepper({
    value: plan.targetTimeSec,
    min: MIN_TARGET_SEC,
    max: MAX_TARGET_SEC,
    step: 60,
    fastStep: 300,
    format: formatClock,
    label: "target time",
    className: "target-stepper",
    onValueTap: openTimeSheet,
    onChange: refresh,
  });
  const presetRow = h("div", { class: "chips scroll", role: "group", "aria-label": "Target presets" });
  const setRow = h("div", { class: "chips" });
  const setsStepper = stepper({ value: plan.setsPerRevolution, min: 1, max: 20, step: 1, label: "sets per revolution", onChange: (v) => ((plan.setsPerRevolution = v), refresh()) });
  const derived = h("div", { class: "derived" });
  const modeRow = h("div", { class: "segmented" });
  const continueBtn = h("button", { type: "button", class: "btn primary huge", onClick: onContinue }, "Continue");

  const chip = (label: string, active: boolean, onClick: () => void) =>
    h("button", { class: `chip${active ? " active" : ""}`, type: "button", "aria-pressed": String(active), onClick }, label);

  function targetSec(): number {
    return targetStepper.get();
  }

  function openTimeSheet(): void {
    const current = targetSec();
    const minutes = wheel(Array.from({ length: MAX_TARGET_SEC / 60 - MIN_TARGET_SEC / 60 + 1 }, (_, i) => MIN_TARGET_SEC / 60 + i), Math.floor(current / 60), String, "Minutes");
    const seconds = wheel(Array.from({ length: 60 / SECONDS_STEP }, (_, i) => i * SECONDS_STEP), Math.round((current % 60) / SECONDS_STEP) * SECONDS_STEP, (v) => String(v).padStart(2, "0"), "Seconds");
    const sheet = openSheet("Target time", () => {
      const sec = Math.min(MAX_TARGET_SEC, Math.max(MIN_TARGET_SEC, minutes.value() * 60 + seconds.value()));
      targetStepper.set(sec);
      refresh();
    });
    sheet.body.append(h("div", { class: "wheels" }, h("div", { class: "wheel-col" }, h("small", {}, "min"), minutes.el), h("div", { class: "wheel-col" }, h("small", {}, "sec"), seconds.el), h("div", { class: "wheel-band", "aria-hidden": "true" })));
  }

  function openSetSizeSheet(): void {
    const previous = { size: plan.setSize, custom: customSet };
    const size = stepper({ value: plan.setSize, min: 1, max: TOTAL_REPS, step: 1, fastStep: 10, label: "set size", className: "big", onChange: () => {} });
    const sheet = openSheet(
      "Set size",
      () => {
        plan.setSize = size.get();
        customSet = !SET_SIZE_PRESETS.includes(plan.setSize);
        refresh();
      },
      () => {
        plan.setSize = previous.size;
        customSet = previous.custom;
        refresh();
      },
    );
    sheet.body.append(size.el, h("p", { class: "hint center" }, "Reps per set. Hold + or − to go faster."));
  }

  function scrollSelectedPreset(): void {
    const active = presetRow.querySelector<HTMLElement>(".chip.active");
    if (!active) return;
    presetRow.scrollLeft = active.offsetLeft - (presetRow.clientWidth - active.offsetWidth) / 2;
  }

  function refresh(): void {
    const sec = targetSec();
    presetRow.replaceChildren(
      ...TARGET_PRESETS_MIN.map((m) =>
        chip(String(m), sec === m * 60, () => {
          targetStepper.set(m * 60);
          refresh();
        }),
      ),
    );
    scrollSelectedPreset();
    setRow.replaceChildren(
      ...SET_SIZE_PRESETS.map((n) =>
        chip(String(n), !customSet && plan.setSize === n, () => {
          customSet = false;
          plan.setSize = n;
          refresh();
        }),
      ),
      chip(customSet ? String(plan.setSize) : "Custom", customSet, openSetSizeSheet),
    );
    setsStepper.set(plan.setsPerRevolution);
    const perRev = repsPerRevolution(plan);
    const revSec = (sec * perRev) / TOTAL_REPS;
    derived.replaceChildren(
      h("span", {}, h("b", { class: "mono" }, perRev), "/rev"),
      h("span", {}, h("b", { class: "mono" }, formatClock(revSec)), "/rev"),
      h("span", {}, h("b", { class: "mono" }, Math.ceil(TOTAL_REPS / perRev)), " revs"),
    );
    modeRow.replaceChildren(
      h("button", { type: "button", class: mode === "camera" ? "active" : "", onClick: () => ((mode = "camera"), refresh()) }, "Camera"),
      h("button", { type: "button", class: mode === "manual" ? "active" : "", onClick: () => ((mode = "manual"), refresh()) }, "Manual tap"),
    );
  }

  function onContinue(): void {
    plan.targetTimeSec = targetSec();
    app.plan = plan;
    app.mode = mode;
    savePlan({ plan, mode });
    speech.unlock();
    go(mode === "camera" ? "setup" : "workout");
  }

  const icon = (label: string, target: string, ...paths: string[]) =>
    h(
      "button",
      { type: "button", class: "icon-btn", "aria-label": label, onClick: () => go(target) },
      svg("svg", { viewBox: "0 0 24 24", width: 26, height: 26, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, ...paths.map((d) => svg("path", { d }))),
    );

  const field = (label: string, ...body: Node[]) => h("section", { class: "block" }, h("label", { class: "label" }, label), ...body);

  root.append(
    h(
      "main",
      { class: "screen home" },
      h(
        "header",
        { class: "home-head" },
        h("div", {}, h("h1", {}, "CHAD"), h("p", { class: "tagline" }, "1,000 step-ups")),
        icon("History", "history", "M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5", "M12 7v5l3 2"),
        icon("Settings", "settings", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"),
      ),
      h(
        "div",
        { class: "home-body" },
        h(
          "div",
          { class: "home-col" },
          field("Target finish", targetStepper.el, presetRow),
          field("Set size", setRow),
        ),
        h(
          "div",
          { class: "home-col" },
          h(
            "section",
            { class: "block" },
            h("div", { class: "inline spread" }, h("label", { class: "label" }, "Sets per revolution"), setsStepper.el),
            derived,
          ),
          field("Counting", modeRow),
          continueBtn,
        ),
      ),
    ),
  );
  refresh();
};
