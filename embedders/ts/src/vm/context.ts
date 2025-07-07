/**
 * This module provides the VMContext class, which represents a JavaScript
 * execution context within the PrimJS virtual machine. It serves as the
 * primary interface for evaluating code, creating values, and interacting
 * with the JavaScript environment inside the VM.
 */

import {
  type ContextEvalOptions,
  type CString,
  evalOptionsToFlags,
  type HostCallbackFunction,
  type JSContextPointer,
  type JSValuePointer,
  type PromiseExecutor,
  ValueLifecycle,
  type VMContextResult,
} from "../etc/types";
import { HakoDeferredPromise } from "../helpers/deferred-promise";
import { VMIterator } from "../helpers/iterator-helper";
import type { Container } from "../host/container";
import type { HakoRuntime } from "../host/runtime";
import {
  type DisposableFail,
  DisposableResult,
  type DisposableSuccess,
  Scope,
} from "../mem/lifetime";
import { VMValue } from "./value";
import { ValueFactory } from "./value-factory";
import type { SuccessOrFail } from "./vm-interface";

/**
 * Represents a JavaScript execution context within the PrimJS virtual machine.
 *
 * VMContext provides the environment in which JavaScript code executes,
 * including global objects, standard libraries, and memory constraints.
 * It offers methods for evaluating code, creating values, calling functions,
 * and managing resources within the virtual machine.
 *
 * @implements {Disposable} - Implements the Disposable interface for resource cleanup
 */
export class VMContext implements Disposable {
  /**
   * Reference to the service container providing access to core Hako services
   */
  public container: Container;

  /**
   * WebAssembly pointer to the underlying context
   * @private
   */
  private ctxPtr: JSContextPointer;

  /**
   * Flag indicating if this context has been released
   * @private
   */
  private isReleased = false;

  /**
   * Reference to the runtime this context belongs to
   * @private
   */
  private __runtime: HakoRuntime;

  /**
   * Factory for creating JavaScript values in this context
   * @private
   */
  private valueFactory: ValueFactory;

  /**
   * Cached reference to the Symbol constructor
   * @private
   */
  protected _Symbol: VMValue | undefined = undefined;

  /**
   * Cached reference to Symbol.iterator
   * @private
   */
  protected _SymbolIterator: VMValue | undefined = undefined;

  /**
   * Cached reference to Symbol.asyncIterator
   * @private
   */
  protected _SymbolAsyncIterator: VMValue | undefined = undefined;

  private opaqueDataPointer: CString | undefined = undefined;

  /**
   * Creates a new VMContext instance.
   *
   * @param container - The service container providing access to Hako services
   * @param runtime - The runtime this context belongs to
   * @param ctxPtr - WebAssembly pointer to the context
   */
  constructor(
    container: Container,
    runtime: HakoRuntime,
    ctxPtr: JSContextPointer
  ) {
    this.container = container;
    this.__runtime = runtime;
    this.ctxPtr = ctxPtr;
    this.valueFactory = new ValueFactory(this, container);
    // Register this context with the callback manager
    this.container.callbacks.registerContext(ctxPtr, this);
  }

  /**
   * Gets the WebAssembly pointer to this context.
   */
  get pointer(): JSContextPointer {
    return this.ctxPtr;
  }

  /**
   * Gets the runtime this context belongs to.
   *
   * @returns The parent runtime
   */
  get runtime(): HakoRuntime {
    return this.__runtime;
  }

  /**
   * Sets the maximum stack size for this context.
   *
   * This limits the depth of call stacks to prevent stack overflow attacks.
   *
   * @param size - The stack size in bytes
   */
  setMaxStackSize(size: number): void {
    this.container.exports.HAKO_ContextSetMaxStackSize(this.pointer, size);
  }

  /**
   * Sets the virtual stack size for this context.
   *
   * This is an advanced feature for fine-tuning JavaScript execution.
   *
   * @param size - The virtual stack size in bytes
   * @unstable The FFI interface is considered private and may change.
   */
  setVirtualStackSize(size: number): void {
    this.container.exports.HAKO_SetVirtualStackSize(this.pointer, size);
  }

