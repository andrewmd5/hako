import type {
  ContextOptions,
  ExecutePendingJobsResult,
  JSVoid,
  ModuleResolverFunction,
  ProfilerEventHandler,
  StripOptions,
} from "@hako/etc/types";
import type { Container } from "@hako/runtime/container";
import { VMContext } from "@hako/vm/context";
import {
  type JSRuntimePointer,
  type MemoryUsage,
  type ModuleLoaderFunction,
  type ModuleNormalizerFunction,
  type InterruptHandler,
  intrinsicsToFlags,
  ValueLifecycle,
  JS_STRIP_DEBUG,
  JS_STRIP_SOURCE,
} from "@hako/etc/types";
import { VMValue } from "@hako/vm/value";
import { DisposableResult, Scope } from "@hako/mem/lifetime";
import { CModuleBuilder, type CModuleInitializer } from "@hako/vm/cmodule";

/**
 * The HakoRuntime class represents a JavaScript execution environment.
 *
 * It manages the lifecycle of JS execution contexts, handles memory allocation
 * and deallocation, provides module loading capabilities, and offers utilities
 * for performance monitoring and control.
 *
 * @implements {Disposable} - Implements the Disposable interface for resource cleanup
 */
export class HakoRuntime implements Disposable {
  /**
   * The dependency injection container that provides access to core services and WebAssembly exports.
   */
  private container: Container;

  /**
   * An optional default context for this runtime.
   *
   * If this runtime was created as part of a context, points to the context
   * associated with the runtime. If this runtime was created stand-alone, this may
   * be lazily initialized when needed (e.g., for {@link computeMemoryUsage}).
   */
  private context: VMContext | undefined;

  /**
   * The pointer to the native runtime instance in WebAssembly memory.
   */
  private rtPtr: JSRuntimePointer;

  /**
   * Flag indicating whether this runtime has been released.
   */
  private isReleased = false;

  /**
   * Map of all contexts created within this runtime, keyed by their pointer values.
   * Used for management and cleanup.
   */
  private contextMap = new Map<number, VMContext>();

  /**
   * Reference to the current interrupt handler function.
   * Stored to allow for proper cleanup when the runtime is disposed.
   */
  private currentInterruptHandler: InterruptHandler | null = null;

  /**
   * Creates a new HakoRuntime instance.
   *
   * @param container - The dependency injection container that provides access to core services
   * @param rtPtr - The pointer to the native runtime instance in WebAssembly memory
   */
  constructor(container: Container, rtPtr: JSRuntimePointer) {
    this.container = container;
    this.rtPtr = rtPtr;
    // Register this runtime with the callback manager for proper callback routing
    this.container.callbacks.registerRuntime(rtPtr, this);
  }

  /**
   * Gets the native runtime pointer.
   *
   * @returns The pointer to the native runtime instance in WebAssembly memory
   */
  get pointer(): JSRuntimePointer {
    return this.rtPtr;
  }

  /**
   * Creates a C module with inline handler registration
   */
  createCModule(
    name: string,
    handler: (initializer: CModuleInitializer) => number | void,
    ctx: VMContext | undefined = undefined
  ): CModuleBuilder {
    return new CModuleBuilder(
      ctx ? ctx : this.getSystemContext(),
      name,
      handler
    );
  }

