/**
 * interrupt-helpers.ts - Helper functions for creating interrupt handlers
 *
 * This module provides utilities for creating and managing interrupt handlers
 * that can terminate long-running JavaScript operations in the Hako runtime.
 * Interrupt handlers are essential for preventing infinite loops, excessive
 * CPU usage, and memory exhaustion by untrusted code.
 */

import type { HakoRuntime } from "@hako/runtime/runtime";
import type { InterruptHandler, JSVoid } from "@hako/etc/types";

import type { VMContext } from "@hako/vm/context";

/**
 * Creates an interrupt handler that terminates execution after a specified time deadline.
 *
 * This is useful for imposing a maximum execution time on JavaScript code, preventing
 * long-running operations from blocking the system. The deadline is calculated as
 * the current time plus the specified milliseconds.
 *
 * @param deadlineMs - The maximum execution time in milliseconds
 * @returns An interrupt handler function that will return true when the deadline is reached
 *
 * @example
 * ```typescript
 * // Create a handler that interrupts after 5 seconds
 * const handler = shouldInterruptAfterDeadline(5000);
 * runtime.enableInterruptHandler(handler);
 *
 * // This will be interrupted if it runs for more than 5 seconds
 * context.evaluateScript(`
 *   while(true) {
 *     // Infinite loop that will be interrupted
 *   }
 * `);
 * ```
 */
export function shouldInterruptAfterDeadline(
  deadlineMs: number
): InterruptHandler {
  const deadline = Date.now() + deadlineMs;
  return () => {
    return Date.now() >= deadline;
  };
}

/**
 * Creates an interrupt handler that terminates execution after a certain number of operations.
 *
 * This provides a more deterministic approach to limiting execution compared to
 * time-based limits. Each time the handler is called by the runtime (typically once
 * per operation or small block of operations), it increments a counter and interrupts
 * when the counter exceeds the specified maximum.
 *
 * @param maxSteps - The maximum number of operations to allow before interrupting
 * @returns An interrupt handler function that will return true after the specified number of steps
 *
 * @example
 * ```typescript
 * // Create a handler that interrupts after 1 million operations
 * const handler = shouldInterruptAfterSteps(1000000);
 * runtime.enableInterruptHandler(handler);
 *
 * // This will be interrupted after approximately 1 million operations
 * context.evaluateScript(`
 *   let counter = 0;
 *   while(true) {
 *     counter++;
 *   }
 * `);
 * ```
 */
export function shouldInterruptAfterSteps(maxSteps: number): InterruptHandler {
  let steps = 0;
  return () => {
    steps++;
    return steps >= maxSteps;
  };
}

/**
 * Creates an interrupt handler that terminates execution if memory usage exceeds a specified limit.
 *
 * This helps prevent memory-intensive scripts from exhausting system resources.
 * To minimize performance impact, memory usage is only checked periodically rather
 * than on every operation.
 *
 * @param maxMemoryBytes - Maximum memory usage in bytes before interrupting
 * @param checkIntervalSteps - How often to check memory usage (every N operations), defaults to 1000
 * @returns An interrupt handler function that will return true when memory usage exceeds the limit
 *
 * @example
 * ```typescript
 * // Create a handler that interrupts if memory usage exceeds 100MB
 * const handler = shouldInterruptAfterMemoryUsage(100 * 1024 * 1024);
 * runtime.enableInterruptHandler(handler);
 *
 * // This will be interrupted if it allocates more than 100MB
 * context.evaluateScript(`
 *   const arrays = [];
 *   while(true) {
 *     arrays.push(new Uint8Array(1024 * 1024)); // Allocate 1MB per iteration
 *   }
 * `);
 * ```
 */
export function shouldInterruptAfterMemoryUsage(
  maxMemoryBytes: number,
  checkIntervalSteps = 1000
): InterruptHandler {
  let steps = 0;

  return (runtime: HakoRuntime) => {
    steps++;

    // Only check memory usage periodically to avoid performance impact
    if (steps % checkIntervalSteps === 0) {
      const context = runtime.getSystemContext();
      const memoryUsage = runtime.computeMemoryUsage(context);

      if (memoryUsage.memory_used_size > maxMemoryBytes) {
        return true;
      }
    }

    return false;
  };
}

/**
 * Creates a composite interrupt handler that combines multiple interrupt conditions.
 *
 * This function allows combining several interrupt handlers, such as time limits,
 * step limits, and memory limits. The resulting handler will interrupt execution
 * if ANY of the provided handlers returns true.
 *
 * @param handlers - Array of interrupt handlers to combine
 * @returns A combined interrupt handler function
 *
 * @example
 * ```typescript
 * // Create a handler that interrupts after 5 seconds OR 1 million steps
 * const timeHandler = shouldInterruptAfterDeadline(5000);
 * const stepHandler = shouldInterruptAfterSteps(1000000);
 * const combinedHandler = combineInterruptHandlers(timeHandler, stepHandler);
 *
 * runtime.enableInterruptHandler(combinedHandler);
 * ```
 */
