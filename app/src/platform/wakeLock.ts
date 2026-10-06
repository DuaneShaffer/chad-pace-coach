export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  constructor() {
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private onVisibility = () => {
    if (this.wanted && document.visibilityState === "visible") void this.request();
  };

  private async request(): Promise<void> {
    if (!("wakeLock" in navigator)) return;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (this.wanted) this.sentinel = sentinel;
      else void sentinel.release().catch(() => {});
    } catch {
      this.sentinel = null;
    }
  }

  async acquire(): Promise<void> {
    this.wanted = true;
    await this.request();
  }

  release(): void {
    this.wanted = false;
    document.removeEventListener("visibilitychange", this.onVisibility);
    void this.sentinel?.release().catch(() => {});
    this.sentinel = null;
  }
}