  /**
   * Creates a new JavaScript execution context within this runtime.
   *
   * Contexts isolate JavaScript execution environments, each with their own global object
   * and set of available APIs based on the specified intrinsics.
   *
   * @param options - Configuration options for the new context
   * @param options.contextPointer - Optional existing context pointer to wrap
   * @param options.intrinsics - Optional set of intrinsics to include in the context
   * @param options.maxStackSizeBytes - Optional maximum stack size for the context
   *
   * @returns A new VMContext instance
   * @throws {Error} When context creation fails
   */
  createContext(options: ContextOptions = {}): VMContext {
    if (options.contextPointer) {
      // If we already have this context in our map, return the existing instance
      const existingContext = this.contextMap.get(options.contextPointer);
      if (existingContext) {
        return existingContext;
      }
      return new VMContext(this.container, this, options.contextPointer);
    }

    // Calculate intrinsics flags based on options or use all intrinsics by default
    const intrinsics = options.intrinsics
      ? intrinsicsToFlags(options.intrinsics)
      : 0;

    // Create the native context
    const ctxPtr = this.container.exports.HAKO_NewContext(
      this.rtPtr,
      intrinsics
    );

    // Verify context creation was successful
    if (ctxPtr === 0) {
      throw new Error("Failed to create context");
    }

    // Create the JavaScript wrapper for the context
    const context = new VMContext(this.container, this, ctxPtr);

    // Apply additional configuration if specified
    if (options.maxStackSizeBytes) {
      context.setMaxStackSize(options.maxStackSizeBytes);
    }

    // Store the context in our tracking map for lifecycle management
    this.contextMap.set(ctxPtr, context);

    return context;
  }

  /**
   * Sets the stripping options for the runtime
   *
   * @param options - Configuration options for code stripping
   * @param options.stripSource - When true, source code will be stripped
   * @param options.stripDebug - When true, all debug info will be stripped (including source)
   *
   * @example
   * // Strip only source code
   * runtime.setStripInfo({ stripSource: true });
   *
   * // Strip all debug info (including source)
   * runtime.setStripInfo({ stripDebug: true });
   */
  setStripInfo(options?: StripOptions): void {
    let flags = 0;

    if (options?.stripSource) {
      flags |= JS_STRIP_SOURCE;
    }

    if (options?.stripDebug) {
      flags |= JS_STRIP_DEBUG;
    }

    this.container.exports.HAKO_SetStripInfo(this.rtPtr, flags);
  }

  /**
   * Gets the current stripping configuration
   *
   * @returns The current stripping options
   *
   * @remarks
   * Note that stripSource will be true if either source stripping or debug stripping
   * is enabled, matching the behavior of the underlying C implementation.
   *
   * @example
   * const options = runtime.getStripInfo();
   * console.log(`Source stripping: ${options.stripSource}`);
   * console.log(`Debug stripping: ${options.stripDebug}`);
   */
  getStripInfo(): StripOptions {
    const flags = this.container.exports.HAKO_GetStripInfo(this.rtPtr);

    return {
      stripSource:
        (flags & JS_STRIP_SOURCE) !== 0 || (flags & JS_STRIP_DEBUG) !== 0,
      stripDebug: (flags & JS_STRIP_DEBUG) !== 0,
    };
  }

  /**
   * Sets the memory usage limit for this runtime.
   *
   * This controls the maximum amount of memory the JavaScript engine can allocate.
   * When the limit is reached, allocation attempts will fail with out-of-memory errors.
   *
   * @param limit - The memory limit in bytes, or -1 for no limit (default)
   */
  setMemoryLimit(limit?: number): void {
    const runtimeLimit = limit === undefined ? -1 : limit;
    this.container.exports.HAKO_RuntimeSetMemoryLimit(this.rtPtr, runtimeLimit);
  }

