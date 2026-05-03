import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockInvoke, resetTauriMocks } from "../../__test-utils__/tauri-mock";
import {
  loadPipelineBindings,
  getCachedBindings,
  onBindingsChange,
  setBinding,
  clearBinding,
  setAvailablePipelineNames,
  __resetForTests,
} from "../pipelineBindings";

beforeEach(() => {
  resetTauriMocks();
  __resetForTests();
});

describe("pipelineBindings cache", () => {
  it("starts empty before load", () => {
    expect(getCachedBindings()).toEqual({});
  });

  it("loadPipelineBindings populates the cache from get_pipeline_bindings", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_pipeline_bindings") {
        return Promise.resolve({ code: "my-code", debug: "my-debug" });
      }
      return Promise.resolve(undefined);
    });

    await loadPipelineBindings();
    expect(getCachedBindings()).toEqual({ code: "my-code", debug: "my-debug" });
  });

  it("loadPipelineBindings tolerates errors and leaves an empty cache", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInvoke.mockRejectedValue(new Error("boom"));

    await loadPipelineBindings();
    expect(getCachedBindings()).toEqual({});
    consoleErr.mockRestore();
  });

  it("notifies subscribers on cache change and supports unsubscribe", async () => {
    const listener = vi.fn();
    const unsubscribe = onBindingsChange(listener);

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_pipeline_bindings") {
        return Promise.resolve({ code: "a" });
      }
      return Promise.resolve(undefined);
    });

    await loadPipelineBindings();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ code: "a" });

    unsubscribe();
    await loadPipelineBindings();
    // No additional calls after unsubscribe.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("setBinding invokes set_pipeline_binding with camelCase args, then refreshes cache", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    let stored: Record<string, string | undefined> = {};
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      if (cmd === "set_pipeline_binding") {
        stored[args!.mode as string] = args!.pipelineName as string;
        return Promise.resolve(undefined);
      }
      if (cmd === "get_pipeline_bindings") {
        return Promise.resolve({ ...stored });
      }
      return Promise.resolve(undefined);
    });

    await setBinding("code", "custom-code");

    // Verifies the camelCase arg key matches the Rust signature.
    expect(calls[0]).toEqual({
      cmd: "set_pipeline_binding",
      args: { mode: "code", pipelineName: "custom-code" },
    });
    // Cache reflects the post-write state read from the backend.
    expect(getCachedBindings()).toEqual({ code: "custom-code" });
  });

  it("clearBinding invokes clear_pipeline_binding and refreshes the cache", async () => {
    let stored: Record<string, string | undefined> = { code: "x" };
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "clear_pipeline_binding") {
        delete stored[args!.mode as string];
        return Promise.resolve(undefined);
      }
      if (cmd === "get_pipeline_bindings") {
        return Promise.resolve({ ...stored });
      }
      return Promise.resolve(undefined);
    });

    await clearBinding("code");
    expect(getCachedBindings()).toEqual({});
  });

  it("getCachedBindings returns a defensive copy (mutations do not leak)", async () => {
    mockInvoke.mockResolvedValue({ code: "a" });
    await loadPipelineBindings();
    const snapshot = getCachedBindings();
    snapshot.code = "tampered";
    expect(getCachedBindings()).toEqual({ code: "a" });
  });
});

describe("pipeline validation via setAvailablePipelineNames", () => {
  beforeEach(() => {
    resetTauriMocks();
    __resetForTests();
  });

  it("returns binding when pipeline is in available set", async () => {
    mockInvoke.mockResolvedValue({ code: "reggie-code-workflow" });
    await loadPipelineBindings();
    setAvailablePipelineNames(["reggie-code-workflow", "reggie-debug-workflow"]);
    expect(getCachedBindings().code).toBe("reggie-code-workflow");
  });

  it("omits binding when pipeline is NOT in available set (fallback to default)", async () => {
    mockInvoke.mockResolvedValue({ code: "uninstalled-pipeline" });
    await loadPipelineBindings();
    setAvailablePipelineNames(["reggie-code-workflow"]);
    expect(getCachedBindings().code).toBeUndefined();
  });

  it("trusts all bindings when available set is empty (not yet loaded)", async () => {
    mockInvoke.mockResolvedValue({ code: "custom-pipeline" });
    await loadPipelineBindings();
    // availablePipelineNames not set — empty set means "trust all"
    expect(getCachedBindings().code).toBe("custom-pipeline");
  });

  it("partial validation: valid binding passes, invalid binding omitted", async () => {
    mockInvoke.mockResolvedValue({ code: "good-pipeline", debug: "bad-pipeline" });
    await loadPipelineBindings();
    setAvailablePipelineNames(["good-pipeline"]);
    const bindings = getCachedBindings();
    expect(bindings.code).toBe("good-pipeline");
    expect(bindings.debug).toBeUndefined();
  });

  it("setAvailablePipelineNames notifies subscribers with the updated validated view", async () => {
    mockInvoke.mockResolvedValue({ code: "my-pipeline" });
    await loadPipelineBindings();

    const snapshots: Array<ReturnType<typeof getCachedBindings>> = [];
    const unsubscribe = onBindingsChange(() => snapshots.push(getCachedBindings()));

    // Before available list is set, binding is trusted.
    setAvailablePipelineNames(["my-pipeline"]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].code).toBe("my-pipeline");

    // Tighten the available set so the binding is now invalid.
    setAvailablePipelineNames(["other-pipeline"]);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].code).toBeUndefined();

    unsubscribe();
  });
});
