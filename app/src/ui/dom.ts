type Child = Node | string | number | null | false | undefined;
type Props = Record<string, unknown>;

function applyProps(el: Element, props: Props): void {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "class") {
      el.setAttribute("class", String(value));
    } else if (key in el && key !== "style" && !key.includes("-")) {
      (el as unknown as Props)[key] = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
}

function append(el: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined && value !== null) el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function clear(el: Element): void {
  el.replaceChildren();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function present(nodes: (Node | null)[]): Node[] {
  return nodes.filter((n): n is Node => n !== null);
}
