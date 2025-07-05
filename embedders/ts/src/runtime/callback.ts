/**
 * callbacks.ts - Host/VM callback system for PrimJS wrapper
 *
 * This module provides the callback management system that enables bidirectional
 * communication between the host JavaScript environment and the WebAssembly-based
 * PrimJS virtual machine. It handles function calls, interrupts, module loading,
 * and context/runtime registrations.
 */

import type { VMContext } from "@hako/vm/context";
import type { HakoExports } from "@hako/etc/ffi";
import { DisposableResult, Scope } from "@hako/mem/lifetime";
import type { MemoryManager } from "@hako/mem/memory";
import type { HakoRuntime } from "@hako/runtime/runtime";
import type {
  HostCallbackFunction,
  JSContextPointer,
  JSRuntimePointer,
  JSValuePointer,
  ModuleLoaderFunction,
  ModuleNormalizerFunction,
  InterruptHandler,
  ProfilerEventHandler,
  TraceEvent,
  JSVoid,
  ModuleResolverFunction,
} from "@hako/etc/types";
import { VMValue } from "@hako/vm/value";

/**
 * Manages bidirectional callbacks between the host JavaScript environment and the PrimJS VM.
 *
 * CallbackManager serves as the bridge between JavaScript and WebAssembly, enabling:
 * - Host JavaScript functions to be called from the PrimJS environment
 * - Module loading and resolution for ES modules support
 * - Interrupt handling for execution control
 * - Context and runtime object tracking
 *
 * This class maintains registries of JavaScript objects and their corresponding
 * WebAssembly pointers to enable seamless interoperability.
 */
export class CallbackManager {
  /**
   * Reference to the WebAssembly exports object.
   * @private
   */
  // biome-ignore lint/style/noNonNullAssertion: Will be initialized in setExports
  private exports: HakoExports = null!;

  /**
   * Reference to the memory manager for handling WebAssembly memory operations.
   * @private
   */
  private memory: MemoryManager;

  // Callback registries
  /**
   * Map of function IDs to host callback functions.
   * @private
   */
  private hostFunctions: Map<number, HostCallbackFunction<VMValue>> = new Map();

  /**
   * Counter for generating unique function IDs.
   * Starts at -32768 to avoid conflicts with any internal IDs.
   * @private
   */
  private nextFunctionId = -32768;

  /**
   * Function for loading module source code by name.
   * @private
   */
  private moduleLoader: ModuleLoaderFunction | null = null;

  /**
   * Function for normalizing module specifiers into absolute module names.
   * @private
   */
  private moduleNormalizer: ModuleNormalizerFunction | null = null;

  /**
   * Function for resolving module names (import.meta.resolve).
   * @private
   */
  private moduleResolver: ModuleResolverFunction | null = null;

  /**
   * Function for handling interrupts during long-running operations.
   * @private
   */
  private interruptHandler: InterruptHandler | null = null;

  /**
   * Handler for function profiling events
   * @private
   */
  private profilerHandler: ProfilerEventHandler | null = null;

  /**
   * Registry mapping context pointers to their corresponding VMContext objects.
   * @private
   */
  private contextRegistry: Map<number, VMContext> = new Map();

  /**
   * Registry mapping runtime pointers to their corresponding HakoRuntime objects.
   * @private
   */
  private runtimeRegistry: Map<number, HakoRuntime> = new Map();

  /**
   * Creates a new CallbackManager instance.
   *
   * @param memory - The memory manager to use for WebAssembly memory operations
   */
  constructor(memory: MemoryManager) {
    this.memory = memory;
  }

  /**
   * Sets the WebAssembly exports object after module instantiation.
   * Must be called before using other methods.
   *
   * @param exports - The PrimJS WebAssembly exports object
   */
  setExports(exports: HakoExports): void {
    this.exports = exports;
  }