  /**
   * Sets opaque data for the context.
   *
   * If opaque data is already set, the existing data is freed before storing the new string.
   * The provided string is allocated in memory and then registered with the context by invoking
   * the native {@link HAKO_SetContextData} function.
   *
   * @param opaque - The opaque data to set as a string.
   *
   * @remarks
   * You are responsible for freeing the opaque data when no longer needed by calling {@link freeOpaqueData} or releasing the context.
   */
  setOpaqueData(opaque: string): void {
    if (this.opaqueDataPointer) {
      this.freeOpaqueData();
    }
    this.opaqueDataPointer = this.container.memory.allocateString(
      this.ctxPtr,
      opaque
    );
    this.container.exports.HAKO_SetContextData(
      this.pointer,
      this.opaqueDataPointer
    );
  }

  /**
   * Retrieves the opaque data associated with the context.
   *
   * @returns A string containing the opaque data if one is set; otherwise, returns `undefined`.
   *
   * @remarks
   * The string is obtained by reading the memory pointed to by the opaque data pointer.
   * If no opaque data is set, the method returns `undefined`.
   */
  getOpaqueData(): string | undefined {
    if (!this.opaqueDataPointer) {
      return undefined;
    }
    return this.container.memory.readString(this.opaqueDataPointer);
  }

  /**
   * Frees the opaque data associated with the context.
   *
   * If opaque data is present, this method releases the allocated memory and resets the
   * opaque data pointer to `undefined`. It is safe to call this method even if no opaque data
   * has been set.
   */
  freeOpaqueData(): void {
    if (this.opaqueDataPointer) {
      this.container.memory.freeMemory(this.ctxPtr, this.opaqueDataPointer);
      this.opaqueDataPointer = undefined;
      this.container.exports.HAKO_SetContextData(this.pointer, 0);
    }
  }

  /**
   * Evaluates JavaScript code in this context.
   *
   * This is the primary method for executing JavaScript code within the VM.
   * It supports both global code and ES modules, with various configuration options.
   *
   * @param code - JavaScript code to evaluate
   * @param options - Evaluation options:
   *                 - type: "global" or "module" (default: "global")
   *                 - fileName: Name for error messages (default: "eval")
   *                 - strict: Whether to enforce strict mode
   *                 - detectModule: Whether to auto-detect module code
   * @returns Result containing either the evaluation result or an error
   */
  evalCode(
    code: string,
    options: ContextEvalOptions = {}
  ): VMContextResult<VMValue> {
    if (code.length === 0) {
      return DisposableResult.success(this.undefined());
    }
    const codemem = this.container.memory.writeNullTerminatedString(
      this.ctxPtr,
      code
    );
    let fileName = options.fileName || "file://eval";
    if (!fileName.startsWith("file://")) {
      fileName = `file://${fileName}`;
    }

    const filenamePtr = this.container.memory.allocateString(
      this.ctxPtr,
      fileName
    );
    const flags = evalOptionsToFlags(options);
    const detectModule = options.detectModule ?? false;

    try {
      const resultPtr = this.container.exports.HAKO_Eval(
        this.ctxPtr,
        codemem.pointer,
        codemem.length,
        filenamePtr,
        detectModule ? 1 : 0,
        flags
      );

      // Check for exception
      const exceptionPtr = this.container.error.getLastErrorPointer(
        this.ctxPtr,
        resultPtr
      );

      if (exceptionPtr !== 0) {
        this.container.memory.freeValuePointer(this.ctxPtr, resultPtr);
        return DisposableResult.fail(
          new VMValue(this, exceptionPtr, ValueLifecycle.Owned),
          (error) => this.unwrapResult(error)
        );
      }

      return DisposableResult.success(
        new VMValue(this, resultPtr, ValueLifecycle.Owned)
      );
    } finally {
      this.container.memory.freeMemory(this.ctxPtr, codemem.pointer);
      this.container.memory.freeMemory(this.ctxPtr, filenamePtr);
    }
  }

