import { TOTAL_REPS, repsPerRevolution } from "../types";
import type { CountingMode, WorkoutPlan } from "../types";
import { formatClock, isPlausibleTarget, parseClock } from "../core/format";
import { savePlan } from "../platform/settings";
import { speech } from "../platform/speech";
import { app } from "./appState";
import { h, svg } from "./dom";
import { go } from "./router";
import type { Screen } from "./router";

const TARGET_PRESETS_MIN = [60, 65, 70, 75];
const SET_SIZE_PRESETS = [10, 25, 50];

export const homeScreen: Screen = (root) => {
  const plan: WorkoutPlan = { ...app.plan };
  let mode: CountingMode = app.mode;
  let customSet = !SET_SIZE_PRESETS.includes(plan.setSize);

  const timeInput = h("input", { class: "field mono", type: "text", inputMode: "numeric", value: formatClock(plan.targetTimeSec), "aria-label": "Target time, minutes and seconds", autocomplete: "off" });
  const presetRow = h("div", { class: "chips" });
  const setRow = h("div", { class: "chips" });
  const customInput = h("input", { class: "field small mono", type: "number", min: 1, max: 1000, value: plan.setSize, "aria-label": "Custom set size" });
  const stepValue = h("output", { class: "stepper-value mono" });
  const derived = h("div", { class: "derived" });
  const modeRow = h("div", { class: "segmented" });
  const error = h("p", { class: "error", role: "alert" });
  const continueBtn = h("button", { type: "button", class: "btn primary huge", onClick: onContinue }, "Continue");

  const chip = (label: string, active: boolean, onClick: () => void) =>
    h("button", { class: `chip${active ? " active" : ""}`, type: "button", onClick }, label);

  function targetSec(): number | null {
    const sec = parseClock(timeInput.value);
    return sec !== null && isPlausibleTarget(sec) ? sec : null;
  }

  function customSetSize(): number | null {
    const n = Number(customInput.value);
    return customInput.value.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= TOTAL_REPS ? n : null;
  }

  function currentError(): string {
    if (targetSec() === null) return "Enter a target time between 10:00 and 3:00:00.";
    if (customSet && customSetSize() === null) return "Set size must be a whole number from 1 to 1000.";
    return "";
  }

  function refresh(): void {
    const sec = targetSec();
    presetRow.replaceChildren(
      ...TARGET_PRESETS_MIN.map((m) =>
        chip(`${m}:00`, sec === m * 60, () => {
          timeInput.value = `${m}:00`;
          refresh();
        }),
      ),
    );
    setRow.replaceChildren(
      ...SET_SIZE_PRESETS.map((n) =>
        chip(String(n), !customSet && plan.setSize === n, () => {
          customSet = false;
          plan.setSize = n;
          refresh();
        }),
      ),
      chip("Custom", customSet, () => {
        customSet = true;
        customInput.value = String(plan.setSize);
        refresh();
        customInput.focus();
      }),
    );
    customInput.hidden = !customSet;
    stepValue.textContent = String(plan.setsPerRevolution);
    const perRev = repsPerRevolution(plan);
    const revSec = sec !== null ? (sec * perRev) / TOTAL_REPS : null;
    derived.replaceChildren(
      h("span", {}, h("b", { class: "mono" }, perRev), "/rev"),
      h("span", {}, h("b", { class: "mono" }, revSec !== null ? formatClock(revSec) : "—"), "/rev"),
      h("span", {}, h("b", { class: "mono" }, Math.ceil(TOTAL_REPS / perRev)), " revs"),
    );
    const message = currentError();
    error.textContent = message;
    continueBtn.disabled = message !== "";
    modeRow.replaceChildren(
      h("button", { type: "button", class: mode === "camera" ? "active" : "", onClick: () => ((mode = "camera"), refresh()) }, "Camera"),
      h("button", { type: "button", class: mode === "manual" ? "active" : "", onClick: () => ((mode = "manual"), refresh()) }, "Manual tap"),
    );
  }

  timeInput.addEventListener("input", refresh);
  customInput.addEventListener("input", () => {
    const n = customSetSize();
    if (n !== null) plan.setSize = n;
    refresh();
  });

  function stepSets(delta: number): void {
    plan.setsPerRevolution = Math.min(20, Math.max(1, plan.setsPerRevolution + delta));
    refresh();
  }

  function onContinue(): void {
    const sec = targetSec();
    if (sec === null || currentError()) return refresh();
    plan.targetTimeSec = sec;
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
          field("Target finish", timeInput, presetRow),
          field("Set size", h("div", { class: "inline" }, setRow, customInput)),
        ),
        h(
          "div",
          { class: "home-col" },
          h(
            "section",
            { class: "block" },
            h(
              "div",
              { class: "inline spread" },
              h("label", { class: "label" }, "Sets per revolution"),
              h(
                "div",
                { class: "stepper" },
                h("button", { type: "button", class: "btn round", "aria-label": "Fewer sets", onClick: () => stepSets(-1) }, "−"),
                stepValue,
                h("button", { type: "button", class: "btn round", "aria-label": "More sets", onClick: () => stepSets(1) }, "+"),
              ),
            ),
            derived,
          ),
          field("Counting", modeRow),
          error,
          continueBtn,
        ),
      ),
    ),
  );
  refresh();
};