  /**
   * Returns the import object needed for WebAssembly module instantiation.
   *
   * This provides the callback functions that the WebAssembly module will call
   * to communicate with the host JavaScript environment.
   *
   * @returns WebAssembly import object with callback functions
   */
  getImports(): Record<string, unknown> {
    return {
      hako: {
        // Host function call handler
        call_function: (
          ctxPtr: number,
          thisPtr: number,
          argc: number,
          argv: number,
          funcId: number
        ): number => {
          return this.handleHostFunctionCall(
            ctxPtr,
            thisPtr,
            argc,
            argv,
            funcId
          );
        },

        // Interrupt handler
        interrupt_handler: (
          rtPtr: number,
          ctxPtr: number,
          opaque: number
        ): number => {
          return this.handleInterrupt(rtPtr, ctxPtr, opaque) ? 1 : 0;
        },

        // Module source loader
        load_module_source: (
          rtPtr: number,
          ctxPtr: number,
          moduleNamePtr: number,
          _opaque: number
        ): number => {
          return this.handleModuleLoad(rtPtr, ctxPtr, moduleNamePtr);
        },

        // Module name normalizer
        normalize_module: (
          rtPtr: number,
          ctxPtr: number,
          baseNamePtr: number,
          moduleNamePtr: number,
          _opaque: number
        ): number => {
          return this.handleModuleNormalize(
            rtPtr,
            ctxPtr,
            baseNamePtr,
            moduleNamePtr
          );
        },
        resolve_module: (
          rtPtr: number,
          ctxPtr: number,
          moduleNamePtr: number,
          currentModulePtr: number,
          _opaque: number
        ): number => {
          // This is an alias for load_module_source, PrimJS uses this for module resolution
          return this.handleModuleResolve(
            rtPtr,
            ctxPtr,
            moduleNamePtr,
            currentModulePtr,
            _opaque
          );
        },  
        profile_function_start: (
          ctxPtr: number,
          func_name: number,
          opaque: number
        ): void => {
          this.handleProfileFunctionStart(ctxPtr, func_name, opaque);
        },
        profile_function_end: (
          ctxPtr: number,
          func_name: number,
          opaque: number
        ): void => {
          this.handleProfileFunctionEnd(ctxPtr, func_name, opaque);
        },
      },
    };
  }

  /**
   * Registers a VMContext object with its corresponding pointer.
   *
   * This associates a JavaScript VMContext object with its WebAssembly pointer
   * to enable lookups in either direction.
   *
   * @param ctxPtr - The WebAssembly pointer to the context
   * @param ctx - The VMContext object to register
   */
  registerContext(ctxPtr: JSContextPointer, ctx: VMContext): void {
    this.contextRegistry.set(ctxPtr, ctx);
  }

  /**
   * Unregisters a context from the registry.
   *
   * Call this when a context is disposed to prevent memory leaks.
   *
   * @param ctxPtr - The WebAssembly pointer to the context
   */
  unregisterContext(ctxPtr: JSContextPointer): void {
    this.contextRegistry.delete(ctxPtr);
  }

  /**
   * Gets a VMContext object from its WebAssembly pointer.
   *
   * @param ctxPtr - The WebAssembly pointer to the context
   * @returns The corresponding VMContext object, or undefined if not found
   */
  getContext(ctxPtr: JSContextPointer): VMContext | undefined {
    return this.contextRegistry.get(ctxPtr);
  }

  /**
   * Registers a HakoRuntime object with its corresponding pointer.
   *
   * This associates a JavaScript HakoRuntime object with its WebAssembly pointer
   * to enable lookups in either direction.
   *
   * @param rtPtr - The WebAssembly pointer to the runtime
   * @param runtime - The HakoRuntime object to register
   */
  registerRuntime(rtPtr: JSRuntimePointer, runtime: HakoRuntime): void {
    this.runtimeRegistry.set(rtPtr, runtime);
  }

  /**
   * Unregisters a runtime from the registry.
   *
   * Call this when a runtime is disposed to prevent memory leaks.
   *
   * @param rtPtr - The WebAssembly pointer to the runtime
   */
  unregisterRuntime(rtPtr: JSRuntimePointer): void {
    this.runtimeRegistry.delete(rtPtr);
  }

  /**
   * Gets a HakoRuntime object from its WebAssembly pointer.
   *
   * @param rtPtr - The WebAssembly pointer to the runtime
   * @returns The corresponding HakoRuntime object, or undefined if not found
   */
  getRuntime(rtPtr: JSRuntimePointer): HakoRuntime | undefined {
    return this.runtimeRegistry.get(rtPtr);
  }

  /**
   * Registers a host JavaScript function that can be called from PrimJS.
   *
   * @param callback - The JavaScript function to register
   * @returns A function ID that can be used to create a PrimJS function
   */
  registerHostFunction(callback: HostCallbackFunction<VMValue>): number {
    const id = this.nextFunctionId++;
    this.hostFunctions.set(id, callback);
    return id;
  }