  /**
   * Compiles JavaScript code to portable bytecode.
   *
   * This method compiles JavaScript source code into bytecode that can be
   * cached, transmitted, or evaluated later. It automatically detects ES6
   * modules vs regular scripts and compiles accordingly.
   *
   * @param code - JavaScript source code to compile
   * @param options - Compilation options:
   *                 - type: "global" or "module" (default: auto-detect)
   *                 - fileName: Name for error messages (default: "eval")
   *                 - strict: Whether to enforce strict mode
   *                 - detectModule: Whether to auto-detect module code
   * @returns Result containing either the bytecode buffer or an error
   */
  compileToByteCode(
    code: string,
    options: ContextEvalOptions = {}
  ): VMContextResult<Uint8Array> {
    if (code.length === 0) {
      return DisposableResult.success(new Uint8Array(0));
    }

    const codemem = this.container.memory.writeNullTerminatedString(
      this.ctxPtr,
      code
    );
    let fileName = options.fileName || "eval";
    if (!fileName.startsWith("file://")) {
      fileName = `file://${fileName}`;
    }

    const filemem = this.container.memory.writeNullTerminatedString(
      this.ctxPtr,
      fileName
    );
    const flags = evalOptionsToFlags(options);
    const detectModule = options.detectModule ?? true; // Default to true for compilation
    const bytecodeLength = this.container.memory.allocatePointerArray(
      this.ctxPtr,
      1
    );

    try {
      const bytecodePtr = this.container.exports.HAKO_CompileToByteCode(
        this.ctxPtr,
        codemem.pointer,
        codemem.length,
        filemem.pointer,
        detectModule ? 1 : 0,
        flags,
        bytecodeLength
      );

      // Check if compilation failed (returns null)
      if (bytecodePtr === 0) {
        // Get the last error from the context
        const exceptionPtr = this.container.error.getLastErrorPointer(
          this.ctxPtr
        );
        if (exceptionPtr !== 0) {
          return DisposableResult.fail(
            new VMValue(this, exceptionPtr, ValueLifecycle.Owned),
            (error) => this.unwrapResult(error)
          );
        }
        // If no exception but still failed, create a generic error
        return DisposableResult.fail(
          this.newError(new Error("Compilation failed")),
          (error) => this.unwrapResult(error)
        );
      }

      const length = this.container.memory.readPointer(bytecodeLength);

      // Copy the bytecode from WASM memory to a Uint8Array
      const bytecode = this.container.memory.copy(bytecodePtr, length);

      // Free the bytecode buffer allocated by the C function
      this.container.memory.freeMemory(this.ctxPtr, bytecodePtr);

      return DisposableResult.success(bytecode);
    } finally {
      this.container.memory.freeMemory(this.ctxPtr, codemem.pointer);
      this.container.memory.freeMemory(this.ctxPtr, filemem.pointer);
      this.container.memory.freeMemory(this.ctxPtr, bytecodeLength);
    }
  }

  /**
   * Evaluates precompiled JavaScript bytecode.
   *
   * @param bytecode - Bytecode buffer from compileToByteCode
   * @param options - loadOnly: Only load bytecode without executing
   * @returns Evaluation result or error
   */
  evalByteCode(
    bytecode: Uint8Array,
    options: { loadOnly?: boolean } = {}
  ): VMContextResult<VMValue> {
    if (bytecode.length === 0) {
      return DisposableResult.success(this.undefined());
    }

    // Allocate memory for the bytecode in WASM
    const bytecodePtr = this.container.memory.writeBytes(this.ctxPtr, bytecode);

    try {
      const resultPtr = this.container.exports.HAKO_EvalByteCode(
        this.ctxPtr,
        bytecodePtr,
        bytecode.byteLength,
        options.loadOnly ? 1 : 0
      );

      // Check for exception
      const exceptionPtr = this.container.error.getLastErrorPointer(
        this.ctxPtr,
        resultPtr
      );

      if (exceptionPtr !== 0) {
        this.container.memory.freeValuePointer(this.ctxPtr, resultPtr);
        return DisposableResult.fail(
          new VMValue(this, exceptionPtr, ValueLifecycle.Owned),
          (error) => this.unwrapResult(error)
        );
      }

      return DisposableResult.success(
        new VMValue(this, resultPtr, ValueLifecycle.Owned)
      );
    } finally {
      this.container.memory.freeMemory(this.ctxPtr, bytecodePtr);
    }
  }

