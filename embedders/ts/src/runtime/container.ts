import type { HakoExports } from "@hako/etc/ffi";
import type { MemoryManager } from "@hako/mem/memory";
import { ErrorManager } from "@hako/etc/errors";
import { Utils } from "@hako/etc/utils";
import type { CallbackManager } from "@hako/runtime/callback";

/**
 * Central service container that holds and initializes all core PrimJS wrapper components.
 *
 * This class follows the dependency injection pattern, providing centralized
 * access to shared services needed by the PrimJS wrapper.
 */
export class Container {
  /**
   * PrimJS WebAssembly exports object containing all exported functions.
   */
  public readonly exports: HakoExports;

  /**
   * Memory manager for handling WebAssembly memory operations.
   */
  public readonly memory: MemoryManager;

  /**
   * Error manager for handling PrimJS errors and exceptions.
   */
  public readonly error: ErrorManager;

  /**
   * Utility functions for common PrimJS operations.
   */
  public readonly utils: Utils;

  /**
   * Callback manager for handling bidirectional function calls between host and VM.
   */
  public readonly callbacks: CallbackManager;

  /**
   * Creates a new service container and initializes all dependencies.
   *
   * @param exports - PrimJS WebAssembly exports
   * @param memory - Memory manager instance
   * @param callbacks - Callback manager instance
   */
  constructor(
    exports: HakoExports,
    memory: MemoryManager,
    callbacks: CallbackManager
  ) {
    this.exports = exports;

    // Store and initialize managers
    this.memory = memory;
    this.callbacks = callbacks;
    this.memory.setExports(exports);
    this.callbacks.setExports(exports);

    // Create dependent managers
    this.error = new ErrorManager(exports, this.memory);
    this.utils = new Utils(exports, this.memory);
  }
}
