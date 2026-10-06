import { DEFAULT_BOX_HEIGHT_IN, DEFAULT_SETTINGS, TOTAL_REPS } from "../types";
import { isPlausibleTarget } from "../core/format";
import type { CountingMode, Settings, WorkoutPlan } from "../types";

const SETTINGS_KEY = "chad.settings";
const PLAN_KEY = "chad.plan";

export interface SavedPlan {
  plan: WorkoutPlan;
  mode: CountingMode;
}

export const DEFAULT_PLAN: WorkoutPlan = {
  targetTimeSec: 65 * 60,
  setSize: 25,
  setsPerRevolution: 4,
  boxHeightIn: DEFAULT_BOX_HEIGHT_IN,
};

function readJson<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode); settings simply won't persist
  }
}

let cached: Settings | null = null;

export function getSettings(): Settings {
  cached ??= { ...DEFAULT_SETTINGS, ...readJson<Settings>(SETTINGS_KEY) };
  return cached;
}

export function saveSettings(settings: Settings): void {
  cached = settings;
  writeJson(SETTINGS_KEY, settings);
}

function isValidPlan(plan: Partial<WorkoutPlan> | undefined): plan is WorkoutPlan {
  return (
    !!plan &&
    typeof plan.targetTimeSec === "number" &&
    isPlausibleTarget(plan.targetTimeSec) &&
    Number.isInteger(plan.setSize) &&
    plan.setSize! >= 1 &&
    plan.setSize! <= TOTAL_REPS &&
    Number.isInteger(plan.setsPerRevolution) &&
    plan.setsPerRevolution! >= 1 &&
    plan.setsPerRevolution! <= 20 &&
    typeof plan.boxHeightIn === "number" &&
    plan.boxHeightIn >= 1 &&
    plan.boxHeightIn <= 60
  );
}

export function loadSavedPlan(): SavedPlan {
  const saved = readJson<SavedPlan>(PLAN_KEY);
  return {
    plan: isValidPlan(saved?.plan) ? { ...saved.plan } : { ...DEFAULT_PLAN },
    mode: saved?.mode === "manual" ? "manual" : "camera",
  };
}

export function savePlan(saved: SavedPlan): void {
  writeJson(PLAN_KEY, saved);
}
