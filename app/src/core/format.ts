const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatClock(sec: number): string {
  if (!Number.isFinite(sec)) return "--:--";
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (total >= 6000) return `${h}:${pad2(m)}:${pad2(s)}`;
  return `${Math.floor(total / 60)}:${pad2(s)}`;
}

export function formatDelta(sec: number): string {
  if (!Number.isFinite(sec)) return "--:--";
  const rounded = Math.round(sec);
  const sign = rounded < 0 ? "-" : "+";
  return sign + formatClock(Math.abs(rounded));
}

export function parseClock(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length > 3) return null;
  if (!parts.every((p, i) => (i === 0 ? /^\d{1,3}$/.test(p) : /^\d{2}$/.test(p)))) return null;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n > 59)) return null;
  const sec = nums.length === 1 ? nums[0] * 60 : nums.reduce((acc, n) => acc * 60 + n, 0);
  return sec > 0 ? sec : null;
}

export function isPlausibleTarget(sec: number): boolean {
  return Number.isFinite(sec) && sec >= 600 && sec <= 10800;
}
