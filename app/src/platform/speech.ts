interface QueueItem {
  text: string;
  droppable: boolean;
  queuedAt: number;
}

const STALE_MS = 6000;
const MAX_QUEUED_DROPPABLE = 2;
const RATE = 1.05;

function pickVoice(): SpeechSynthesisVoice | null {
  const english = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  const preferred = ["Samantha", "Daniel", "Karen", "Google US English", "Alex"];
  for (const name of preferred) {
    const match = english.find((v) => v.name.includes(name));
    if (match) return match;
  }
  return english.find((v) => v.lang === "en-US") ?? english[0] ?? null;
}

export class SpeechQueue {
  muted = false;
  private queue: QueueItem[] = [];
  private speaking = false;
  private watchdog = 0;
  private seq = 0;
  private voice: SpeechSynthesisVoice | null = null;

  get available(): boolean {
    return "speechSynthesis" in window;
  }

  unlock(): void {
    if (!this.available) return;
    this.voice = pickVoice();
    speechSynthesis.addEventListener("voiceschanged", () => (this.voice = pickVoice()), { once: true });
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  say(text: string, opts: { droppable?: boolean } = {}): void {
    if (!this.available || this.muted) return;
    const droppable = opts.droppable ?? false;
    if (droppable && this.queue.filter((q) => q.droppable).length >= MAX_QUEUED_DROPPABLE) return;
    if (!droppable) this.queue = this.queue.filter((q) => !q.droppable);
    this.queue.push({ text, droppable, queuedAt: performance.now() });
    this.pump();
  }

  sayNow(text: string): void {
    if (!this.available || this.muted) return;
    this.clear();
    this.queue.push({ text, droppable: false, queuedAt: performance.now() });
    this.pump();
  }

  clear(): void {
    this.queue = [];
    this.speaking = false;
    this.seq++;
    window.clearTimeout(this.watchdog);
    if (this.available) speechSynthesis.cancel();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.clear();
  }

  private pump(): void {
    if (this.speaking) return;
    const item = this.queue.shift();
    if (!item) return;
    if (item.droppable && performance.now() - item.queuedAt > STALE_MS) {
      this.pump();
      return;
    }
    this.speaking = true;
    const u = new SpeechSynthesisUtterance(item.text);
    u.rate = RATE;
    if (this.voice) {
      u.voice = this.voice;
      u.lang = this.voice.lang;
    } else {
      u.lang = "en-US";
    }
    const id = ++this.seq;
    const done = () => {
      if (id !== this.seq || !this.speaking) return;
      window.clearTimeout(this.watchdog);
      this.speaking = false;
      this.pump();
    };
    u.onend = done;
    u.onerror = done;
    this.watchdog = window.setTimeout(done, 2500 + item.text.length * 120);
    speechSynthesis.speak(u);
  }
}

export const speech = new SpeechQueue();
