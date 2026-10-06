import { formatClock } from "../core/format";
import type { WorkoutRecord } from "../types";
import { h } from "./dom";

const BENCHMARK_URL = "https://www.crossfit.com/benchmark/chad1000x";
const COPIED_MS = 1800;

export function resultText(record: WorkoutRecord): string {
  const time = formatClock(record.actualTimeSec ?? 0);
  return `CHAD — ${time} (1,000 step-ups, ${record.plan.setSize}×${record.plan.setsPerRevolution}) · Chad Pace Coach`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h("textarea", { value: text, readOnly: true, class: "offscreen" });
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function recordScoreBlock(record: WorkoutRecord): HTMLElement | null {
  if (record.actualTimeSec === null) return null;
  const copy = h("button", { type: "button", class: "btn copy-btn" }, "Copy result");
  let timer = 0;
  copy.addEventListener("click", async () => {
    const ok = await copyText(resultText(record));
    copy.textContent = ok ? "Copied" : "Copy failed";
    window.clearTimeout(timer);
    timer = window.setTimeout(() => (copy.textContent = "Copy result"), COPIED_MS);
  });
  const link = h(
    "a",
    { class: "record-link", href: BENCHMARK_URL, target: "_blank", rel: "noopener noreferrer" },
    h("span", {}, h("b", {}, "Record your score ›"), h("small", {}, "Official standards & leaderboard")),
  );
  return h("div", { class: "record-score" }, link, copy);
}