  /**
   * Unregisters a previously registered host function.
   *
   * @param id - The function ID returned by registerHostFunction
   */
  unregisterHostFunction(id: number): void {
    this.hostFunctions.delete(id);
  }

  /**
   * Creates a new PrimJS function that calls a host JavaScript function.
   *
   * This creates a JavaScript function in the PrimJS environment that,
   * when called, will execute the provided host callback function.
   *
   * @param ctx - The PrimJS context pointer
   * @param callback - The host function to call
   * @param name - Function name for debugging and error messages
   * @returns Pointer to the new function JSValue
   * @throws Error if exports are not set
   */
  newFunction(
    ctx: JSContextPointer,
    callback: HostCallbackFunction<VMValue>,
    name: string
  ): JSValuePointer {
    if (!this.exports) {
      throw new Error("Exports not set on CallbackManager");
    }

    const id = this.registerHostFunction(callback);
    const namePtr = this.memory.allocateString(ctx, name);
    const funcPtr = this.exports.HAKO_NewFunction(ctx, id, namePtr);
    this.memory.freeMemory(ctx, namePtr);
    return funcPtr;
  }

  /**
   * Sets the module loader function for ES modules support.
   *
   * The module loader is called when PrimJS needs to load a module by name.
   * It should return the module's source code as a string, or null if not found.
   *
   * @param loader - The module loader function or null to disable module loading
   */
  setModuleLoader(loader: ModuleLoaderFunction | null): void {
    this.moduleLoader = loader;
  }

  /**
   * Sets the module normalizer function for ES modules support.
   *
   * The module normalizer is called to resolve relative module specifiers
   * into absolute module names.
   *
   * @param normalizer - The module normalizer function or null to use default normalization
   */
  setModuleNormalizer(normalizer: ModuleNormalizerFunction | null): void {
    this.moduleNormalizer = normalizer;
  }

  setModuleResolver(
    resolver: ModuleResolverFunction | null
  ): void {
    this.moduleResolver = resolver;
  }

  /**
   * Sets the interrupt handler function for execution control.
   *
   * The interrupt handler is called periodically during PrimJS execution
   * and can terminate execution by returning true.
   *
   * @param handler - The interrupt handler function or null to disable interrupts
   */
  setInterruptHandler(handler: InterruptHandler | null): void {
    this.interruptHandler = handler;
  }

  /**
   * Sets up runtime callbacks for a specific runtime instance.
   *
   * This registers the runtime object for later lookup and enables
   * callback functionality for the runtime.
   *
   * @param rtPtr - The WebAssembly pointer to the runtime
   * @param runtime - The HakoRuntime object
   */
  setRuntimeCallbacks(rtPtr: JSRuntimePointer, runtime: HakoRuntime): void {
    this.registerRuntime(rtPtr, runtime);
  }

  /**
   * Sets the profiler event handler for function profiling.
   *
   * @param handler - The profiler event handler or null to disable profiling
   */
  setProfilerHandler(handler: ProfilerEventHandler | null): void {
    this.profilerHandler = handler;
  }