  /**
   * Computes detailed memory usage statistics for this runtime.
   *
   * This method provides insights into how memory is being used by different
   * components of the JavaScript engine.
   *
   * @param ctx - Optional context to use for creating the result object.
   *              If not provided, the system context will be used.
   *
   * @returns An object containing memory usage information
   * @throws {Error} When memory usage computation fails
   */
  computeMemoryUsage(ctx: VMContext | undefined = undefined): MemoryUsage {
    return Scope.withScope((scope) => {
      // Use provided context or get the system context
      const ctxPtr = ctx ? ctx.pointer : this.getSystemContext().pointer;

      // Get memory usage data as a JavaScript value
      const valuePtr = this.container.exports.HAKO_RuntimeComputeMemoryUsage(
        this.rtPtr,
        ctxPtr
      );

      if (valuePtr === 0) {
        console.error("Failed to compute memory usage");
        return {} as MemoryUsage;
        // Alternatively, you could throw an error here
        //  throw new Error("Failed to compute memory usage");
      }

      // Register cleanup for valuePtr
      scope.add(() => this.container.memory.freeValuePointer(ctxPtr, valuePtr));

      // Convert to JSON
      const jsonValue = this.container.exports.HAKO_ToJson(ctxPtr, valuePtr, 0);
      if (jsonValue === 0) {
        throw new Error("Failed to convert memory usage to JSON");
      }

      // Register cleanup for jsonValue
      scope.add(() =>
        this.container.memory.freeValuePointer(ctxPtr, jsonValue)
      );

      // Extract string data
      const strPtr = this.container.exports.HAKO_ToCString(ctxPtr, jsonValue);
      if (strPtr === 0) {
        throw new Error("Failed to get string from memory usage");
      }

      // Register cleanup for strPtr
      scope.add(() => this.container.memory.freeCString(ctxPtr, strPtr));

      // Read and parse the string
      const str = this.container.memory.readString(strPtr);
      return JSON.parse(str) as MemoryUsage;
    });
  }

  /**
   * Generates a human-readable string representation of memory usage.
   *
   * This is useful for debugging memory issues or monitoring runtime memory consumption.
   *
   * @returns A formatted string containing memory usage information
   */
  dumpMemoryUsage(): string {
    const strPtr = this.container.exports.HAKO_RuntimeDumpMemoryUsage(
      this.rtPtr
    );
    const str = this.container.memory.readString(strPtr);
    this.container.memory.freeRuntimeMemory(this.pointer, strPtr);
    return str;
  }

  /**
   * Enables the module loader for this runtime to support ES modules.
   *
   * The module loader allows JavaScript code executed in this runtime to import
   * modules using the standard ES module syntax (import/export).
   *
   * @param loader - Function to load module source code given a module specifier
   * @param normalizer - Optional function to normalize module names (resolve relative paths, etc.)
   * @param resolver - Optional function to handle import.meta.resolve calls
   */
  enableModuleLoader(
    loader: ModuleLoaderFunction,
    normalizer?: ModuleNormalizerFunction,
    resolver?: ModuleResolverFunction
  ): void {
    this.container.callbacks.setModuleLoader(loader);
    if (normalizer) {
      this.container.callbacks.setModuleNormalizer(normalizer);
    }
    if (resolver) {
      this.container.callbacks.setModuleResolver(resolver);
    }
    this.container.exports.HAKO_RuntimeEnableModuleLoader(
      this.rtPtr,
      normalizer ? 1 : 0
    );
  }

  /**
   * Disables the module loader for this runtime.
   *
   * After calling this method, attempts to import modules will fail.
   */
  disableModuleLoader(): void {
    this.container.callbacks.setModuleLoader(null);
    this.container.callbacks.setModuleNormalizer(null);
    this.container.exports.HAKO_RuntimeDisableModuleLoader(this.rtPtr);
  }

  /**
   * Enables the interrupt handler for this runtime.
   *
   * The interrupt handler allows controlled termination of long-running JavaScript
   * operations to prevent infinite loops or excessive execution time.
   *
   * @param handler - Function called periodically during JavaScript execution to check
   *                  if execution should be interrupted. Return true to interrupt.
   * @param opaque - Optional user data passed to the handler
   */
  enableInterruptHandler(handler: InterruptHandler, opaque?: number): void {
    this.currentInterruptHandler = handler;
    this.container.callbacks.setInterruptHandler(handler);
    this.container.exports.HAKO_RuntimeEnableInterruptHandler(
      this.rtPtr,
      opaque || 0
    );
  }