  /**
   * Unwraps a SuccessOrFail result, throwing an error if it's a failure.
   *
   * This converts VM errors to native JavaScript errors that can be caught
   * by standard try/catch blocks in the host environment.
   *
   * @template T - The success value type
   * @param result - The result to unwrap
   * @returns The success value
   * @throws Converted JavaScript error if the result is a failure
   */
  unwrapResult<T>(result: SuccessOrFail<T, VMValue>): T {
    if (result.error) {
      const context: VMContext =
        "context" in result.error
          ? (result.error as unknown as { context: VMContext }).context
          : this;

      const error = this.container.error.getExceptionDetails(
        context.ctxPtr,
        result.error.getHandle()
      );
      result.error.dispose();
      throw error;
    }
    return result.value;
  }

  /**
   * Calls a function value in this context.
   *
   * This invokes a JavaScript function with the specified this value and arguments.
   *
   * @param func - The function value to call
   * @param thisArg - The 'this' value for the function call (null uses undefined)
   * @param args - Arguments to pass to the function
   * @returns Result containing either the function's return value or an error
   */
  callFunction(
    func: VMValue,
    thisArg: VMValue | null = null,
    ...args: VMValue[]
  ): VMContextResult<VMValue> {
    return Scope.withScope((scope) => {
      if (!thisArg) {
        thisArg = scope.manage(this.undefined());
      }
      const thisPtr = thisArg.getHandle();

      let argvPtr: number = 0;

      if (args.length > 0) {
        argvPtr = this.container.memory.allocatePointerArray(
          this.ctxPtr,
          args.length
        );
        scope.add(() => this.container.memory.freeMemory(this.ctxPtr, argvPtr));

        for (let i = 0; i < args.length; i++) {
          this.container.memory.writePointerToArray(
            argvPtr,
            i,
            args[i].getHandle()
          );
        }
      }

      const resultPtr = this.container.exports.HAKO_Call(
        this.pointer,
        func.getHandle(),
        thisPtr,
        args.length,
        argvPtr
      );

      const exceptionPtr = this.container.error.getLastErrorPointer(
        this.pointer,
        resultPtr
      );

      if (exceptionPtr !== 0) {
        this.container.memory.freeValuePointer(this.pointer, resultPtr);
        return DisposableResult.fail(
          new VMValue(this, exceptionPtr, ValueLifecycle.Owned),
          (error) => this.unwrapResult(error)
        );
      }

      return DisposableResult.success(
        new VMValue(this, resultPtr, ValueLifecycle.Owned)
      );
    });
  }

  /**
   * Converts a Promise-like value in the VM to a native Promise.
   *
   * This bridges the gap between Promises in the VM and Promises in the
   * host environment. It calls Promise.resolve on the value inside the VM,
   * then hooks up native Promise handlers.
   *
   * @param promiseLikeHandle - VM value that should be a Promise or thenable
   * @returns A native Promise that resolves/rejects with the VM promise result
   * @remarks You may need to call runtime.executePendingJobs() to ensure the promise is resolved
   */
  resolvePromise(
    promiseLikeHandle: VMValue
  ): Promise<VMContextResult<VMValue>> {
    if (!promiseLikeHandle.isPromise()) {
      throw new TypeError(
        `Expected a Promise-like value, received ${promiseLikeHandle.type}`
      );
    }

    using vmResolveResult = Scope.withScope((scope) => {
      using global = this.getGlobalObject();
      const vmPromise = scope.manage(global.getProperty("Promise"));

      const vmPromiseResolve = scope.manage(vmPromise?.getProperty("resolve"));
      return this.callFunction(vmPromiseResolve, vmPromise, promiseLikeHandle);
    });

    if (vmResolveResult.error) {
      return Promise.resolve(vmResolveResult);
    }

    const resolvedPromise = vmResolveResult.value;

    // Check if the promise is already settled
    const state = resolvedPromise.getPromiseState();

    if (state === "fulfilled") {
      const result = resolvedPromise.getPromiseResult();
      if (result) {
        return Promise.resolve(this.success(result));
      }
      // This shouldn't happen for fulfilled promises, but handle gracefully
      return Promise.resolve(this.success(this.newValue(undefined)));
    }

    if (state === "rejected") {
      const error = resolvedPromise.getPromiseResult();
      if (error) {
        return Promise.resolve(this.fail(error));
      }
      // This shouldn't happen for rejected promises, but handle gracefully
      return Promise.resolve(this.fail(this.newValue(undefined)));
    }

    // Promise is pending, set up async handlers
    return new Promise<VMContextResult<VMValue>>((resolve) => {
      Scope.withScope((scope) => {
        const resolveHandle = scope.manage(
          this.newFunction("resolve", (value) => {
            resolve(this.success(value?.dup()));
          })
        );

        const rejectHandle = scope.manage(
          this.newFunction("reject", (error) => {
            resolve(this.fail(error?.dup()));
          })
        );

        const promiseHandle = scope.manage(resolvedPromise);
       
        const promiseThenHandle = scope.manage(
          promiseHandle.getProperty("then")
        );
        this.callFunction(
          promiseThenHandle,
          promiseHandle,
          resolveHandle,
          rejectHandle
        )
          .unwrap()
          .dispose();
      });
    });
  }