  /**
   * Handles a call from PrimJS to a host JavaScript function.
   *
   * This is called by the WebAssembly module when a host function
   * registered with registerHostFunction is invoked from PrimJS.
   *
   * @param ctxPtr - The PrimJS context pointer
   * @param thisPtr - The 'this' value pointer for the function call
   * @param argc - Number of arguments
   * @param argvPtr - Pointer to the argument array
   * @param funcId - Function ID from registerHostFunction
   * @returns Pointer to the result JSValue
   */
  handleHostFunctionCall(
  ctxPtr: JSContextPointer,
  thisPtr: JSValuePointer,
  argc: number,
  argvPtr: number,
  funcId: number
): number {
  const callback = this.hostFunctions.get(funcId);
  if (!callback) {
    console.error(`No callback registered for function ID ${funcId}`);
    return this.exports.HAKO_GetUndefined();
  }
  
  // Get the context object
  const ctx = this.getContext(ctxPtr);
  if (!ctx) {
    console.error(`No context registered for pointer ${ctxPtr}`);
    return this.exports.HAKO_GetUndefined();
  }

  return Scope.withScopeMaybeAsync(this, function* (awaited, scope) {
    // Create handles for 'this' and arguments
    const thisHandle = scope.manage(ctx.borrowValue(thisPtr));
    const argHandles = new Array<VMValue>(argc);
    
    for (let i = 0; i < argc; i++) {
      const argPtr = this.exports.HAKO_ArgvGetJSValueConstPointer(argvPtr, i);
      const arg = ctx.duplicateValue(argPtr);
      argHandles[i] = scope.manage(arg);
    }

    try {
      // Call the callback function and handle its result
      const result = yield* awaited(callback.apply(thisHandle, argHandles));
      
      if (result) {
        if (result instanceof VMValue) {
          // Duplicate the result handle and dispose the original
          const duplicatedHandle = this.exports.HAKO_DupValuePointer(
            ctxPtr,
            result.getHandle()
          );
          result.dispose(); // Dispose the original result
          return duplicatedHandle;
        }
        
        if (DisposableResult.is(result)) {
          if (result.error) {
            console.error("Error in callback:", result.error);
            // Dispose the result and handle error
            result.dispose();
            try {
              result.unwrap(); // This will throw
            } catch (e) {
              // Convert the error to a PrimJS exception and return it
              using errorHandle = ctx.newValue(e as Error);
              return this.exports.HAKO_Throw(ctxPtr, errorHandle.getHandle());
            }
            return this.exports.HAKO_GetUndefined();
          }
          
          // Unwrap the result and dispose the wrapper
          const unwrapped = result.unwrap();
          result.dispose(); // Dispose the DisposableResult wrapper
          
          const duplicatedHandle = this.exports.HAKO_DupValuePointer(
            ctxPtr,
            unwrapped.getHandle()
          );
          unwrapped.dispose(); // Dispose the unwrapped value
          return duplicatedHandle;
        }
        
        // This should never happen based on your comment, but handle gracefully
        console.warn("Unexpected result type in handleHostFunctionCall:", typeof result);
        return this.exports.HAKO_GetUndefined();
      }
      
      return this.exports.HAKO_GetUndefined();
      
    } catch (error) {
      // FIXED: Use 'using' for proper disposal of error handle
      try {
        using errorHandle = ctx.newValue(error as Error);
        return this.exports.HAKO_Throw(ctxPtr, errorHandle.getHandle());
      } catch (conversionError) {
        // If we can't convert the error, log it and return undefined
        console.error("Failed to convert error to PrimJS:", conversionError);
        return this.exports.HAKO_GetUndefined();
      }
    }
  }) as number;
}

  /**
   * Handles a module load request from PrimJS.
   *
   * This is called by the WebAssembly module when PrimJS needs to load
   * a module during import or dynamic import operations.
   *
   * @param _rtPtr - The PrimJS runtime pointer
   * @param _ctxPtr - The PrimJS context pointer
   * @param moduleNamePtr - Pointer to the module name string
   * @returns Pointer to the module source string, or 0 if not found
   */
  handleModuleLoad(
    _rtPtr: JSRuntimePointer,
    _ctxPtr: JSContextPointer,
    moduleNamePtr: number
  ): number {
    return Scope.withScopeMaybeAsync(this, function* (awaited, _scope) {
      if (!this.moduleLoader) {
        console.error("No module loader registered");
        return 0;
      }

      // Read the module name and call the module loader
      const moduleName = this.memory.readString(moduleNamePtr);
      const moduleSource = yield* awaited(this.moduleLoader(moduleName));

      if (moduleSource === null) {
        console.error(`Module ${moduleName} not found`);
        return 0;
      }

      // Allocate the source code string in WebAssembly memory
      return this.memory.allocateString(_ctxPtr, moduleSource);
    }) as JSValuePointer;
  }

  handleModuleResolve(
    _rtPtr: JSRuntimePointer,
    _ctxPtr: JSContextPointer,
    moduleNamePtr: number,
    currentModulePtr: number,
    _opaque: JSVoid
  ): number {
     if (!this.moduleResolver) {
        console.error("No module resolver registered");
        return 0;
      }

      if (moduleNamePtr === 0) {
        return 0; // Invalid module name pointer
      }

      // Read the module name and call the module loader
      const moduleName = this.memory.readString(moduleNamePtr);
      let currentModuleName;
      if (currentModulePtr !== 0) {
        currentModuleName = this.memory.readString(currentModulePtr);
      }

      const resolvedPath = this.moduleResolver(moduleName, currentModuleName);
      if (!resolvedPath) {
        console.error(`Module ${moduleName} not found`);
        return 0;
      }
      // Allocate the source code string in WebAssembly memory
      return this.memory.allocateString(_ctxPtr,resolvedPath);
  }

