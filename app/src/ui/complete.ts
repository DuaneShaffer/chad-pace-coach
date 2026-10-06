import { formatClock, formatDelta } from "../core/format";
import { summarize } from "../core/stats";
import { getWorkout, listWorkouts } from "../platform/storage";
import { h, present } from "./dom";
import { go } from "./router";
import type { Screen } from "./router";

export const completeScreen: Screen = (root, [id]) => {
  const main = h("main", { class: "screen complete" }, h("p", {}, "Loading…"));
  root.append(main);
  let unmounted = false;

  void (async () => {
    const record = id ? await getWorkout(id) : undefined;
    const all = record ? await listWorkouts() : [];
    if (unmounted) return;
    if (!record) return go("home");
    const summary = summarize(record, all);
    const faster = summary.deltaSec !== null && summary.deltaSec >= 0;
    const row = (label: string, value: string) => h("div", { class: "kv" }, h("span", {}, label), h("b", { class: "mono" }, value));

    main.replaceChildren(
      ...present([h("h1", { class: "title" }, record.actualTimeSec === null ? "CHAD ENDED" : "CHAD COMPLETE"),
      summary.isPR ? h("div", { class: "pr-badge" }, "NEW PR") : null,
      h("div", { class: "big-time mono" }, formatClock(summary.timeSec)),
      h("div", { class: `delta ${faster ? "ahead" : "behind"}` }, summary.deltaSec === null ? `DNF — goal ${formatClock(summary.targetSec)}` : `${formatDelta(summary.deltaSec)} vs goal ${formatClock(summary.targetSec)}`),
      h(
        "div",
        { class: "kv-grid" },
        row("Goal", formatClock(summary.targetSec)),
        row("Average pace", `${summary.avgRpm.toFixed(2)}/min`),
        row("Revolutions", String(summary.revolutions)),
        row("Fastest revolution", summary.fastestRevSec !== null ? formatClock(summary.fastestRevSec) : "—"),
        row("Slowest revolution", summary.slowestRevSec !== null ? formatClock(summary.slowestRevSec) : "—"),
      ),
      h("p", { class: "saved" }, "Result saved"),
      h("button", { type: "button", class: "btn primary huge", onClick: () => go("home") }, "Done"),
      h("button", { type: "button", class: "btn", onClick: () => go(`history/${record.id}`) }, "View details"),
    ]));
  })();
  return () => {
    unmounted = true;
  };
};