  /**
   * Gets the last error from the context, or checks if a value is an error.
   *
   * @param maybe_exception - Optional value or pointer to check for error status
   * @returns The error object if an error occurred, undefined otherwise
   */
  getLastError(maybe_exception?: VMValue | JSValuePointer) {
    let pointer = 0;
    if (maybe_exception === undefined) {
      pointer = this.container.error.getLastErrorPointer(this.ctxPtr);
    } else {
      pointer =
        maybe_exception instanceof VMValue
          ? maybe_exception.getHandle()
          : maybe_exception;
    }
    if (pointer === 0) {
      return undefined;
    }
    return Scope.withScope((scope) => {
      const isError = this.container.exports.HAKO_IsError(this.ctxPtr, pointer);
      const lastError = isError
        ? pointer
        : this.container.error.getLastErrorPointer(
            this.ctxPtr,
            maybe_exception instanceof VMValue
              ? maybe_exception.getHandle()
              : maybe_exception
          );
      if (lastError === 0) {
        return undefined;
      }
      scope.add(() =>
        this.container.memory.freeValuePointer(this.ctxPtr, lastError)
      );
      return this.container.error.getExceptionDetails(this.ctxPtr, lastError);
    });
  }

  /**
   * Gets the module namespace object after evaluating a module.
   *
   * This extracts the exports object from an ES module.
   *
   * @param moduleValue - Module function object from evalCode
   * @returns Module namespace object containing all exports
   * @throws If the value is not a module or another error occurs
   */
  getModuleNamespace(moduleValue: VMValue): VMValue | undefined {
    const resultPtr = this.container.exports.HAKO_GetModuleNamespace(
      this.ctxPtr,
      moduleValue.getHandle()
    );

    // Check for exception
    const exceptionPtr = this.container.error.getLastErrorPointer(
      this.ctxPtr,
      resultPtr
    );
    if (exceptionPtr !== 0) {
      const error = this.container.error.getExceptionDetails(
        this.ctxPtr,
        exceptionPtr
      );
      this.container.memory.freeValuePointer(this.ctxPtr, resultPtr);
      this.container.memory.freeValuePointer(this.ctxPtr, exceptionPtr);
      throw error;
    }

    return new VMValue(this, resultPtr, ValueLifecycle.Owned);
  }

  /**
   * Gets the global object for this context.
   *
   * @returns The global object (like 'window' or 'global')
   */
  getGlobalObject(): VMValue {
    return this.valueFactory.getGlobalObject();
  }

  /**
   * Creates a new Error object with the given error details.
   *
   * @param error - JavaScript Error object to convert to a VM error
   * @returns The VM error object
   */
  newError(error: Error): VMValue {
    return this.valueFactory.fromNativeValue(error);
  }

  /**
   * Throws an error in the context.
   *
   * This creates and throws an exception in the VM environment.
   *
   * @param error - Error object or message to throw
   * @returns The exception object
   */
  throwError(error: VMValue | string): VMValue {
    if (typeof error === "string") {
      using errorObj = this.newError(new Error(error));
      return this.throwError(errorObj);
    }

    const exceptionPtr = this.container.exports.HAKO_Throw(
      this.ctxPtr,
      error.getHandle()
    );
    return new VMValue(this, exceptionPtr, ValueLifecycle.Owned);
  }

