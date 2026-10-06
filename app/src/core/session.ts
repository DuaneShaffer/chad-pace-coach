import { TOTAL_REPS, repsPerRevolution } from "../types.ts";
import type {
  CountingMode,
  PaceSnapshot,
  RepEvent,
  RevolutionEvent,
  SetEvent,
  Settings,
  WorkoutPlan,
  WorkoutRecord,
} from "../types.ts";
import { computePace, normalizePlan } from "./pacing.ts";

export interface SessionUpdate {
  rep?: RepEvent;
  set?: SetEvent;
  revolution?: RevolutionEvent;
  completed?: boolean;
  revolutionDurationSec?: number;
  revolutionTargetSec?: number;
}

export class WorkoutSession {
  private readonly repEvents: RepEvent[] = [];
  private readonly setEvents: SetEvent[] = [];
  private readonly revolutionEvents: RevolutionEvent[] = [];
  private readonly entrySizes: number[] = [];
  private startedAtMs = 0;
  private startedAtWall = 0;
  private finishedAtMs: number | null = null;
  private isStarted = false;

  private readonly plan: WorkoutPlan;
  private readonly mode: CountingMode;
  private readonly now: () => number;

  constructor(plan: WorkoutPlan, mode: CountingMode, now: () => number = () => performance.now()) {
    this.plan = normalizePlan(plan);
    this.mode = mode;
    this.now = now;
  }

  get started(): boolean {
    return this.isStarted;
  }

  get completed(): boolean {
    return this.finishedAtMs !== null;
  }

  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;
    this.startedAtMs = this.now();
    this.startedAtWall = Date.now();
  }

  elapsedMs(): number {
    if (!this.isStarted) return 0;
    return this.finishedAtMs ?? this.now() - this.startedAtMs;
  }

  reps(): number {
    return this.repEvents.length;
  }

  addRep(confidence = 1, atMs?: number): SessionUpdate {
    if (this.completed) return {};
    this.start();
    const lastT = this.repEvents[this.repEvents.length - 1]?.t ?? 0;
    const t = atMs === undefined ? this.elapsedMs() : Math.min(this.elapsedMs(), Math.max(lastT, atMs));
    const update = this.recordRep(t, confidence);
    this.entrySizes.push(1);
    return update;
  }

  addReps(count: number, confidence = 1): SessionUpdate[] {
    const n = Math.min(Math.floor(count), TOTAL_REPS - this.repEvents.length);
    if (this.completed || !(n > 0)) return [];
    this.start();
    const fromT = this.repEvents[this.repEvents.length - 1]?.t ?? 0;
    const toT = Math.max(fromT, this.elapsedMs());
    const updates = Array.from({ length: n }, (_, i) =>
      this.recordRep(fromT + ((toT - fromT) * (i + 1)) / n, confidence),
    );
    this.entrySizes.push(n);
    return updates;
  }

  undoLastEntry(): void {
    const size = this.entrySizes.pop();
    if (size !== undefined) this.removeReps(size);
  }

  private recordRep(t: number, confidence: number): SessionUpdate {
    const cumulativeRep = this.repEvents.length + 1;
    const update: SessionUpdate = { rep: { t, cumulativeRep, confidence } };
    this.repEvents.push(update.rep!);

    const isFinal = cumulativeRep === TOTAL_REPS;
    if (cumulativeRep % this.plan.setSize === 0 || isFinal) {
      update.set = { t, setNumber: Math.ceil(cumulativeRep / this.plan.setSize), cumulativeRep };
      this.setEvents.push(update.set);
    }
    const perRev = repsPerRevolution(this.plan);
    if (cumulativeRep % perRev === 0 || isFinal) {
      const previous = this.revolutionEvents[this.revolutionEvents.length - 1];
      update.revolution = { t, revolutionNumber: Math.ceil(cumulativeRep / perRev), cumulativeRep };
      update.revolutionDurationSec = (t - (previous?.t ?? 0)) / 1000;
      update.revolutionTargetSec =
        (this.plan.targetTimeSec * (cumulativeRep - (previous?.cumulativeRep ?? 0))) / TOTAL_REPS;
      this.revolutionEvents.push(update.revolution);
    }
    if (isFinal) {
      this.finishedAtMs = t;
      update.completed = true;
    }
    return update;
  }

  removeLastRep(): void {
    if (this.repEvents.length === 0) return;
    const last = this.entrySizes.length - 1;
    if (last >= 0 && --this.entrySizes[last] <= 0) this.entrySizes.pop();
    this.removeReps(1);
  }

  private removeReps(n: number): void {
    this.repEvents.length = Math.max(0, this.repEvents.length - n);
    this.finishedAtMs = null;
    const count = this.repEvents.length;
    for (const events of [this.setEvents, this.revolutionEvents]) {
      while (events.length > 0 && events[events.length - 1].cumulativeRep > count) events.pop();
    }
  }

  snapshot(settings: Settings): PaceSnapshot {
    return computePace(
      this.plan,
      this.repEvents.map((r) => r.t),
      this.elapsedMs(),
      settings.rollingWindowSec,
    );
  }

  toRecord(): WorkoutRecord {
    return {
      id: crypto.randomUUID(),
      date: new Date(this.isStarted ? this.startedAtWall : Date.now()).toISOString(),
      plan: { ...this.plan },
      actualTimeSec: this.finishedAtMs === null ? null : this.finishedAtMs / 1000,
      totalReps: this.repEvents.length,
      countingMode: this.mode,
      reps: [...this.repEvents],
      sets: [...this.setEvents],
      revolutions: [...this.revolutionEvents],
    };
  }
}
