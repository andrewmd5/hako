import type { MemoryManager } from "@hako/mem/memory";
import type { HakoExports } from "@hako/etc/ffi";
import type { HakoBuildInfo } from "@hako/etc/types";

/**
 * Provides utility functions for the PrimJS wrapper.
 *
 * This class encapsulates various helper methods for working with the PrimJS
 * engine, including build information retrieval, JavaScript object property
 * access, value comparison, and runtime configuration checks.
 */
export class Utils {
  private memory: MemoryManager;
  private exports: HakoExports;
  private buildInfo: HakoBuildInfo | null = null;

  /**
   * Creates a new Utils instance.
   *
   * @param exports - The WebAssembly exports interface for accessing PrimJS functions
   * @param memory - The memory manager for handling WebAssembly memory operations
   */
  constructor(exports: HakoExports, memory: MemoryManager) {
    this.exports = exports;
    this.memory = memory;
  }

  /**
   * Retrieves detailed build information about the PrimJS engine.
   *
   * This method reads the build information structure from the WebAssembly module,
   * including version strings, compiler details, and feature flags. Results are
   * cached after the first call for better performance.
   *
   * @returns A HakoBuildInfo object containing build configuration details
   */
  getBuildInfo(): HakoBuildInfo {
    if (this.buildInfo) {
      return this.buildInfo;
    }

    const buildPtr = this.exports.HAKO_BuildInfo();

    // Read struct fields
    const versionPtr = this.memory.readPointer(buildPtr);
    const version = this.memory.readString(versionPtr);
    const ptrSize = 4; // Size of pointer (adjust if needed)
    const flags = this.memory.readUint32(buildPtr + ptrSize);

    // Read additional fields
    const buildDatePtr = this.memory.readPointer(buildPtr + ptrSize * 2);
    const buildDate = this.memory.readString(buildDatePtr);
    const wasiSdkVersionPtr = this.memory.readPointer(buildPtr + ptrSize * 3);
    const wasiSdkVersion = this.memory.readString(wasiSdkVersionPtr);
    const wasiLibcPtr = this.memory.readPointer(buildPtr + ptrSize * 4);
    const wasiLibc = this.memory.readString(wasiLibcPtr);
    const llvmPtr = this.memory.readPointer(buildPtr + ptrSize * 5);
    const llvm = this.memory.readString(llvmPtr);
    const llvmVersionPtr = this.memory.readPointer(buildPtr + ptrSize * 6);
    const llvmVersion = this.memory.readString(llvmVersionPtr);
    const configPtr = this.memory.readPointer(buildPtr + ptrSize * 7);
    const config = this.memory.readString(configPtr);

    this.buildInfo = {
      version,
      flags,
      buildDate,
      wasiSdkVersion,
      wasiLibc,
      llvm,
      llvmVersion,
      config,

      // Flag convenience properties - extract individual feature flags from the bitmask
      isDebug: Boolean(flags & (1 << 0)),
      hasSanitizer: Boolean(flags & (1 << 1)),
      hasBignum: Boolean(flags & (1 << 2)),
      hasLepusNG: Boolean(flags & (1 << 3)),
      hasDebugger: Boolean(flags & (1 << 4)),
      hasSnapshot: Boolean(flags & (1 << 5)),
      hasCompatibleMM: Boolean(flags & (1 << 6)),
      hasNanbox: Boolean(flags & (1 << 7)),
      hasCodeCache: Boolean(flags & (1 << 8)),
      hasCacheProfile: Boolean(flags & (1 << 9)),
      hasMemDetection: Boolean(flags & (1 << 10)),
      hasAtomics: Boolean(flags & (1 << 11)),
      hasForceGC: Boolean(flags & (1 << 12)),
      hasLynxSimplify: Boolean(flags & (1 << 13)),
      hasBuiltinSerialize: Boolean(flags & (1 << 14)),
      hasHakoProfiler: Boolean(flags & (1 << 15)),
    };

    return this.buildInfo;
  }

  /**
   * Gets the length property of a JavaScript object or array.
   *
   * This utility method safely retrieves the 'length' property from a JavaScript
   * object in the PrimJS engine, useful for arrays, strings, and other objects
   * with a length property.
   *
   * @param ctx - PrimJS context pointer
   * @param ptr - JSValue pointer to the object
   * @returns The length value as a number, or -1 if the length is not available
   */
  getLength(ctx: number, ptr: number): number {
    // Allocate memory for the output parameter
    const lenPtrPtr = this.memory.allocateMemory(4);
    try {
      // Call the native function to get the length
      const result = this.exports.HAKO_GetLength(ctx, lenPtrPtr, ptr);
      if (result !== 0) {
        return -1;
      }

      // Read the length value from memory
      const view = new DataView(this.exports.memory.buffer);
      return view.getUint32(lenPtrPtr, true); // Little endian
    } finally {
      // Ensure we free the allocated memory
      this.memory.freeMemory(lenPtrPtr);
    }
  }

  /**
   * Checks if two JavaScript values are equal according to the specified equality operation.
   *
   * This method allows comparing JavaScript values in the PrimJS engine using
   * different equality semantics.
   *
   * @param ctx - PrimJS context pointer
   * @param aPtr - First JSValue pointer
   * @param bPtr - Second JSValue pointer
   * @param op - Equality operation mode:
   *             0: Strict equality (===)
   *             1: Same value (Object.is)
   *             2: Same value zero (treats +0 and -0 as equal)
   * @returns True if the values are equal according to the specified operation
   */
  isEqual(ctx: number, aPtr: number, bPtr: number, op = 0): boolean {
    return this.exports.HAKO_IsEqual(ctx, aPtr, bPtr, op) === 1;
  }

  /**
   * Checks if the PrimJS engine was built with debug mode enabled.
   *
   * Debug builds contain additional runtime checks, assertions, and debugging
   * facilities, but typically run slower than release builds.
   *
   * @returns True if PrimJS is running in a debug build, false otherwise
   */
  isDebugBuild(): boolean {
    return this.exports.HAKO_BuildIsDebug() === 1;
  }
}
