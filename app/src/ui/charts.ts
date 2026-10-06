import { TOTAL_REPS } from "../types";
import type { WorkoutRecord } from "../types";
import { computePace } from "../core/pacing";
import { svg } from "./dom";

const W = 640;
const H = 340;
const M = { l: 54, r: 14, t: 14, b: 40 };
const PLOT_W = W - M.l - M.r;
const PLOT_H = H - M.t - M.b;
const PROJECTION_STEP_SEC = 20;
const PROJECTION_START_SEC = 90;

function niceStep(range: number, targetTicks: number): number {
  const raw = range / targetTicks;
  const steps = [1, 2, 5, 10, 15, 20, 30, 60, 100, 250, 500];
  return steps.find((s) => s >= raw) ?? steps[steps.length - 1];
}

function ticks(min: number, max: number, count: number): number[] {
  const step = niceStep(max - min, count);
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

interface Axes {
  xMax: number;
  yMin: number;
  yMax: number;
  xLabel: string;
  yLabel: string;
  yFormat?: (v: number) => string;
}

function frame(axes: Axes, ...series: SVGElement[]): SVGSVGElement {
  const x = (v: number) => M.l + (v / axes.xMax) * PLOT_W;
  const y = (v: number) => M.t + PLOT_H - ((v - axes.yMin) / (axes.yMax - axes.yMin)) * PLOT_H;
  const grid: SVGElement[] = [];
  for (const v of ticks(axes.yMin, axes.yMax, 5)) {
    grid.push(
      svg("line", { class: "grid", x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }),
      svg("text", { class: "tick", x: M.l - 8, y: y(v) + 4, "text-anchor": "end" }, axes.yFormat ? axes.yFormat(v) : String(v)),
    );
  }
  for (const v of ticks(0, axes.xMax, 6)) {
    grid.push(svg("text", { class: "tick", x: x(v), y: H - M.b + 18, "text-anchor": "middle" }, String(v)));
  }
  const chart = svg(
    "svg",
    { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": `${axes.yLabel} over ${axes.xLabel}` },
    ...grid,
    svg("line", { class: "axis", x1: M.l, x2: W - M.r, y1: y(axes.yMin), y2: y(axes.yMin) }),
    svg("line", { class: "axis", x1: M.l, x2: M.l, y1: M.t, y2: y(axes.yMin) }),
    svg("text", { class: "axis-label", x: M.l + PLOT_W / 2, y: H - 6, "text-anchor": "middle" }, axes.xLabel),
    svg("text", { class: "axis-label", x: 12, y: M.t + PLOT_H / 2, "text-anchor": "middle", transform: `rotate(-90 12 ${M.t + PLOT_H / 2})` }, axes.yLabel),
    ...series,
  );
  return chart;
}

function line(points: [number, number][], cls: string, axes: Axes): SVGElement {
  const x = (v: number) => M.l + (v / axes.xMax) * PLOT_W;
  const y = (v: number) => M.t + PLOT_H - ((v - axes.yMin) / (axes.yMax - axes.yMin)) * PLOT_H;
  return svg("polyline", { class: cls, fill: "none", points: points.map(([px, py]) => `${x(px).toFixed(1)},${y(py).toFixed(1)}`).join(" ") });
}

function legend(items: { cls: string; label: string }[], x: number): SVGElement[] {
  return items.flatMap((item, i) => [
    svg("line", { class: item.cls, x1: x, x2: x + 22, y1: M.t + 12 + i * 18, y2: M.t + 12 + i * 18 }),
    svg("text", { class: "legend", x: x + 28, y: M.t + 16 + i * 18 }, item.label),
  ]);
}

function recordEndSec(record: WorkoutRecord): number {
  const last = record.reps[record.reps.length - 1];
  return record.actualTimeSec ?? (last ? last.t / 1000 : 0);
}

export function paceGraph(record: WorkoutRecord): SVGSVGElement {
  const targetMin = record.plan.targetTimeSec / 60;
  const endMin = recordEndSec(record) / 60;
  const xMax = Math.ceil(Math.max(targetMin, endMin) / 5) * 5;
  const axes: Axes = { xMax, yMin: 0, yMax: TOTAL_REPS, xLabel: "TIME (min)", yLabel: "REPS" };
  const actual: [number, number][] = [[0, 0], ...record.reps.map((r): [number, number] => [r.t / 60000, r.cumulativeRep])];
  return frame(
    axes,
    line([[0, 0], [targetMin, TOTAL_REPS]], "series target", axes),
    line(actual, "series actual", axes),
    ...legend([{ cls: "series actual", label: "Actual" }, { cls: "series target", label: "Target" }], M.l + 14),
  );
}

export function projectionGraph(record: WorkoutRecord, rollingWindowSec: number): SVGSVGElement | null {
  const repTimes = record.reps.map((r) => r.t);
  const endSec = recordEndSec(record);
  const points: [number, number][] = [];
  for (let t = PROJECTION_START_SEC; t < endSec; t += PROJECTION_STEP_SEC) {
    const snap = computePace(record.plan, repTimes.filter((rt) => rt <= t * 1000), t * 1000, rollingWindowSec);
    if (snap.projectedFinishSec !== null) points.push([t / 60, snap.projectedFinishSec / 60]);
  }
  if (points.length < 2) return null;
  const targetMin = record.plan.targetTimeSec / 60;
  const values = points.map((p) => p[1]);
  const yMin = Math.max(0, Math.floor(Math.min(targetMin, ...values)) - 1);
  const yMax = Math.ceil(Math.min(Math.max(targetMin, ...values), targetMin * 1.6)) + 1;
  const xMax = Math.ceil(Math.max(targetMin, endSec / 60) / 5) * 5;
  const axes: Axes = { xMax, yMin, yMax, xLabel: "TIME (min)", yLabel: "PROJECTED FINISH (min)" };
  const clamped = points.map(([px, py]): [number, number] => [px, Math.min(py, yMax)]);
  return frame(
    axes,
    line([[0, targetMin], [xMax, targetMin]], "series target", axes),
    line(clamped, "series actual", axes),
    ...legend([{ cls: "series actual", label: "Projected" }, { cls: "series target", label: "Target" }], M.l + 14),
  );
}
