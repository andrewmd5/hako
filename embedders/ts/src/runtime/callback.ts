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
  ModuleInitFunction,
  ClassConstructorHandler,
  ClassFinalizerHandler,
} from "@hako/etc/types";
import { VMValue } from "@hako/vm/value";
import { CModuleInitializer } from "@hako/vm/cmodule";

const HAKO_MODULE_SOURCE_STRING = 0;
const HAKO_MODULE_SOURCE_PRECOMPILED = 1;
const HAKO_MODULE_SOURCE_ERROR = 2;

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
  // biome-ignore lint/style/noNonNullAssertion: Will be initialized in setExports
  private exports: HakoExports = null!;
  private memory: MemoryManager;

  private hostFunctions: Map<number, HostCallbackFunction<VMValue>> = new Map();
  private moduleInitHandlers: Map<string, ModuleInitFunction> = new Map();
  private classConstructors: Map<number, ClassConstructorHandler> = new Map();
  private classFinalizers: Map<number, ClassFinalizerHandler> = new Map();

  /**
   * Counter for generating unique function IDs.
   * Starts at -32768 to avoid conflicts with any internal IDs.
   */
  private nextFunctionId = -32768;

  private moduleLoader: ModuleLoaderFunction | null = null;
  private moduleNormalizer: ModuleNormalizerFunction | null = null;
  private moduleResolver: ModuleResolverFunction | null = null;
  private interruptHandler: InterruptHandler | null = null;
  private profilerHandler: ProfilerEventHandler | null = null;

  private contextRegistry: Map<number, VMContext> = new Map();
  private runtimeRegistry: Map<number, HakoRuntime> = new Map();

  constructor(memory: MemoryManager) {
    this.memory = memory;
  }

  /**
   * Sets the WebAssembly exports object after module instantiation.
   * Must be called before using other methods.
   */
  setExports(exports: HakoExports): void {
    this.exports = exports;
  }

  /**
   * Returns the import object needed for WebAssembly module instantiation.
   *
   * This provides the callback functions that the WebAssembly module will call
   * to communicate with the host JavaScript environment.
   */
  getImports(): Record<string, unknown> {
    return {
      hako: {
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

        interrupt_handler: (
          rtPtr: number,
          ctxPtr: number,
          opaque: number
        ): number => {
          return this.handleInterrupt(rtPtr, ctxPtr, opaque) ? 1 : 0;
        },

        load_module: (
          rtPtr: number,
          ctxPtr: number,
          moduleNamePtr: number,
          _opaque: number,
          attributesPtr: number
        ): number => {
          return this.handleModuleLoad(
            rtPtr,
            ctxPtr,
            moduleNamePtr,
            attributesPtr
          );
        },

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
        module_init: (ctxPtr: number, modulePtr: number): number => {
          return this.handleModuleInit(ctxPtr, modulePtr);
        },
        class_constructor: (
          ctxPtr: number,
          newTargetPtr: number,
          argc: number,
          argvPtr: number,
          classId: number
        ): number => {
          return this.handleClassConstructor(
            ctxPtr,
            newTargetPtr,
            argc,
            argvPtr,
            classId
          );
        },

        class_finalizer: (
          rtPtr: number,
          opaque: number,
          classId: number
        ): void => {
          this.handleClassFinalizer(rtPtr, opaque, classId);
        },
      },
    };
  }

  /**
   * Registers a VMContext object with its corresponding pointer.
   *
   * This associates a JavaScript VMContext object with its WebAssembly pointer
   * to enable lookups in either direction.
   */
  registerContext(ctxPtr: JSContextPointer, ctx: VMContext): void {
    this.contextRegistry.set(ctxPtr, ctx);
  }

  /**
   * Unregisters a context from the registry.
   * Call this when a context is disposed to prevent memory leaks.
   */
  unregisterContext(ctxPtr: JSContextPointer): void {
    this.contextRegistry.delete(ctxPtr);
  }

  unregisterClassConstructor(classId: number): void {
    this.classConstructors.delete(classId);
  }

  unregisterClassFinalizer(classId: number): void {
    this.classFinalizers.delete(classId);
  }

  getContext(ctxPtr: JSContextPointer): VMContext | undefined {
    return this.contextRegistry.get(ctxPtr);
  }

  /**
   * Registers a HakoRuntime object with its corresponding pointer.
   *
   * This associates a JavaScript HakoRuntime object with its WebAssembly pointer
   * to enable lookups in either direction.
   */
  registerRuntime(rtPtr: JSRuntimePointer, runtime: HakoRuntime): void {
    this.runtimeRegistry.set(rtPtr, runtime);
  }

  /**
   * Unregisters a runtime from the registry.
   * Call this when a runtime is disposed to prevent memory leaks.
   */
  unregisterRuntime(rtPtr: JSRuntimePointer): void {
    this.runtimeRegistry.delete(rtPtr);
  }

  registerModuleInitHandler(
    moduleName: string,
    handler: ModuleInitFunction
  ): void {
    this.moduleInitHandlers.set(moduleName, handler);
  }

  unregisterModuleInitHandler(moduleName: string): void {
    this.moduleInitHandlers.delete(moduleName);
  }

  registerClassConstructor(
    classId: number,
    handler: ClassConstructorHandler
  ): void {
    this.classConstructors.set(classId, handler);
  }

  registerClassFinalizer(
    classId: number,
    handler: ClassFinalizerHandler
  ): void {
    this.classFinalizers.set(classId, handler);
  }

  getRuntime(rtPtr: JSRuntimePointer): HakoRuntime | undefined {
    return this.runtimeRegistry.get(rtPtr);
  }

  /**
   * Registers a host JavaScript function that can be called from PrimJS.
   */
  registerHostFunction(callback: HostCallbackFunction<VMValue>): number {
    const id = this.nextFunctionId++;
    this.hostFunctions.set(id, callback);
    return id;
  }

  unregisterHostFunction(id: number): void {
    this.hostFunctions.delete(id);
  }

  /**
   * Creates a new PrimJS function that calls a host JavaScript function.
   *
   * This creates a JavaScript function in the PrimJS environment that,
   * when called, will execute the provided host callback function.
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
   */
  setModuleLoader(loader: ModuleLoaderFunction | null): void {
    this.moduleLoader = loader;
  }

  /**
   * Sets the module normalizer function for ES modules support.
   *
   * The module normalizer is called to resolve relative module specifiers
   * into absolute module names.
   */
  setModuleNormalizer(normalizer: ModuleNormalizerFunction | null): void {
    this.moduleNormalizer = normalizer;
  }

  setModuleResolver(resolver: ModuleResolverFunction | null): void {
    this.moduleResolver = resolver;
  }

  /**
   * Sets the interrupt handler function for execution control.
   *
   * The interrupt handler is called periodically during PrimJS execution
   * and can terminate execution by returning true.
   */
  setInterruptHandler(handler: InterruptHandler | null): void {
    this.interruptHandler = handler;
  }

  /**
   * Sets up runtime callbacks for a specific runtime instance.
   *
   * This registers the runtime object for later lookup and enables
   * callback functionality for the runtime.
   */
  setRuntimeCallbacks(rtPtr: JSRuntimePointer, runtime: HakoRuntime): void {
    this.registerRuntime(rtPtr, runtime);
  }

  setProfilerHandler(handler: ProfilerEventHandler | null): void {
    this.profilerHandler = handler;
  }

  /**
   * Handles a call from PrimJS to a host JavaScript function.
   *
   * This is called by the WebAssembly module when a host function
   * registered with registerHostFunction is invoked from PrimJS.
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
      return this.exports.HAKO_GetUndefined();
    }

    const ctx = this.getContext(ctxPtr);
    if (!ctx) {
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
        const result = yield* awaited(callback.apply(thisHandle, argHandles));

        if (result) {
          if (result instanceof VMValue) {
            const duplicatedHandle = this.exports.HAKO_DupValuePointer(
              ctxPtr,
              result.getHandle()
            );
            result.dispose();
            return duplicatedHandle;
          }

          if (DisposableResult.is(result)) {
            if (result.error) {
              result.dispose();
              try {
                result.unwrap();
              } catch (e) {
                using errorHandle = ctx.newValue(e as Error);
                return this.exports.HAKO_Throw(ctxPtr, errorHandle.getHandle());
              }
              return this.exports.HAKO_GetUndefined();
            }

            const unwrapped = result.unwrap();
            result.dispose();

            const duplicatedHandle = this.exports.HAKO_DupValuePointer(
              ctxPtr,
              unwrapped.getHandle()
            );
            unwrapped.dispose();
            return duplicatedHandle;
          }

          return this.exports.HAKO_GetUndefined();
        }

        return this.exports.HAKO_GetUndefined();
      } catch (error) {
        try {
          using errorHandle = ctx.newValue(error as Error);
          return this.exports.HAKO_Throw(ctxPtr, errorHandle.getHandle());
        } catch (conversionError) {
          return this.exports.HAKO_GetUndefined();
        }
      }
    }) as number;
  }

  /**
   * Creates a HakoModuleSource struct for source code
   */
  private createModuleSourceString(
    ctxPtr: JSContextPointer,
    sourceCode: string
  ): number {
    // Allocate memory for the HakoModuleSource struct
    // struct layout: 4 bytes (enum) + 4 bytes (union pointer) = 8 bytes
    const structSize = 8;
    const structPtr = this.exports.HAKO_Malloc(ctxPtr, structSize);
    if (structPtr === 0) {
      return 0;
    }

    // Allocate and copy the source code string
    const sourcePtr = this.memory.allocateString(ctxPtr, sourceCode);
    if (sourcePtr === 0) {
      this.exports.HAKO_Free(ctxPtr, structPtr);
      return 0;
    }

    // Write the struct data
    const exports = this.exports;
    const view = new DataView(exports.memory.buffer);

    // Write type (enum value) at offset 0
    view.setUint32(structPtr, HAKO_MODULE_SOURCE_STRING, true);

    // Write union data (source_code pointer) at offset 4
    view.setUint32(structPtr + 4, sourcePtr, true);

    return structPtr;
  }

  /**
   * Creates a HakoModuleSource struct for precompiled module
   */
  private createModuleSourcePrecompiled(
    ctxPtr: JSContextPointer,
    moduleDefPtr: number
  ): number {
    // Allocate memory for the HakoModuleSource struct
    const structSize = 8;
    const structPtr = this.exports.HAKO_Malloc(ctxPtr, structSize);
    if (structPtr === 0) {
      return 0;
    }

    // Write the struct data
    const exports = this.exports;
    const view = new DataView(exports.memory.buffer);

    // Write type (enum value) at offset 0
    view.setUint32(structPtr, HAKO_MODULE_SOURCE_PRECOMPILED, true);

    // Write union data (module_def pointer) at offset 4
    view.setUint32(structPtr + 4, moduleDefPtr, true);

    return structPtr;
  }

  /**
   * Creates a HakoModuleSource struct for error case
   */
  private createModuleSourceError(ctxPtr: JSContextPointer): number {
    // Allocate memory for the HakoModuleSource struct
    const structSize = 8;
    const structPtr = this.exports.HAKO_Malloc(ctxPtr, structSize);
    if (structPtr === 0) {
      return 0;
    }

    // Write the struct data
    const exports = this.exports;
    const view = new DataView(exports.memory.buffer);

    // Write type (enum value) at offset 0
    view.setUint32(structPtr, HAKO_MODULE_SOURCE_ERROR, true);

    // Write union data (NULL pointer) at offset 4
    view.setUint32(structPtr + 4, 0, true);

    return structPtr;
  }

  /**
   * Handles a module load request from PrimJS.
   *
   * This is called by the WebAssembly module when PrimJS needs to load
   * a module during import or dynamic import operations.
   */
  handleModuleLoad(
    _rtPtr: JSRuntimePointer,
    ctxPtr: JSContextPointer,
    moduleNamePtr: number,
    attributesPtr: number
  ): number {
    return Scope.withScopeMaybeAsync(this, function* (awaited, _scope) {
      if (!this.moduleLoader) {
        return this.createModuleSourceError(ctxPtr);
      }

      const ctx = this.getContext(ctxPtr);
      if (!ctx) {
        return this.createModuleSourceError(ctxPtr);
      }
      const moduleName = this.memory.readString(moduleNamePtr);

      let attributes: Record<string, string> | undefined;
      if (attributesPtr !== 0) {
        using att = ctx.borrowValue(attributesPtr);
        using box = att.toNativeValue<Record<string, string>>();
        attributes = box.value;
      }

      const moduleResult = yield* awaited(
        this.moduleLoader(moduleName, attributes)
      );
      if (moduleResult === null) {
        return this.createModuleSourceError(ctxPtr);
      }
      switch (moduleResult.type) {
        case "source":
          return this.createModuleSourceString(ctxPtr, moduleResult.data);
        case "precompiled":
          return this.createModuleSourcePrecompiled(ctxPtr, moduleResult.data);
        case "error":
        default:
          return this.createModuleSourceError(ctxPtr);
      }
    }) as number;
  }

  handleModuleResolve(
    _rtPtr: JSRuntimePointer,
    _ctxPtr: JSContextPointer,
    moduleNamePtr: number,
    currentModulePtr: number,
    _opaque: JSVoid
  ): number {
    if (!this.moduleResolver) {
      return 0;
    }

    if (moduleNamePtr === 0) {
      return 0;
    }

    const moduleName = this.memory.readString(moduleNamePtr);
    let currentModuleName: string | undefined;
    if (currentModulePtr !== 0) {
      currentModuleName = this.memory.readString(currentModulePtr);
    }

    const resolvedPath = this.moduleResolver(moduleName, currentModuleName);
    if (!resolvedPath) {
      return 0;
    }

    return this.memory.allocateString(_ctxPtr, resolvedPath);
  }

  /**
   * Handles a module normalization request from PrimJS.
   *
   * This is called by the WebAssembly module when PrimJS needs to
   * resolve a relative module specifier against a base module.
   */
  handleModuleNormalize(
    _rtPtr: JSRuntimePointer,
    _ctxPtr: JSContextPointer,
    baseNamePtr: number,
    moduleNamePtr: number
  ): number {
    return Scope.withScopeMaybeAsync(this, function* (awaited, _scope) {
      if (!this.moduleNormalizer) {
        return moduleNamePtr;
      }

      const baseName = this.memory.readString(baseNamePtr);
      const moduleName = this.memory.readString(moduleNamePtr);

      const normalizedName = yield* awaited(
        this.moduleNormalizer(baseName, moduleName)
      );

      return this.memory.allocateString(_ctxPtr, normalizedName);
    }) as JSValuePointer;
  }

  /**
   * Handles an interrupt request from PrimJS.
   *
   * This is called periodically during PrimJS execution to check
   * if execution should be interrupted.
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
      const runtime = this.getRuntime(rtPtr);
      if (!runtime) {
        return true;
      }
      const ctx = this.getContext(ctxPtr);
      if (!ctx) {
        return true;
      }

      const shouldInterrupt = this.interruptHandler(runtime, ctx, opaque);
      return shouldInterrupt === true;
    } catch (error) {
      return false;
    }
  }

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
      this.profilerHandler.onFunctionStart(ctx, event, opaque);
    } catch (error) {
      // Silent fail for profiling
    }
  }

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
      this.profilerHandler.onFunctionEnd(ctx, event, opaque);
    } catch (error) {
      // Silent fail for profiling
    }
  }

  handleClassConstructor(
    ctxPtr: number,
    newTargetPtr: number,
    argc: number,
    argvPtr: number,
    classId: number
  ): number {
    const handler = this.classConstructors.get(classId);
    if (!handler) {
      return this.exports.HAKO_GetUndefined();
    }

    const ctx = this.getContext(ctxPtr);
    if (!ctx) {
      return this.exports.HAKO_GetUndefined();
    }

    return Scope.withScopeMaybeAsync(this, function* (awaited, scope) {
      const newTarget = scope.manage(ctx.borrowValue(newTargetPtr));

      const args: VMValue[] = [];
      for (let i = 0; i < argc; i++) {
        const argPtr = this.exports.HAKO_ArgvGetJSValueConstPointer(argvPtr, i);
        const arg = ctx.duplicateValue(argPtr);
        args.push(scope.manage(arg));
      }

      try {
        const result = yield* awaited(handler(ctx, newTarget, args, classId));

        if (result && result instanceof VMValue) {
          const duplicatedHandle = this.exports.HAKO_DupValuePointer(
            ctxPtr,
            result.getHandle()
          );
          result.dispose();
          return duplicatedHandle;
        }

        return this.exports.HAKO_GetUndefined();
      } catch (error) {
        try {
          using errorHandle = ctx.newValue(error as Error);
          return this.exports.HAKO_Throw(ctxPtr, errorHandle.getHandle());
        } catch (conversionError) {
          return this.exports.HAKO_GetUndefined();
        }
      }
    }) as number;
  }

  handleClassFinalizer(rtPtr: number, opaque: number, classId: number): void {
    const handler = this.classFinalizers.get(classId);
    if (!handler) {
      return;
    }

    const runtime = this.getRuntime(rtPtr);
    if (!runtime) {
      return;
    }

    try {
      const userData = opaque;
      handler(runtime, userData, classId);
    } catch (error) {
      // Silent fail for finalizers
    }
  }

  /**
   * Helper to get module name from module pointer
   */
  private getModuleName(ctx: VMContext, modulePtr: number): string | null {
    const namePtr = ctx.container.exports.HAKO_GetModuleName(
      ctx.pointer,
      modulePtr
    );
    if (namePtr === 0) {
      return null;
    }

    try {
      return ctx.container.memory.readString(namePtr);
    } finally {
      ctx.container.memory.freeCString(ctx.pointer, namePtr);
    }
  }

  /**
   * Handles a C module initialization request from PrimJS.
   *
   * This is called by the WebAssembly module when a C module needs
   * to be initialized.
   */
  handleModuleInit(ctxPtr: JSContextPointer, modulePtr: number): number {
    const ctx = this.getContext(ctxPtr);
    if (!ctx) {
      return -1;
    }

    // Get the module name to route to the right handler
    const moduleName = this.getModuleName(ctx, modulePtr);
    if (!moduleName) {
      return -1;
    }

    const handler = this.moduleInitHandlers.get(moduleName);
    if (!handler) {
      return -1;
    }

    try {
      // Create the initializer - the handler will set up the parent relationship
      const initializer = new CModuleInitializer(ctx, modulePtr);

      // The handler is responsible for calling _setParentBuilder and managing the hierarchy
      const result = handler(initializer);
      return typeof result === "number" ? result : 0;
    } catch (error) {
      return -1;
    }
  }
}