  /**
   * Gets an iterator for a VM value that implements the iterable protocol.
   *
   * This creates a host iterator that proxies to the guest iterator,
   * allowing iteration over collections in the VM.
   *
   * @param iterableHandle - VM value implementing the iterable protocol
   * @returns Result containing an iterator or an error
   *
   * @example
   * ```typescript
   * for (using entriesHandle of context.getIterator(mapHandle).unwrap()) {
   *   using keyHandle = context.getProp(entriesHandle, 0)
   *   using valueHandle = context.getProp(entriesHandle, 1)
   *   console.log(context.dump(keyHandle), '->', context.dump(valueHandle))
   * }
   * ```
   */
  getIterator(iterableHandle: VMValue): VMContextResult<VMIterator> {
    if (!this._SymbolIterator) {
      this._SymbolIterator = this.getWellKnownSymbol("iterator");
    }
    const SymbolIterator = this._SymbolIterator;
    return Scope.withScope((scope) => {
      const methodHandle = scope.manage(
        iterableHandle.getProperty(SymbolIterator)
      );
      const iteratorCallResult = this.callFunction(
        methodHandle,
        iterableHandle
      );
      if (iteratorCallResult.error) {
        return iteratorCallResult;
      }
      return this.success(new VMIterator(iteratorCallResult.value, this));
    });
  }

  /**
   * Gets a well-known symbol from the global Symbol object.
   *
   * Examples include Symbol.iterator, Symbol.asyncIterator, etc.
   *
   * @param name - Name of the well-known symbol
   * @returns The symbol value
   */
  getWellKnownSymbol(name: string): VMValue {
    if (this._Symbol) {
      return this._Symbol.getProperty(name);
    }
    using globalObject = this.getGlobalObject();
    this._Symbol = globalObject.getProperty("Symbol");
    return this._Symbol.getProperty(name);
  }

  /**
   * Creates a new empty object.
   *
   * @returns A new object value
   */
  newObject(): VMValue {
    const ptr = this.container.exports.HAKO_NewObject(this.ctxPtr);
    return new VMValue(this, ptr, ValueLifecycle.Owned);
  }

  /**
   * Creates a new object with the specified prototype.
   *
   * @param proto - Prototype object
   * @returns A new object with the specified prototype
   */
  newObjectWithPrototype(proto: VMValue): VMValue {
    const ptr = this.container.exports.HAKO_NewObjectProto(
      this.ctxPtr,
      proto.getHandle()
    );
    return new VMValue(this, ptr, ValueLifecycle.Owned);
  }

  /**
   * Creates a new empty array.
   *
   * @returns A new array value
   */
  newArray(): VMValue {
    return this.valueFactory.fromNativeValue([]);
  }

  /**
   * Creates a new ArrayBuffer with the specified data.
   *
   * @param data - The binary data to store in the ArrayBuffer
   * @returns A new ArrayBuffer value
   */
  newArrayBuffer(data: Uint8Array): VMValue {
    return this.valueFactory.fromNativeValue(data);
  }

  /**
   * Creates a new number value.
   *
   * @param value - The number value
   * @returns A new number value
   */
  newNumber(value: number): VMValue {
    return this.valueFactory.fromNativeValue(value);
  }

  /**
   * Creates a new string value.
   *
   * @param value - The string value
   * @returns A new string value
   */
  newString(value: string): VMValue {
    return this.valueFactory.fromNativeValue(value);
  }

  /**
   * Creates a new symbol value.
   *
   * @param description - Symbol description or an existing symbol
   * @param isGlobal - Whether to create a global symbol (using Symbol.for)
   * @returns A new symbol value
   */
  newSymbol(description: string | symbol, isGlobal = false): VMValue {
    const key =
      (typeof description === "symbol"
        ? description.description
        : description) ?? "";
    return this.valueFactory.fromNativeValue(
      isGlobal ? Symbol.for(key) : Symbol(key),
      {
        isGlobal: isGlobal,
      }
    );
  }

  dump(value: VMValue): object {
    const cstring = this.container.exports.HAKO_Dump(
      this.pointer,
      value.getHandle()
    );
    const result = this.container.memory.readString(cstring);
    this.container.memory.freeCString(this.pointer, cstring);
    return JSON.parse(result);
  }

  /**
   * Creates a new function that calls a host function.
   *
   * This bridges between host JavaScript functions and the VM environment.
   *
   * @param name - Function name for debugging and error messages
   * @param callback - Host function to call when the VM function is invoked
   * @returns A new function value
   */
  newFunction(name: string, callback: HostCallbackFunction<VMValue>): VMValue {
    return this.valueFactory.fromNativeValue(callback, { name: name });
  }

