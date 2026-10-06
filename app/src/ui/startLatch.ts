export interface StartLatch {
  latched: boolean;
  openedAt: number;
}

export const START_ANYWAY_AFTER_MS = 8000;

export function openLatch(now: number): StartLatch {
  return { latched: false, openedAt: now };
}

export function updateLatch(latch: StartLatch, requiredChecksPass: boolean): StartLatch {
  return requiredChecksPass && !latch.latched ? { ...latch, latched: true } : latch;
}

export function startEnabled(latch: StartLatch): boolean {
  return latch.latched;
}

export function showStartAnyway(latch: StartLatch, now: number): boolean {
  return !latch.latched && now - latch.openedAt >= START_ANYWAY_AFTER_MS;
}
