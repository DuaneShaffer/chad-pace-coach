import { listWorkouts } from "../platform/storage";
import { DEFAULT_TAGLINE, taglineFor } from "./splashTagline";

interface Markers {
  echoesStart: number;
  thousandAt: number;
  thousandOut: number;
  freezeAt: number;
  outlineAt: number;
  wordmarkAt: number;
  end: number;
}

const SESSION_KEY = "chad.splash.seen";
const DEFAULT_MARKERS: Markers = { echoesStart: 2.0, thousandAt: 2.2, thousandOut: 3.3, freezeAt: 2.6, outlineAt: 3.3, wordmarkAt: 4.1, end: 4.5 };
const TAGLINE_FROM_S = 0.4;
const START_TIMEOUT_MS = 1200;
const FLIGHT_MS = 500;
const FADE_MS = 240;
const SKIP_FADE_MS = 160;
const STATIC_HOLD_MS = 800;
const SHORT_HOLD_MS = 1500;

// sessionStorage survives a refresh but not closing the tab or app, so a fresh launch gets the full intro
// and a refresh within the same session gets the short one.
function claimLaunch(): { full: boolean } {
  try {
    const seen = sessionStorage.getItem(SESSION_KEY) !== null;
    sessionStorage.setItem(SESSION_KEY, "1");
    return { full: !seen };
  } catch {
    return { full: true };
  }
}

function asset(name: string): string {
  return `${import.meta.env.BASE_URL}splash/${name}`;
}

async function loadMarkers(): Promise<Markers> {
  try {
    const res = await fetch(asset("markers.json"));
    const raw: Partial<Markers> = await res.json();
    const merged = { ...DEFAULT_MARKERS, ...raw };
    return {
      ...merged,
      thousandOut: raw.thousandOut ?? merged.freezeAt + 0.7,
      wordmarkAt: raw.wordmarkAt ?? merged.outlineAt + 0.8,
    };
  } catch {
    return DEFAULT_MARKERS;
  }
}

function buildOverlay(full: boolean) {
  const root = document.createElement("div");
  root.className = "splash";
  root.setAttribute("aria-hidden", "true");
  const sources = full
    ? `<source src="${asset("splash.mp4")}" type="video/mp4">
      <source src="${asset("splash.webm")}" type="video/webm">`
    : "";
  root.innerHTML = `
    <video class="splash-video" muted playsinline preload="${full ? "auto" : "none"}" poster="${asset(full ? "first.jpg" : "outline.jpg")}">
      ${sources}
    </video>
    <div class="splash-thousand"><div class="splash-num">1,000</div><div class="splash-sub">Step-ups</div></div>
    <div class="splash-tag">${DEFAULT_TAGLINE}</div>
    <div class="splash-word">CHAD</div>`;
  document.body.append(root);
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const video = q<HTMLVideoElement>(".splash-video");
  video.muted = true;
  return { root, video, thousand: q(".splash-thousand"), tag: q(".splash-tag"), word: q(".splash-word") };
}

function homeWordmark(): HTMLElement | null {
  return location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] in { "": 1, home: 1 }
    ? document.querySelector<HTMLElement>(".home-head h1")
    : null;
}

function styleWordLike(word: HTMLElement, target: HTMLElement): DOMRect {
  const rect = target.getBoundingClientRect();
  const cs = getComputedStyle(target);
  Object.assign(word.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontFamily: cs.fontFamily,
    letterSpacing: cs.letterSpacing,
    lineHeight: cs.lineHeight,
  });
  return rect;
}

export function startSplash(): void {
  const { full } = claimLaunch();
  if (location.hash.startsWith("#/workout")) return;
  runSplash(full);
}

export function playSplash(opts: { full: boolean }): void {
  runSplash(opts.full);
}