  /**
   * Creates a new Promise in the VM.
   *
   * @overload
   * @returns A deferred promise with resolve/reject methods
   */
  newPromise(): HakoDeferredPromise;

  /**
   * Creates a new Promise in the VM that follows a host Promise.
   *
   * @overload
   * @param promise - Host Promise to connect to the VM Promise
   * @returns A deferred promise that resolves/rejects when the host Promise does
   */
  newPromise(promise: Promise<VMValue>): HakoDeferredPromise;

  /**
   * Creates a new Promise in the VM with an executor function.
   *
   * @overload
   * @param executor - Standard Promise executor function
   * @returns A deferred promise controlled by the executor
   */
  newPromise(
    executor: PromiseExecutor<VMValue, Error | VMValue>
  ): HakoDeferredPromise;

  /**
   * Implementation of the Promise creation methods.
   *
   * @param value - Optional executor or Promise
   * @returns A deferred promise
   */
  newPromise(
    value?: PromiseExecutor<VMValue, Error | VMValue> | Promise<VMValue>
  ): HakoDeferredPromise {
    // Use a scoped block to manage temporary allocations
    const deferredPromise = Scope.withScope((scope) => {
      // Allocate memory for the resolve/reject pointers
      const resolveFuncsPtr = this.container.memory.allocatePointerArray(
        this.ctxPtr,
        2
      );
      scope.add(() =>
        this.container.memory.freeMemory(this.ctxPtr, resolveFuncsPtr)
      );

      // Create the promise capability by calling the native function
      const promisePtr = this.container.exports.HAKO_NewPromiseCapability(
        this.ctxPtr,
        resolveFuncsPtr
      );

      // Read the resolve/reject pointers using a DataView
      const view = new DataView(this.container.exports.memory.buffer);
      const resolvePtr = view.getUint32(resolveFuncsPtr, true);
      const rejectPtr = view.getUint32(resolveFuncsPtr + 4, true);

      // Wrap the pointers in JSValue objects
      const promise = new VMValue(this, promisePtr, ValueLifecycle.Owned);
      const resolveFunc = new VMValue(this, resolvePtr, ValueLifecycle.Owned);
      const rejectFunc = new VMValue(this, rejectPtr, ValueLifecycle.Owned);

      return new HakoDeferredPromise({
        context: this,
        promiseHandle: promise,
        resolveHandle: resolveFunc,
        rejectHandle: rejectFunc,
      });
    });

    // If an executor function is provided, wrap it into a native Promise
    if (value && typeof value === "function") {
      value = new Promise(value);
    }

    // If a native promise is provided, chain it to the deferred promise
    if (value) {
      Promise.resolve(value).then(deferredPromise.resolve, (error) =>
        error instanceof VMValue
          ? deferredPromise.reject(error)
          : deferredPromise.reject(this.newError(error))
      );
    }
    return deferredPromise;
  }

  /**
   * Gets the undefined value.
   *
   * @returns The undefined value
   */
  undefined(): VMValue {
    return this.valueFactory.fromNativeValue(undefined);
  }

  /**
   * Gets the null value.
   *
   * @returns The null value
   */
  null(): VMValue {
    return this.valueFactory.fromNativeValue(null);
  }

  /**
   * Gets the true value.
   *
   * @returns The true value
   */
  true(): VMValue {
    return this.valueFactory.fromNativeValue(true);
  }

  /**
   * Gets the false value.
   *
   * @returns The false value
   */
  false(): VMValue {
    return this.valueFactory.fromNativeValue(false);
  }

  /**
   * Creates a borrowed reference to a value from its pointer.
   *
   * A borrowed reference doesn't own the underlying value and won't
   * free it when disposed.
   *
   * @param ptr - The value pointer
   * @returns A borrowed VMValue
   */
  borrowValue(ptr: JSValuePointer): VMValue {
    return new VMValue(this, ptr, ValueLifecycle.Borrowed);
  }

