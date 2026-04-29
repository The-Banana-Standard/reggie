/**
 * Pipeline bindings client wrapper.
 *
 * Maintains a synchronous in-memory cache of the user's pipeline bindings
 * (which custom pipeline command to dispatch for each mode: code, debug,
 * manual). The cache is needed because callers like `commandForMode` in
 * CodeWorkflowTab are synchronous event handlers and cannot await the Tauri
 * round-trip.
 *
 * Usage:
 *   - Call `loadPipelineBindings()` once at app startup to populate the cache.
 *   - Read synchronously via `getCachedBindings()` or the React hook
 *     `usePipelineBindings()`.
 *   - Mutate via `setBinding(mode, name)` / `clearBinding(mode)` — these
 *     invoke the Tauri command, refresh the cache, and notify subscribers.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface PipelineBindings {
  code?: string;
  debug?: string;
  manual?: string;
}

export type BindingMode = "code" | "debug" | "manual";

let cache: PipelineBindings = {};
const listeners = new Set<(bindings: PipelineBindings) => void>();

// Known pipeline names populated at startup from get_pipelines. Empty set = uninitialized
// (trust all bindings). Non-empty set = validate bindings against installed pipelines.
let availablePipelineNames: Set<string> = new Set();

/**
 * Register the set of installed pipeline names so getCachedBindings can
 * fall back to defaults for any binding whose pipeline has been uninstalled.
 * Call once at app startup after loading pipelines from get_pipelines.
 */
export function setAvailablePipelineNames(names: string[]): void {
  availablePipelineNames = new Set(names);
  // Re-notify subscribers so they re-render with the now-validated view.
  notify();
}

/** Returns the pipeline name only if it is installed (or the list is not yet populated). */
function validatePipelineName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (availablePipelineNames.size === 0) return name; // not yet populated — trust the binding
  return availablePipelineNames.has(name) ? name : undefined;
}

function notify(): void {
  // Snapshot the cache so listeners see a stable object even if the cache is
  // replaced while a listener is running.
  const snapshot = { ...cache };
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (err) {
      // Subscribers must not break each other.
      console.error("pipeline-bindings listener threw:", err);
    }
  }
}

/** Replace the cache and notify subscribers. */
function setCache(next: PipelineBindings): void {
  cache = { ...next };
  notify();
}

/** Reload canonical state from the backend and push it into the cache. */
async function refreshCache(): Promise<void> {
  const result = await invoke<PipelineBindings>("get_pipeline_bindings");
  setCache(result ?? {});
}

/**
 * Populate the in-memory cache from the backend. Call once at app startup.
 * Failures are logged but not thrown — the cache simply stays empty (defaults).
 */
export async function loadPipelineBindings(): Promise<void> {
  try {
    const result = await invoke<PipelineBindings>("get_pipeline_bindings");
    setCache(result ?? {});
  } catch (err) {
    console.error("Failed to load pipeline bindings:", err);
    setCache({});
  }
}

/**
 * Read the current cached bindings synchronously.
 * Bindings for uninstalled pipelines are omitted (returns undefined for
 * those fields), causing commandForMode to fall back to the defaults.
 */
export function getCachedBindings(): PipelineBindings {
  return {
    code: validatePipelineName(cache.code),
    debug: validatePipelineName(cache.debug),
    manual: validatePipelineName(cache.manual),
  };
}

/**
 * Subscribe to cache changes. Returns an unsubscribe function.
 */
export function onBindingsChange(
  listener: (bindings: PipelineBindings) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Set a binding for one mode. Invokes the Tauri command, then re-reads the
 * canonical state from the backend and updates the cache.
 */
export async function setBinding(
  mode: BindingMode,
  pipelineName: string,
): Promise<void> {
  await invoke("set_pipeline_binding", { mode, pipelineName });
  await refreshCache();
}

/**
 * Clear a binding for one mode (revert to default). Invokes the Tauri
 * command, then re-reads the canonical state and updates the cache.
 */
export async function clearBinding(mode: BindingMode): Promise<void> {
  await invoke("clear_pipeline_binding", { mode });
  await refreshCache();
}

/**
 * React hook: subscribe to the bindings cache. Returns the current bindings
 * and re-renders the calling component when they change.
 */
export function usePipelineBindings(): PipelineBindings {
  const [bindings, setBindings] = useState<PipelineBindings>(() => getCachedBindings());
  useEffect(() => {
    // Re-sync on mount in case the cache changed between render and effect.
    setBindings(getCachedBindings());
    return onBindingsChange(setBindings);
  }, []);
  return bindings;
}

/** Test-only: reset module state. Not exported via the public API contract. */
export function __resetForTests(): void {
  cache = {};
  listeners.clear();
  availablePipelineNames = new Set();
}