  /**
   * Handles a module normalization request from PrimJS.
   *
   * This is called by the WebAssembly module when PrimJS needs to
   * resolve a relative module specifier against a base module.
   *
   * @param _rtPtr - The PrimJS runtime pointer
   * @param _ctxPtr - The PrimJS context pointer
   * @param baseNamePtr - Pointer to the base module name string
   * @param moduleNamePtr - Pointer to the module specifier string
   * @returns Pointer to the normalized module name string
   */
  handleModuleNormalize(
    _rtPtr: JSRuntimePointer,
    _ctxPtr: JSContextPointer,
    baseNamePtr: number,
    moduleNamePtr: number
  ): number {
    return Scope.withScopeMaybeAsync(this, function* (awaited, _scope) {
      if (!this.moduleNormalizer) {
        // Default normalization: just return the module name
        return moduleNamePtr;
      }

      // Read the base name and module name
      const baseName = this.memory.readString(baseNamePtr);
      const moduleName = this.memory.readString(moduleNamePtr);

      // Call the module normalizer
      const normalizedName = yield* awaited(
        this.moduleNormalizer(baseName, moduleName)
      );

      // Allocate the normalized name in WebAssembly memory
      return this.memory.allocateString(_ctxPtr, normalizedName);
    }) as JSValuePointer;
  }

  /**
   * Handles an interrupt request from PrimJS.
   *
   * This is called periodically during PrimJS execution to check
   * if execution should be interrupted.
   *
   * @param rtPtr - The PrimJS runtime pointer
   * @returns True to interrupt execution, false to continue
   */
  handleInterrupt(
    rtPtr: JSRuntimePointer,
    ctxPtr: JSContextPointer,
    opaque: JSVoid
  ): boolean {
    if (!this.interruptHandler) {
      return false;
    }

    try {
      // Get the runtime object
      const runtime = this.getRuntime(rtPtr);
      if (!runtime) {
        return true;
      }
      const ctx = this.getContext(ctxPtr);
      if (!ctx) {
        return true;
      }

      // Call the interrupt handler with the runtime object
      const shouldInterrupt = this.interruptHandler(runtime, ctx, opaque);
      return shouldInterrupt === true;
    } catch (error) {
      console.error("Error in interrupt handler:", error);
      return false;
    }
  }

  /**
   * Handles a function profiling start event from PrimJS.
   *
   * This is called by the WebAssembly module when a profiled function starts.
   *
   * @param ctxPtr - The PrimJS context pointer
   * @param funcNamePtr - Pointer to the function name string
   * @param opaque - Opaque data pointer passed through to the handler
   */
  handleProfileFunctionStart(
    ctxPtr: JSContextPointer,
    eventPtr: number,
    opaque: JSVoid
  ): void {
    if (!this.profilerHandler) {
      return;
    }
    const ctx = this.getContext(ctxPtr);
    if (!ctx) {
      return;
    }
    try {
      const event = JSON.parse(this.memory.readString(eventPtr)) as TraceEvent;
      // Call the handler
      this.profilerHandler.onFunctionStart(ctx, event, opaque);
    } catch (error) {
      console.error("Error in profile function start handler:", error);
    }
  }

  /**
   * Handles a function profiling end event from PrimJS.
   *
   * This is called by the WebAssembly module when a profiled function ends.
   *
   * @param ctxPtr - The PrimJS context pointer
   * @param funcNamePtr - Pointer to the function name string
   * @param opaque - Opaque data pointer passed through to the handler
   */
  handleProfileFunctionEnd(
    ctxPtr: JSContextPointer,
    eventPtr: number,
    opaque: JSVoid
  ): void {
    if (!this.profilerHandler) {
      return;
    }
    const ctx = this.getContext(ctxPtr);
    if (!ctx) {
      return;
    }
    try {
      const event = JSON.parse(this.memory.readString(eventPtr)) as TraceEvent;
      // Call the handler
      this.profilerHandler.onFunctionEnd(ctx, event, opaque);
    } catch (error) {
      console.error("Error in profile function end handler:", error);
    }
  }
}
