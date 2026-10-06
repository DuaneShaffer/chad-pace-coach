import { h } from "./dom";

const HOLD_DELAY_MS = 420;
const HOLD_INTERVAL_MS = 110;
const ACCELERATE_AFTER = 8;

export function holdRepeat(btn: HTMLElement, fire: (fast: boolean) => void): void {
  let delay = 0;
  let interval = 0;
  const stop = () => {
    window.clearTimeout(delay);
    window.clearInterval(interval);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };
  btn.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    stop();
    fire(false);
    let count = 0;
    delay = window.setTimeout(() => {
      interval = window.setInterval(() => fire(++count > ACCELERATE_AFTER), HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  });
  btn.addEventListener("click", (e) => {
    if (e.detail === 0) fire(false);
  });
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

export interface StepperOptions {
  value: number;
  min: number;
  max: number;
  step: number;
  fastStep?: number;
  format?: (v: number) => string;
  label: string;
  onChange: (v: number) => void;
  onValueTap?: () => void;
  className?: string;
}

export interface Stepper {
  el: HTMLElement;
  set(v: number): void;
  get(): number;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function stepper(opts: StepperOptions): Stepper {
  let value = opts.value;
  const format = opts.format ?? String;
  const readout = opts.onValueTap
    ? h("button", { type: "button", class: "stepper-value mono tap", "aria-label": `${opts.label}, change`, onClick: opts.onValueTap })
    : h("output", { class: "stepper-value mono", "aria-label": opts.label });
  const minus = h("button", { type: "button", class: "btn round", "aria-label": `Decrease ${opts.label}` }, "−");
  const plus = h("button", { type: "button", class: "btn round", "aria-label": `Increase ${opts.label}` }, "+");

  function render(): void {
    readout.textContent = format(value);
    minus.classList.toggle("at-limit", value <= opts.min);
    plus.classList.toggle("at-limit", value >= opts.max);
  }

  function move(direction: 1 | -1, fast: boolean): void {
    const step = fast && opts.fastStep ? opts.fastStep : opts.step;
    const next = Math.min(opts.max, Math.max(opts.min, round(value + direction * step)));
    if (next === value) return;
    value = next;
    render();
    opts.onChange(value);
  }

  holdRepeat(minus, (fast) => move(-1, fast));
  holdRepeat(plus, (fast) => move(1, fast));
  render();

  return {
    el: h("div", { class: `stepper ${opts.className ?? ""}` }, minus, readout, plus),
    set(v) {
      value = Math.min(opts.max, Math.max(opts.min, v));
      render();
    },
    get: () => value,
  };
}

export interface Sheet {
  body: HTMLElement;
  close(): void;
}

export function openSheet(title: string, onDone: () => void, onCancel: () => void = () => {}): Sheet {
  const previousFocus = document.activeElement as HTMLElement | null;
  const body = h("div", { class: "sheet-body" });
  const backdrop = h("div", { class: "sheet-backdrop" });
  const finish = (cb: () => void) => () => {
    cb();
    close();
  };
  const sheet = h(
    "div",
    { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "sheet-head" }, h("button", { type: "button", class: "btn link", onClick: finish(onCancel) }, "Cancel"), h("b", {}, title), h("button", { type: "button", class: "btn link strong", onClick: finish(onDone) }, "Done")),
    body,
  );
  backdrop.addEventListener("click", finish(onCancel));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") finish(onCancel)();
  };
  document.addEventListener("keydown", onKey);
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    sheet.remove();
    previousFocus?.focus?.({ preventScroll: true });
  }
  document.body.append(backdrop, sheet);
  return { body, close };
}

const WHEEL_ITEM_PX = 48;

export interface Wheel {
  el: HTMLElement;
  value(): number;
}

export function wheel(values: number[], initial: number, format: (v: number) => string, label: string): Wheel {
  const items = values.map((v) => h("div", { class: "wheel-item mono", "data-v": v }, format(v)));
  const list = h("div", { class: "wheel", role: "listbox", "aria-label": label, tabIndex: 0 }, ...items);
  const index = () => Math.min(values.length - 1, Math.max(0, Math.round(list.scrollTop / WHEEL_ITEM_PX)));
  const start = Math.max(0, values.findIndex((v) => v >= initial));
  requestAnimationFrame(() => {
    list.scrollTop = start * WHEEL_ITEM_PX;
  });
  return { el: list, value: () => values[index()] };
}