  /**
   * Creates a duplicated (owned) reference to a value from its pointer.
   *
   * An owned reference will free the underlying value when disposed.
   *
   * @param ptr - The value pointer
   * @returns An owned VMValue
   */
  duplicateValue(ptr: JSValuePointer): VMValue {
    const duped = this.container.exports.HAKO_DupValuePointer(this.ctxPtr, ptr);
    // Create a JSValue that owns the pointer
    return new VMValue(this, duped, ValueLifecycle.Owned);
  }

  /**
   * Converts a JavaScript value to a VM value.
   *
   * This is the general-purpose conversion method for any JavaScript value.
   *
   * @param value - The JavaScript value to convert
   * @param options - Optional conversion options
   * @returns The VM value
   */
  newValue(value: unknown, options?: Record<string, unknown>): VMValue {
    return this.valueFactory.fromNativeValue(value, options);
  }

  /**
   * Encodes a VM value to binary JSON format.
   *
   * This is a more efficient serialization format than standard JSON.
   *
   * @param value - The VM value to encode
   * @returns Binary JSON data as a Uint8Array
   * @throws If encoding fails
   */
  bjsonEncode(value: VMValue): Uint8Array {
    const resultPtr = this.container.exports.HAKO_bjson_encode(
      this.ctxPtr,
      value.getHandle()
    );

    // Check for exception
    const exceptionPtr = this.container.error.getLastErrorPointer(
      this.ctxPtr,
      resultPtr
    );
    if (exceptionPtr !== 0) {
      const error = this.container.error.getExceptionDetails(
        this.ctxPtr,
        exceptionPtr
      );
      this.container.memory.freeValuePointer(this.ctxPtr, resultPtr);
      this.container.memory.freeValuePointer(this.ctxPtr, exceptionPtr);
      throw error;
    }

    using result = new VMValue(this, resultPtr, ValueLifecycle.Owned);

    return new Uint8Array(result.copyArrayBuffer());
  }

  /**
   * Decodes a binary JSON buffer to a VM value.
   *
   * @param data - The binary JSON data to decode
   * @returns The decoded VM value
   * @throws If decoding fails
   */
  bjsonDecode(data: Uint8Array): VMValue | null {
    using arrayBuffer = this.newArrayBuffer(data);

    const resultPtr = this.container.exports.HAKO_bjson_decode(
      this.ctxPtr,
      arrayBuffer.getHandle()
    );

    // Check for exception
    const exceptionPtr = this.container.error.getLastErrorPointer(
      this.ctxPtr,
      resultPtr
    );
    if (exceptionPtr !== 0) {
      const error = this.container.error.getExceptionDetails(
        this.ctxPtr,
        exceptionPtr
      );
      this.container.memory.freeValuePointer(this.ctxPtr, resultPtr);
      this.container.memory.freeValuePointer(this.ctxPtr, exceptionPtr);
      throw error;
    }

    return new VMValue(this, resultPtr, ValueLifecycle.Owned);
  }

  /**
   * Releases all resources associated with this context.
   *
   * This frees the underlying WebAssembly context and all cached values.
   */
  release(): void {
    if (!this.isReleased) {
      this.valueFactory.dispose();
      this._Symbol?.dispose();
      this._SymbolAsyncIterator?.dispose();
      this._SymbolIterator?.dispose();
      // Unregister from the callback manager
      this.container.callbacks.unregisterContext(this.ctxPtr);
      // Free the context
      this.freeOpaqueData();
      this.container.exports.HAKO_FreeContext(this.ctxPtr);
      this.runtime.dropContext(this);
      this.isReleased = true;
    }
  }

  /**
   * Implements the Symbol.dispose method for the Disposable interface.
   *
   * This allows the context to be used with the using statement
   * in environments that support the Disposable pattern.
   */
  [Symbol.dispose](): void {
    this.release();
  }

  /**
   * Helper method to create a success result.
   *
   * @template S - The success value type
   * @param value - The success value
   * @returns A disposable success result
   * @protected
   */
  protected success<S>(value: S): DisposableSuccess<S> {
    return DisposableResult.success(value);
  }

  /**
   * Helper method to create a failure result.
   *
   * @param error - The error value
   * @returns A disposable failure result
   * @protected
   */
  protected fail(error: VMValue): DisposableFail<VMValue> {
    return DisposableResult.fail(error, (error) => this.unwrapResult(error));
  }
}
