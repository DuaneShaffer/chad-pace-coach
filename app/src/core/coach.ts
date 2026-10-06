import { TOTAL_REPS } from "../types.ts";
import type { PaceSnapshot, Settings, WorkoutPlan } from "../types.ts";
import type { SessionUpdate } from "./session.ts";

const FIRST_PACE_CALL_SEC = 60;
const OCCASIONAL_INTERVAL_SEC = 180;
const PROMINENT_INTERVAL_SEC = 90;
const MILESTONE_GUARD_SEC = 8;
const SET_MILESTONE_MIN_GAP_SEC = 20;
const REVOLUTION_SPLIT_MIN_SEC = 60;
const HALFWAY_REP = TOTAL_REPS / 2;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

function spokenDuration(sec: number): string {
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return plural(s, "second");
  if (s === 0) return plural(m, "minute");
  return `${plural(m, "minute")} ${plural(s, "second")}`;
}

function spokenSplit(sec: number): string {
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return plural(s, "second");
  if (s === 0) return `${plural(m, "minute")} flat`;
  return `${m} ${s < 10 ? `oh ${s}` : s}`;
}

function spokenTargetDelta(targetSec: number, durationSec: number): string {
  const delta = Math.floor(targetSec) - Math.floor(durationSec);
  if (delta === 0) return "on target";
  return `${spokenDuration(Math.abs(delta))} ${delta > 0 ? "under" : "over"} target`;
}

function spokenRate(rpm: number): string {
  return String(Math.round(rpm * 10) / 10);
}

export class CoachScript {
  private lastPaceSec = -Infinity;
  private lastMilestoneSec = -Infinity;
  private lastRevolutionCallSec = -Infinity;
  private highestAnnouncedRep = 0;

  private readonly plan: WorkoutPlan;
  private readonly settings: Settings;

  constructor(plan: WorkoutPlan, settings: Settings) {
    this.plan = plan;
    this.settings = settings;
  }

  private get repsEnabled(): boolean {
    return this.settings.audioMode === "reps" || this.settings.audioMode === "full";
  }

  private get paceEnabled(): boolean {
    return this.settings.audioMode === "pace" || this.settings.audioMode === "full";
  }

  onStart(): string[] {
    if (this.settings.audioMode === "off") return [];
    return [`Go. Target ${spokenDuration(this.plan.targetTimeSec)}.`];
  }

  onUpdate(update: SessionUpdate, snap: PaceSnapshot): string[] {
    if (this.settings.audioMode === "off") return [];

    if (update.completed) {
      this.lastMilestoneSec = snap.elapsedSec;
      return [`Chad complete. ${spokenDuration(snap.elapsedSec)}.`];
    }
    if (!this.repsEnabled) return this.paceRevolutionSplit(update, snap.elapsedSec);

    const halfway = update.rep?.cumulativeRep === HALFWAY_REP;
    const rep = update.set?.cumulativeRep ?? update.revolution?.cumulativeRep ?? (halfway ? HALFWAY_REP : undefined);
    if (rep === undefined || rep <= this.highestAnnouncedRep) return [];
    if (!update.revolution && !halfway && snap.elapsedSec - this.lastMilestoneSec < SET_MILESTONE_MIN_GAP_SEC) return [];

    const parts = [`${rep}.`];
    if (halfway) parts.push("Halfway.");
    if (update.revolution) parts.push(...this.revolutionSentence(update, snap.elapsedSec));

    this.highestAnnouncedRep = rep;
    this.lastMilestoneSec = snap.elapsedSec;
    return [parts.join(" ")];
  }

  private paceRevolutionSplit(update: SessionUpdate, elapsedSec: number): string[] {
    if (this.settings.audioMode !== "pace" || !update.revolution) return [];
    if (update.revolution.cumulativeRep <= this.highestAnnouncedRep) return [];
    this.highestAnnouncedRep = update.revolution.cumulativeRep;
    const sentence = this.revolutionSentence(update, elapsedSec);
    if (sentence.length > 0) this.lastMilestoneSec = elapsedSec;
    return sentence;
  }

  private revolutionSentence(update: SessionUpdate, elapsedSec: number): string[] {
    const duration = update.revolutionDurationSec;
    const sinceLastCall = elapsedSec - this.lastRevolutionCallSec;
    this.lastRevolutionCallSec = elapsedSec;
    if (duration === undefined || duration < REVOLUTION_SPLIT_MIN_SEC || sinceLastCall < REVOLUTION_SPLIT_MIN_SEC) {
      return [];
    }
    const number = update.revolution!.revolutionNumber;
    if (!this.paceEnabled || update.revolutionTargetSec === undefined) {
      return [`Revolution ${number} done in ${spokenSplit(duration)}.`];
    }
    return [`Revolution ${number}, ${spokenSplit(duration)}, ${spokenTargetDelta(update.revolutionTargetSec, duration)}.`];
  }

  onTick(snap: PaceSnapshot): string[] {
    if (!this.paceEnabled) return [];
    if (snap.elapsedSec < FIRST_PACE_CALL_SEC || snap.remainingReps === 0) return [];

    const gap = Math.abs(snap.aheadSec);
    if (gap < Math.max(this.settings.paceQuietThresholdSec, this.settings.paceOccasionalThresholdSec)) return [];

    const behind = snap.aheadSec < 0;
    const projectFinish =
      behind &&
      snap.projectedFinishSec !== null &&
      (snap.requiredRpm === null || (gap >= this.settings.paceCorrectionThresholdSec && !snap.requiredRealistic));
    const interval =
      projectFinish || gap < this.settings.paceProminentThresholdSec ? OCCASIONAL_INTERVAL_SEC : PROMINENT_INTERVAL_SEC;
    if (snap.elapsedSec - this.lastPaceSec < interval) return [];
    if (snap.elapsedSec - this.lastMilestoneSec < MILESTONE_GUARD_SEC) return [];

    this.lastPaceSec = snap.elapsedSec;
    if (projectFinish) return [`On pace for ${spokenDuration(snap.projectedFinishSec!)}.`];
    const status = `You're ${spokenDuration(gap)} ${behind ? "behind" : "ahead"}.`;
    const needsCorrection = behind && gap >= this.settings.paceCorrectionThresholdSec;
    if (needsCorrection && snap.requiredRpm !== null) {
      return [`${status} Required pace ${spokenRate(snap.requiredRpm)} per minute.`];
    }
    return [status];
  }
}