export function combineInterruptHandlers(
  ...handlers: InterruptHandler[]
): InterruptHandler {
  return (runtime: HakoRuntime, context: VMContext, opaque: JSVoid) => {
    for (const handler of handlers) {
      if (handler(runtime, context, opaque)) {
        return true;
      }
    }
    return false;
  };
}

/**
 * Creates an interrupt handler with multiple resource limits in a single call.
 *
 * This is a convenience function that creates and combines appropriate interrupt
 * handlers based on the specified options. You can limit execution time, memory
 * usage, and/or operation count with a single function call.
 *
 * @param options - Configuration options for resource limits
 * @param options.maxTimeMs - Optional maximum execution time in milliseconds
 * @param options.maxMemoryBytes - Optional maximum memory usage in bytes
 * @param options.maxSteps - Optional maximum number of operations
 * @param options.memoryCheckInterval - Optional interval for memory checks (default: 1000)
 * @returns A combined interrupt handler function
 *
 * @example
 * ```typescript
 * // Create a handler with multiple limits
 * const handler = createResourceLimitedInterruptHandler({
 *   maxTimeMs: 5000,            // 5 seconds max
 *   maxMemoryBytes: 100_000_000, // 100MB max
 *   maxSteps: 10_000_000,        // 10 million operations max
 * });
 *
 * runtime.enableInterruptHandler(handler);
 * ```
 */
export function createResourceLimitedInterruptHandler(options: {
  maxTimeMs?: number;
  maxMemoryBytes?: number;
  maxSteps?: number;
  memoryCheckInterval?: number;
}): InterruptHandler {
  const handlers: InterruptHandler[] = [];

  if (options.maxTimeMs) {
    handlers.push(shouldInterruptAfterDeadline(options.maxTimeMs));
  }

  if (options.maxSteps) {
    handlers.push(shouldInterruptAfterSteps(options.maxSteps));
  }

  if (options.maxMemoryBytes) {
    handlers.push(
      shouldInterruptAfterMemoryUsage(
        options.maxMemoryBytes,
        options.memoryCheckInterval || 1000
      )
    );
  }

  return combineInterruptHandlers(...handlers);
}

/**
 * A pausable interrupt handler that can be enabled/disabled at runtime.
 *
 * This class wraps an existing interrupt handler and provides methods to
 * temporarily pause and resume interruption. This is useful for scenarios
 * where you need to disable interruption during critical sections of code,
 * then re-enable it afterward.
 *
 * @example
 * ```typescript
 * // Create a pausable handler with a 5-second time limit
 * const baseHandler = shouldInterruptAfterDeadline(5000);
 * const pausableHandler = new PausableInterruptHandler(baseHandler);
 *
 * // Enable the pausable handler
 * runtime.enableInterruptHandler(pausableHandler.interruptHandler);
 *
 * // Later, temporarily pause interruption
 * pausableHandler.pause();
 *
 * // Execute critical code without interruption
 * context.evaluateScript("");
 */
export class PausableInterruptHandler {
  private handler: InterruptHandler;
  private isPaused = false;

  /**
   * Creates a new pausable interrupt handler.
   *
   * @param baseHandler - The underlying interrupt handler to wrap
   */
  constructor(baseHandler: InterruptHandler) {
    this.handler = baseHandler;
  }

  /**
   * The interrupt handler function to pass to the runtime.
   *
   * Use this property when calling `runtime.enableInterruptHandler()`.
   *
   * @param runtime - The Hako runtime instance
   * @param context - The VM context
   * @param opaque - Opaque data passed to the handler enable call
   * @returns Boolean indicating whether execution should be interrupted
   */
  public interruptHandler: InterruptHandler = (
    runtime: HakoRuntime,
    context: VMContext,
    opaque: JSVoid
  ) => {
    if (this.isPaused) {
      return false;
    }
    return this.handler(runtime, context, opaque);
  };

  /**
   * Pauses the interrupt handler.
   *
   * While paused, the handler will not interrupt execution regardless of
   * resource usage or other conditions.
   */
  public pause(): void {
    this.isPaused = true;
  }

  /**
   * Resumes the interrupt handler.
   *
   * After resuming, the handler will again interrupt execution based on
   * its underlying conditions.
   */
  public resume(): void {
    this.isPaused = false;
  }

  /**
   * Toggles the paused state of the interrupt handler.
   *
   * @returns The new paused state (true if now paused, false if now active)
   */
  public toggle(): boolean {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }
}