function runSplash(full: boolean): void {
  if (document.querySelector(".splash")) return;
  const { root, video, thousand, tag, word } = buildOverlay(full);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let markers = DEFAULT_MARKERS;
  void loadMarkers().then((m) => (markers = m));
  let leaving = false;
  let matched = false;
  let thousandShown = false;
  let frame = 0;
  let startTimer = 0;
  let holdTimer = 0;

  const leave = (fadeMs: number) => {
    if (leaving) return;
    leaving = true;
    cancelAnimationFrame(frame);
    clearTimeout(startTimer);
    clearTimeout(holdTimer);
    window.removeEventListener("pointerdown", skip, true);
    window.removeEventListener("keydown", skip, true);
    root.style.setProperty("--splash-fade", `${fadeMs}ms`);
    root.classList.add("leaving");
    setTimeout(() => {
      video.pause();
      video.removeAttribute("src");
      video.querySelectorAll("source").forEach((s) => s.remove());
      video.load();
      root.remove();
    }, fadeMs);
  };
  const swallowClick = (e: Event) => e.stopPropagation();
  function skip(e: Event): void {
    e.preventDefault();
    if (e.type === "pointerdown") {
      window.addEventListener("click", swallowClick, true);
      setTimeout(() => window.removeEventListener("click", swallowClick, true), 400);
    }
    leave(SKIP_FADE_MS);
  }
  window.addEventListener("pointerdown", skip, true);
  window.addEventListener("keydown", skip, true);

  const showStatic = (holdMs = STATIC_HOLD_MS) => {
    if (leaving || matched) return;
    matched = true;
    video.pause();
    video.poster = asset("outline.jpg");
    thousand.classList.remove("on");
    tag.classList.remove("on");
    const target = homeWordmark();
    if (target) styleWordLike(word, target);
    else word.classList.add("centered");
    root.classList.add("static");
    holdTimer = window.setTimeout(() => leave(FADE_MS), holdMs);
  };

  const hideThousand = () => {
    thousand.classList.remove("on");
    thousand.classList.add("off");
  };

  const matchCut = () => {
    if (matched || leaving) return;
    matched = true;
    hideThousand();
    tag.classList.remove("on");
    const target = homeWordmark();
    if (!target) {
      leave(FADE_MS);
      return;
    }
    const rect = styleWordLike(word, target);
    const scale = Math.min(window.innerWidth * 0.62, 420) / rect.width;
    const dx = window.innerWidth / 2 - (rect.width * scale) / 2 - rect.left;
    const dy = window.innerHeight * 0.46 - (rect.height * scale) / 2 - rect.top;
    word.classList.add("flying");
    const flight = word.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0 },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 1, offset: 0.18 },
        { transform: "none", opacity: 1 },
      ],
      { duration: FLIGHT_MS, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)", fill: "forwards" },
    );
    flight.finished.then(() => leave(FADE_MS)).catch(() => leave(FADE_MS));
  };

  const update = (t: number) => {
    if (leaving || matched) return;
    if (full) tag.classList.toggle("on", t >= TAGLINE_FROM_S && t < markers.echoesStart);
    if (full && !thousandShown && t >= markers.thousandAt && t < markers.thousandOut) {
      thousandShown = true;
      thousand.classList.add("on");
    }
    if (thousandShown && t >= markers.thousandOut) hideThousand();
    if (t >= markers.wordmarkAt) matchCut();
  };

  const schedule = () => {
    if (leaving || matched) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback((_now, meta) => {
        update(meta.mediaTime);
        schedule();
      });
    } else {
      frame = requestAnimationFrame(() => {
        update(video.currentTime);
        schedule();
      });
    }
  };

  if (reduced || !full) {
    showStatic(full ? STATIC_HOLD_MS : SHORT_HOLD_MS);
    return;
  }

  void listWorkouts()
    .then((records) => {
      tag.textContent = taglineFor(records);
    })
    .catch(() => {});

  startTimer = window.setTimeout(() => showStatic(), START_TIMEOUT_MS);
  video.addEventListener("error", () => showStatic());
  video.addEventListener("ended", matchCut);
  video.addEventListener("playing", () => {
    clearTimeout(startTimer);
    root.classList.add("playing");
    schedule();
  }, { once: true });
  video.play().catch(() => showStatic());
}