  /**
   * Enables profiling of JavaScript function calls.
   * @param handler - The handlers for trace events
   * @param sampling - Controls profiling frequency: only 1/sampling function calls are instrumented.
   * Must be ≥ 1. Example: if sampling=4, only 25% of function calls will trigger the handlers.
   * @param opaque - Optional user data passed to both handlers.
   */
  enableProfileCalls(
    handler: ProfilerEventHandler,
    sampling?: number,
    opaque?: JSVoid
  ): void {
    this.container.callbacks.setProfilerHandler(handler);
    this.container.exports.HAKO_EnableProfileCalls(
      this.rtPtr,
      sampling ?? 1,
      opaque ?? 0
    );
  }

  /**
   * Disables the interrupt handler for this runtime.
   *
   * After calling this method, JavaScript code can run without being interruptible,
   * which may lead to infinite loops or excessive execution time.
   */
  disableInterruptHandler(): void {
    this.currentInterruptHandler = null;
    this.container.callbacks.setInterruptHandler(null);
    this.container.exports.HAKO_RuntimeDisableInterruptHandler(this.rtPtr);
  }

  /**
   * Gets or lazily creates the system context for this runtime.
   *
   * The system context is used for operations that need a context but don't
   * specifically require a user-created one.
   *
   * @returns The system context instance
   */
  public getSystemContext(): VMContext {
    if (!this.context) {
      // Lazily initialize the context when needed
      this.context = this.createContext();
    }
    return this.context;
  }

  /**
   * Creates a time-based interrupt handler that terminates execution
   * after a specified time has elapsed.
   *
   * This is useful for imposing time limits on JavaScript execution to prevent
   * excessive CPU usage or hanging processes.
   *
   * @param deadlineMs - The time limit in milliseconds from now
   * @returns An interrupt handler function that can be passed to enableInterruptHandler()
   *
   * @example
   * ```typescript
   * // Limit execution to 1 second
   * const handler = runtime.createDeadlineInterruptHandler(1000);
   * runtime.enableInterruptHandler(handler);
   * context.evaluateScript("while(true) {}"); // Will be interrupted after ~1 second
   * ```
   */
  createDeadlineInterruptHandler(deadlineMs: number): InterruptHandler {
    const deadline = Date.now() + deadlineMs;
    return () => {
      return Date.now() >= deadline;
    };
  }

  /**
   * Creates a gas-based interrupt handler that terminates script execution
   * after a specified number of JavaScript operations (gas units) have been performed.
   *
   * This handler provides a deterministic method for limiting the computational
   * complexity of scripts by counting operations rather than relying on time-based limits.
   *
   * @param maxGas - The maximum number of operations (gas units) allowed before interruption.
   * @returns An interrupt handler function that returns `true` when the gas limit is reached,
   *          which can be passed to `enableInterruptHandler()`.
   *
   * @example
   * ```typescript
   * // Limit execution to 1 million gas units (operations)
   * const handler = runtime.createGasInterruptHandler(1_000_000);
   * runtime.enableInterruptHandler(handler);
   * context.evaluateScript("let i = 0; while(true) { i++; }"); // This script will be interrupted.
   * ```
   */
  createGasInterruptHandler(maxGas: number): InterruptHandler {
    let gas = 0;
    return () => {
      gas++;
      return gas >= maxGas;
    };
  }

  /**
   * Checks if there are pending asynchronous jobs (Promises) in this runtime.
   *
   * @returns True if there are pending jobs, false otherwise
   */
  isJobPending(): boolean {
    return this.container.exports.HAKO_IsJobPending(this.rtPtr) !== 0;
  }

