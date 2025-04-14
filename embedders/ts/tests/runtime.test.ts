import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { HakoRuntime } from "../src/runtime/runtime";
import { createHakoRuntime, decodeVariant, HAKO_PROD } from "../src";
import fs from "node:fs/promises";
import path from "node:path";

describe("JSRuntime", () => {
  let runtime: HakoRuntime;

  beforeEach(async () => {
    // Initialize Hako with real WASM binary
    const wasmBinary = decodeVariant(HAKO_PROD);
    runtime = await createHakoRuntime({
      wasm: {
        io: {
          stdout: (lines) => console.log(lines),
          stderr: (lines) => console.error(lines),
        },
      },
      loader: {
        binary: wasmBinary,
      },
    });
  });

  afterEach(() => {
    // Clean up resources
    if (runtime) {
      runtime.release();
    }
  });

  it("should create a runtime successfully", () => {
    expect(runtime).toBeDefined();
    expect(runtime.pointer).toBeGreaterThan(0);
  });

  it("should create a context in the runtime", () => {
    const context = runtime.createContext();
    expect(context).toBeDefined();
    expect(context.pointer).toBeGreaterThan(0);

    // Clean up
    context.release();
  });

  it("should set memory limit on the runtime", () => {
    const memoryLimit = 10 * 1024 * 1024; // 10MB
    runtime.setMemoryLimit(memoryLimit);

    // We can't directly verify the limit was set, but we can ensure no exceptions are thrown
    expect(() => runtime.setMemoryLimit(memoryLimit)).not.toThrow();
  });

  it("should compute memory usage", () => {
    const memoryUsage = runtime.computeMemoryUsage();

    expect(memoryUsage).toBeDefined();

    // Verify structure matches MemoryUsage interface
    expect(typeof memoryUsage.malloc_limit).toBe("number");
    expect(typeof memoryUsage.memory_used_size).toBe("number");
    expect(typeof memoryUsage.malloc_count).toBe("number");
    expect(typeof memoryUsage.memory_used_count).toBe("number");
    expect(typeof memoryUsage.atom_count).toBe("number");
    expect(typeof memoryUsage.atom_size).toBe("number");
    expect(typeof memoryUsage.str_count).toBe("number");
    expect(typeof memoryUsage.str_size).toBe("number");
    expect(typeof memoryUsage.obj_count).toBe("number");
    expect(typeof memoryUsage.obj_size).toBe("number");
    expect(typeof memoryUsage.prop_count).toBe("number");
    expect(typeof memoryUsage.prop_size).toBe("number");
    expect(typeof memoryUsage.shape_count).toBe("number");
    expect(typeof memoryUsage.shape_size).toBe("number");
    expect(typeof memoryUsage.lepus_func_count).toBe("number");
    expect(typeof memoryUsage.lepus_func_size).toBe("number");
    expect(typeof memoryUsage.lepus_func_code_size).toBe("number");
    expect(typeof memoryUsage.lepus_func_pc2line_count).toBe("number");
    expect(typeof memoryUsage.lepus_func_pc2line_size).toBe("number");
    expect(typeof memoryUsage.c_func_count).toBe("number");
    expect(typeof memoryUsage.array_count).toBe("number");
    expect(typeof memoryUsage.fast_array_count).toBe("number");
    expect(typeof memoryUsage.fast_array_elements).toBe("number");
    expect(typeof memoryUsage.binary_object_count).toBe("number");
    expect(typeof memoryUsage.binary_object_size).toBe("number");

    // Basic sanity check for memory usage values
    expect(memoryUsage.memory_used_size).toBeGreaterThan(0);
  });

  it("should dump memory usage as string", () => {
    const memoryDump = runtime.dumpMemoryUsage();

    expect(typeof memoryDump).toBe("string");
    expect(memoryDump.length).toBeGreaterThan(0);
  });

  it("should create and retrieve system context", () => {
    const systemContext = runtime.getSystemContext();
    expect(systemContext).toBeDefined();
    expect(systemContext.pointer).toBeGreaterThan(0);
  });

  it("should create deadline interrupt handler", () => {
    const handler = runtime.createDeadlineInterruptHandler(100); // 100ms deadline

    // Should not interrupt immediately
    expect(handler(runtime)).toBe(false);

    // Wait for deadline to pass
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Should interrupt after deadline
        expect(handler(runtime)).toBe(true);
        resolve();
      }, 150);
    });
  });

  it("should create gas interrupt handler", () => {
    const maxGas = 5;
    const handler = runtime.createGasInterruptHandler(maxGas);

    // Should not interrupt for the first 4 steps
    for (let i = 0; i < maxGas - 1; i++) {
      expect(handler(runtime)).toBe(false);
    }

    // Should interrupt on the 5th step
    expect(handler(runtime)).toBe(true);

    // Should continue to return true after that
    expect(handler(runtime)).toBe(true);
  });

  it("should check if job is pending", () => {
    const isPending = runtime.isJobPending();
    expect(typeof isPending).toBe("boolean");
    // Initially, no jobs should be pending
    expect(isPending).toBe(false);
  });

  it("should enable and disable module loader", () => {
    const loader = (moduleName: string) => {
      return `export default '${moduleName}';`;
    };

    const normalizer = (base: string, name: string) => {
      return name;
    };

    // Enable module loader
    expect(() => {
      runtime.enableModuleLoader(loader, normalizer);
    }).not.toThrow();

    // Disable module loader
    expect(() => {
      runtime.disableModuleLoader();
    }).not.toThrow();
  });

  it("should enable and disable interrupt handler", () => {
    const handler = () => false; // Never interrupt

    // Enable interrupt handler
    expect(() => {
      runtime.enableInterruptHandler(handler);
    }).not.toThrow();

    // Disable interrupt handler
    expect(() => {
      runtime.disableInterruptHandler();
    }).not.toThrow();
  });

  it("should perform a recoverable leak check if supported", () => {
    // This may or may not be supported depending on build
    try {
      const result = runtime.recoverableLeakCheck();
      expect(typeof result).toBe("number");
    } catch (e) {
      // If not supported, it might throw an error, which is fine
    }
  });
});
