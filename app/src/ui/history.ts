import type { WorkoutRecord } from "../types";
import { formatClock, formatDelta } from "../core/format";
import { revolutionSplits, setSplits } from "../core/pacing";
import { summarize } from "../core/stats";
import { deleteWorkout, exportWorkoutsJson, listWorkouts } from "../platform/storage";
import { getSettings } from "../platform/settings";
import { paceGraph, projectionGraph } from "./charts";
import { h, present } from "./dom";
import { go } from "./router";
import type { Screen } from "./router";

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

async function exportJson(text: string): Promise<void> {
  const name = `chad-workouts-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([text], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Chad workouts" });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function topBar(title: string, back: () => void, ...actions: Node[]): HTMLElement {
  return h("header", { class: "topbar" }, h("button", { type: "button", class: "btn round", "aria-label": "Back", onClick: back }, "‹"), h("h2", {}, title), ...actions);
}

export const historyScreen: Screen = (root, [id]) => {
  const main = h("main", { class: "screen history" });
  root.append(main);

  let unmounted = false;

  void (async () => {
    const all = await listWorkouts();
    if (unmounted) return;
    const record = id ? all.find((r) => r.id === id) : undefined;
    if (record) main.replaceChildren(...detailView(record, all));
    else main.replaceChildren(...listView(all));
  })();

  return () => {
    unmounted = true;
  };
};

function listView(all: WorkoutRecord[]): Node[] {
  const items = all.map((r) => {
    const summary = summarize(r, all);
    const done = r.actualTimeSec !== null;
    return h(
      "li",
      {},
      h(
        "button",
        { type: "button", class: "history-row", onClick: () => go(`history/${r.id}`) },
        h("span", { class: "date" }, dateFormat.format(new Date(r.date))),
        h("span", { class: "time mono" }, done ? formatClock(summary.timeSec) : `${r.totalReps} reps`),
        done ? (summary.isPR ? h("span", { class: "pr-badge small" }, "PR") : h("span", {})) : h("span", { class: "tag" }, "Incomplete"),
      ),
    );
  });
  return [
    topBar("History", () => go("home"), h("button", { type: "button", class: "btn small", disabled: all.length === 0, onClick: async () => exportJson(await exportWorkoutsJson()) }, "Export")),
    items.length ? h("ul", { class: "history-list" }, ...items) : h("p", { class: "empty" }, "No workouts yet. Finish a Chad and it shows up here."),
  ];
}

function detailView(record: WorkoutRecord, all: WorkoutRecord[]): Node[] {
  const summary = summarize(record, all);
  const done = record.actualTimeSec !== null;
  const revs = revolutionSplits(record.plan, record.revolutions);
  const sets = setSplits(record.sets);
  const kv = (label: string, value: string) => h("div", { class: "kv" }, h("span", {}, label), h("b", { class: "mono" }, value));
  const projection = projectionGraph(record, getSettings().rollingWindowSec);

  return present([
    topBar(dateFormat.format(new Date(record.date)), () => go("history")),
    h("div", { class: "big-time mono" }, formatClock(summary.timeSec), summary.isPR ? h("span", { class: "pr-badge" }, "PR") : null, !done ? h("span", { class: "tag" }, `Incomplete · ${record.totalReps} reps`) : null),
    h(
      "div",
      { class: "kv-grid" },
      kv("Target", formatClock(summary.targetSec)),
      kv("Actual", formatClock(summary.timeSec)),
      kv("Difference", summary.deltaSec === null ? "—" : formatDelta(summary.deltaSec)),
      kv("Average pace", `${summary.avgRpm.toFixed(2)}/min`),
      kv("Structure", `${record.plan.setSize} × ${record.plan.setsPerRevolution}`),
      kv("Counting", record.countingMode === "camera" ? "Camera" : "Manual"),
    ),
    h("h3", {}, "Pace graph"),
    paceGraph(record),
    projection ? h("h3", {}, "Projected finish") : null,
    projection,
    revs.length
      ? h(
          "div",
          {},
          h("h3", {}, "Revolutions"),
          h(
            "table",
            { class: "splits" },
            h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "Time"), h("th", {}, "Target"), h("th", {}, "Delta"))),
            h("tbody", {}, ...revs.map((s) => h("tr", {}, h("td", {}, s.revolutionNumber), h("td", { class: "mono" }, formatClock(s.durationSec)), h("td", { class: "mono" }, formatClock(s.targetSec)), h("td", { class: `mono ${s.deltaSec >= 0 ? "ahead" : "behind"}` }, formatDelta(s.deltaSec))))),
          ),
        )
      : null,
    sets.length
      ? h("div", {}, h("h3", {}, "Sets"), h("ul", { class: "set-times" }, ...sets.map((s) => h("li", {}, h("span", {}, `Set ${s.setNumber}`), h("b", { class: "mono" }, formatClock(s.durationSec))))))
      : null,
    h(
      "button",
      {
        type: "button",
        class: "btn danger",
        onClick: async () => {
          if (!confirm("Delete this workout?")) return;
          await deleteWorkout(record.id);
          go("history");
        },
      },
      "Delete workout",
    ),
  ]);
}
