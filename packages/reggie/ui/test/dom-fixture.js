import { vi } from "vitest";

/** Reset the small browser surface shared by the production UI modules. */
export function resetDom(markup = "") {
  document.documentElement.removeAttribute("style");
  document.body.innerHTML = markup;
  // Node 26 exposes an incomplete global localStorage unless it was started with
  // --localstorage-file. Give the DOM project a fresh standards-shaped store.
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    removeItem(key) { values.delete(String(key)); },
    setItem(key, value) { values.set(String(key), String(value)); },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "history", { configurable: true, value: window.history });
  Object.defineProperty(globalThis, "location", { configurable: true, value: window.location });
  window.history.replaceState(null, "", "/");

  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: vi.fn((callback) => {
      callback(performance.now());
      return 1;
    }),
  });
  Object.defineProperty(window, "cancelAnimationFrame", { configurable: true, value: vi.fn() });
}

export function readerShell() {
  resetDom('<main id="map-col"><div id="reader"></div></main>');
  const parent = document.getElementById("map-col");
  Object.defineProperty(parent, "clientHeight", { configurable: true, value: 700 });
  return document.getElementById("reader");
}
