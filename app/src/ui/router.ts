export type Cleanup = () => void;
export type Screen = (root: HTMLElement, args: string[]) => Cleanup | void;

export function go(path: string): void {
  const target = `#/${path}`;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = target;
}

export function startRouter(root: HTMLElement, routes: Record<string, Screen>, fallback: string): void {
  let cleanup: Cleanup | void;

  const render = () => {
    cleanup?.();
    cleanup = undefined;
    root.replaceChildren();
    root.scrollTop = 0;
    const [name, ...args] = location.hash.replace(/^#\/?/, "").split("/");
    const screen = routes[name] ?? routes[fallback];
    cleanup = screen(root, args);
  };

  window.addEventListener("hashchange", render);
  render();
}