  /**
   * Executes pending Promise jobs (microtasks) in the runtime.
   *
   * In JavaScript engines, promises and async functions create "jobs" that
   * are executed after the current execution context completes. This method
   * manually triggers the execution of these pending jobs.
   *
   * @param maxJobsToExecute - When negative (default), run all pending jobs.
   *                           Otherwise, execute at most `maxJobsToExecute` jobs before returning.
   *
   * @returns On success, returns the number of executed jobs. On error, returns
   * the exception that stopped execution and the context it occurred in.
   *
   * @remarks
   * This method does not normally return errors thrown inside async functions or
   * rejected promises. Those errors are available by calling
   * {@link VMContext#resolvePromise} on the promise handle returned by the async function.
   */
  executePendingJobs(maxJobsToExecute = -1): ExecutePendingJobsResult {
    // Allocate memory for the context output parameter
    const ctxPtrOut = this.container.memory.allocateRuntimePointerArray(
      this.pointer,
      1
    );
    const resultPtr = this.container.exports.HAKO_ExecutePendingJob(
      this.rtPtr,
      maxJobsToExecute,
      ctxPtrOut
    );
    const ctxPtr = this.container.memory.readPointerFromArray(ctxPtrOut, 0);
    this.container.memory.freeRuntimeMemory(this.pointer, ctxPtrOut);

    if (ctxPtr === 0) {
      // No context was created, no jobs were executed
      this.container.memory.freeValuePointerRuntime(this.pointer, resultPtr);
      return DisposableResult.success(0);
    }

    const context = this.createContext({
      contextPointer: ctxPtr,
    });

    const value = VMValue.fromHandle(context, resultPtr, ValueLifecycle.Owned);

    if (value.type === "number") {
      // If the result is a number, it represents the number of executed jobs
      const executedJobs = value.asNumber();
      value.dispose();
      return DisposableResult.success(executedJobs);
    }

    // If we get here, an error occurred during job execution
    const error = Object.assign(value, { context });
    return DisposableResult.fail(error, (error) => context.unwrapResult(error));
  }

  /**
   * Performs a memory leak check if compiled with leak sanitizer.
   *
   * This is a development/debugging utility to detect memory leaks.
   *
   * @returns Leak check result code (non-zero indicates potential leaks)
   */
  recoverableLeakCheck(): number {
    return this.container.exports.HAKO_RecoverableLeakCheck();
  }

  dropContext(context: VMContext): void {
    // Remove the context from our tracking map
    this.contextMap.delete(context.pointer);
  }

  /**
   * Releases all resources associated with this runtime.
   *
   * This includes all contexts, handlers, and the native runtime itself.
   * After calling this method, the runtime instance should not be used.
   */
  release(): void {
    if (!this.isReleased) {
      // Clean up any active interrupt handler
      if (this.currentInterruptHandler) {
        this.disableInterruptHandler();
      }

      // Unregister from the callback manager
      this.container.callbacks.unregisterRuntime(this.rtPtr);

      // Clean up all contexts tracked in our map
      for (const [, context] of this.contextMap.entries()) {
        context.release();
      }

      // Release our system context if it exists
      if (this.context) {
        this.context.release();
      }

      // Clear the context tracking map
      this.contextMap.clear();

      // Free the native runtime
      this.container.exports.HAKO_FreeRuntime(this.rtPtr);
      this.isReleased = true;
    }
  }

  /**
   * Allocates shared runtime memory.
   * @param size - The size in bytes to allocate
   * @returns The pointer to the allocated memory
   */
  allocateMemory(size: number): number {
    if (this.isReleased) {
      throw new Error("Cannot allocate memory on a released runtime");
    }
    return this.container.memory.allocateRuntimeMemory(this.pointer, size);
  }

  /**
   * Frees previously allocated shared runtime memory.
   * @param ptr - The pointer to the memory to free
   */
  freeMemory(ptr: number): void {
    this.container.memory.freeRuntimeMemory(this.pointer, ptr);
  }

  /**
   * Gets build information about the WebAssembly module.
   *
   * @returns Build metadata including version, build date, and configuration
   */
  get build() {
    return this.container.utils.getBuildInfo();
  }

  /**
   * Implements the Symbol.dispose method for the Disposable interface.
   *
   * This allows the runtime to be used with the using/with statements in
   * environments that support the Disposable pattern.
   */
  [Symbol.dispose](): void {
    this.release();
  }
}
