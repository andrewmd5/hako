import type { HakoExports } from "@hako/etc/ffi";
import { HakoError, PrimJSUseAfterFree } from "@hako/etc/errors";
import {
  type JSValuePointer,
  ValueLifecycle,
  type PropertyDescriptor,
  PropertyEnumFlags,
  EqualOp,
  type PromiseState,
  IsEqualOp,
  LEPUS_BOOLToBoolean,
  type JSType,
  type OwnedHeapChar,
  type TypedArrayType,
} from "@hako/etc/types";
import type { VMContext } from "@hako/vm/context";
import { type NativeBox, Scope } from "@hako/mem/lifetime";

/**
 * Represents a JavaScript value within the PrimJS virtual machine.
 *
 * VMValue provides a wrapper around JavaScript values in the WebAssembly VM,
 * allowing safe operations on these values from the host environment.
 * It handles resource management, type conversion, property access, and equality
 * comparisons while maintaining proper memory safety.
 *
 * @implements {Disposable} - Implements the Disposable interface for resource cleanup
 */
export class VMValue implements Disposable {
  /**
   * The VM context this value belongs to
   * @private
   */
  private context: VMContext;

  /**
   * WebAssembly pointer to the underlying JavaScript value
   * @private
   */
  private handle: JSValuePointer;

  /**
   * Lifecycle mode of this value (owned, borrowed, or temporary)
   * @private
   */
  private lifecycle: ValueLifecycle;

  /**
   * Creates a new VMValue instance.
   *
   * @param context - The VM context this value belongs to
   * @param handle - WebAssembly pointer to the JavaScript value
   * @param lifecycle - Lifecycle mode of this value, defaults to Owned
   */
  constructor(
    context: VMContext,
    handle: JSValuePointer,
    lifecycle: ValueLifecycle = ValueLifecycle.Owned
  ) {
    this.context = context;
    this.handle = handle;
    this.lifecycle = lifecycle;
  }

  /**
   * Creates a new VMValue from an existing handle.
   *
   * Factory method to create VMValue instances with a specific lifecycle mode.
   *
   * @param ctx - The VM context
   * @param handle - WebAssembly pointer to the JavaScript value
   * @param lifecycle - Lifecycle mode of the value
   * @returns A new VMValue instance
   */
  static fromHandle(
    ctx: VMContext,
    handle: JSValuePointer,
    lifecycle: ValueLifecycle
  ): VMValue {
    return new VMValue(ctx, handle, lifecycle);
  }

  /**
   * Gets the internal WebAssembly pointer to the JavaScript value.
   *
   * @returns The JavaScript value pointer
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  getHandle(): JSValuePointer {
    this.assertAlive();
    return this.handle;
  }

  /**
   * Checks if this value is still alive (not disposed).
   *
   * @returns True if the value is still valid, false if it has been disposed
   */
  get alive(): boolean {
    return this.handle !== 0;
  }

  /**
   * Gets the WebAssembly pointer to the context this value belongs to.
   *
   * @returns The context pointer
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  getContextPointer(): number {
    this.assertAlive();
    return this.context.pointer;
  }

  /**
   * Consumes this value with a function and automatically disposes it afterward.
   *
   * This pattern ensures proper resource cleanup even if the consumer function throws.
   *
   * @template TReturn - The return type of the consumer function
   * @param consumer - Function that uses this value
   * @returns The result of the consumer function
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  consume<TReturn>(consumer: (value: VMValue) => TReturn): TReturn {
    this.assertAlive();
    try {
      return consumer(this);
    } finally {
      this.dispose();
    }
  }

  /**
   * Creates a duplicate of this value.
   *
   * The duplicate is a separate value with its own lifecycle, referencing
   * the same JavaScript value in the VM.
   *
   * @returns A new owned VMValue that is a duplicate of this one
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  dup(): VMValue {
    this.assertAlive();

    const newPtr = this.context.container.memory.dupValuePointer(
      this.context.pointer,
      this.handle
    );
    return new VMValue(this.context, newPtr, ValueLifecycle.Owned);
  }

  /**
   * Creates a borrowed reference to this value.
   *
   * A borrowed reference shares the same handle but won't dispose it when
   * the borrowed reference itself is disposed.
   *
   * @returns A borrowed VMValue referencing the same JavaScript value
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  borrow(): VMValue {
    this.assertAlive();
    return new VMValue(this.context, this.handle, ValueLifecycle.Borrowed);
  }

  /**
   * Determines the JavaScript type of this value.
   *
   * @private
   * @returns The JavaScript type as a string
   */
  private getValueType(): JSType {
    const typePtr: OwnedHeapChar = this.context.container.exports.HAKO_Typeof(
      this.context.pointer,
      this.handle
    );
    try {
      if (typePtr === 0) {
        return "unknown";
      }
      const typeStr = this.context.container.memory.readString(typePtr);
      return typeStr as JSType;
    } finally {
      this.context.container.memory.freeMemory(this.context.pointer, typePtr);
    }
  }

  /**
   * Gets the JavaScript type of this value.
   *
   * @returns The JavaScript type as a string (e.g., "undefined", "number", "object")
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  get type(): JSType {
    this.assertAlive();
    return this.getValueType();
  }

  /**
   * Checks if this value is undefined.
   *
   * @returns True if the value is undefined
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isUndefined(): boolean {
    this.assertAlive();
    return this.context.container.utils.isEqual(
      this.context.pointer,
      this.handle,
      this.context.container.exports.HAKO_GetUndefined(),
      EqualOp.StrictEquals
    );
  }

  /**
   * Checks if this value is an Error object.
   *
   * @returns True if the value is an Error
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isError(): boolean {
    this.assertAlive();
    return (
      this.context.container.exports.HAKO_IsError(
        this.context.pointer,
        this.handle
      ) !== 0
    );
  }

  /**
   * Checks if this value is an exception (represents an error state).
   *
   * @returns True if the value is an exception
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isException(): boolean {
    this.assertAlive();
    return this.context.container.exports.HAKO_IsException(this.handle) !== 0;
  }

  /**
   * Checks if this value is null.
   *
   * @returns True if the value is null
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isNull(): boolean {
    this.assertAlive();
    // we need to free the null pointer after checking equality
    // because the null pointer is a temporary value created by the engine
    return this.context.container.utils.isEqual(
      this.context.pointer,
      this.handle,
      this.context.container.exports.HAKO_GetNull(),
      EqualOp.StrictEquals
    );
  }

  /**
   * Checks if this value is a boolean.
   *
   * @returns True if the value is a boolean
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isBoolean(): boolean {
    this.assertAlive();
    return this.type === "boolean";
  }

  /**
   * Checks if this value is a number.
   *
   * @returns True if the value is a number
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isNumber(): boolean {
    this.assertAlive();
    return this.type === "number";
  }

  /**
   * Checks if this value is a string.
   *
   * @returns True if the value is a string
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isString(): boolean {
    this.assertAlive();
    return this.type === "string";
  }

  /**
   * Checks if this value is a symbol.
   *
   * @returns True if the value is a symbol
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isSymbol(): boolean {
    this.assertAlive();
    return this.type === "symbol";
  }

  /**
   * Checks if this value is an object.
   *
   * @returns True if the value is an object
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isObject(): boolean {
    this.assertAlive();
    return this.type === "object";
  }

  /**
   * Checks if this value is an array.
   *
   * @returns True if the value is an array
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isArray(): boolean {
    this.assertAlive();
    return (
      this.context.container.exports.HAKO_IsArray(
        this.context.pointer,
        this.handle
      ) !== 0
    );
  }

  /**
   * Gets the type of typed array if this value is a typed array.
   *
   * @returns The specific type of typed array
   * @throws {TypeError} If the value is not a typed array
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  getTypedArrayType(): TypedArrayType {
    this.assertAlive();
    if (!this.isTypedArray()) {
      throw new TypeError("Value is not a typed array");
    }
    const typeId = this.context.container.exports.HAKO_GetTypedArrayType(
      this.context.pointer,
      this.handle
    );

    switch (typeId) {
      case 1:
        return "Uint8Array";
      case 2:
        return "Uint8ClampedArray";
      case 3:
        return "Int8Array";
      case 4:
        return "Uint16Array";
      case 5:
        return "Int16Array";
      case 6:
        return "Uint32Array";
      case 7:
        return "Int32Array";
      case 8:
        return "BigInt64Array";
      case 9:
        return "BigUint64Array";
      case 10:
        return "Float16Array";
      case 11:
        return "Float32Array";
      case 12:
        return "Float64Array";
      default:
        return "Unknown";
    }
  }

  /**
   * Checks if this value is a typed array.
   *
   * @returns True if the value is a typed array
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isTypedArray(): boolean {
    this.assertAlive();
    return (
      this.context.container.exports.HAKO_IsTypedArray(
        this.context.pointer,
        this.handle
      ) !== 0
    );
  }

  /**
   * Checks if this value is an ArrayBuffer.
   *
   * @returns True if the value is an ArrayBuffer
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isArrayBuffer(): boolean {
    this.assertAlive();
    return this.context.container.exports.HAKO_IsArrayBuffer(this.handle) !== 0;
  }

  /**
   * Checks if this value is a function.
   *
   * @returns True if the value is a function
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isFunction(): boolean {
    this.assertAlive();
    return this.type === "function";
  }

  /**
   * Checks if this value is a Promise.
   *
   * @returns True if the value is a Promise
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isPromise(): boolean {
    this.assertAlive();
    return (
      this.context.container.exports.HAKO_IsPromise(
        this.context.pointer,
        this.handle
      ) !== 0
    );
  }

  /**
   * Converts this value to a JavaScript number.
   *
   * @returns The numeric value
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  asNumber(): number {
    this.assertAlive();
    return this.context.container.exports.HAKO_GetFloat64(
      this.context.pointer,
      this.handle
    );
  }

  /**
   * Converts this value to a JavaScript boolean according to JavaScript truthiness rules.
   *
   * @returns The boolean value
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  asBoolean(): boolean {
    this.assertAlive();
    if (this.isBoolean()) {
      return this.context.container.utils.isEqual(
        this.context.pointer,
        this.handle,
        this.context.container.exports.HAKO_GetTrue(),
        EqualOp.StrictEquals
      );
    }

    // JavaScript truthiness rules
    if (this.isNull() || this.isUndefined()) return false;
    if (this.isNumber())
      return this.asNumber() !== 0 && !Number.isNaN(this.asNumber());
    if (this.isString()) return this.asString() !== "";

    // Objects are always true
    return true;
  }

  /**
   * Converts this value to a JavaScript string.
   *
   * @returns The string value
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  asString(): string {
    this.assertAlive();
    const strPtr = this.context.container.exports.HAKO_ToCString(
      this.context.pointer,
      this.handle
    );
    const str = this.context.container.memory.readString(strPtr);
    this.context.container.memory.freeCString(this.context.pointer, strPtr);
    return str;
  }

  /**
   * Gets a property from this object.
   *
   * @param key - Property name, index, or VMValue key
   * @returns The property value
   * @throws Error if property access fails
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  getProperty(key: string | number | VMValue): VMValue {
    this.assertAlive();
    return Scope.withScope((scope) => {
      if (typeof key === "number") {
        const propPtr = this.context.container.exports.HAKO_GetPropNumber(
          this.context.pointer,
          this.handle,
          key
        );
        if (propPtr === 0) {
          const error = this.context.getLastError();
          if (error) {
            throw error;
          }
        }
        return new VMValue(this.context, propPtr, ValueLifecycle.Owned);
      }
      let keyPtr: number;
      if (typeof key === "string") {
        const keyStrPtr = this.context.container.memory.allocateString(this.context.pointer, key);
        keyPtr = this.context.container.exports.HAKO_NewString(
          this.context.pointer,
          keyStrPtr
        );
        scope.add(() => {
          this.context.container.memory.freeMemory(this.context.pointer, keyStrPtr);
          this.context.container.memory.freeValuePointer(
            this.context.pointer,
            keyPtr
          );
        });
      } else {
        keyPtr = key.getHandle();
      }
      const propPtr = this.context.container.exports.HAKO_GetProp(
        this.context.pointer,
        this.handle,
        keyPtr
      );
      if (propPtr === 0) {
        const error = this.context.getLastError();
        if (error) {
          throw error;
        }
      }
      return new VMValue(this.context, propPtr, ValueLifecycle.Owned);
    });
  }

  /**
   * Sets a property on this object.
   *
   * @param key - Property name, index, or VMValue key
   * @param value - Value to set (can be a JavaScript value or VMValue)
   * @returns True if the property was set successfully
   * @throws Error if property setting fails
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  setProperty(key: string | number | VMValue, value: unknown): boolean {
    this.assertAlive();
    return Scope.withScope((scope) => {
      let keyPtr: number;
      let valuePtr: number;

      // Process the key
      if (typeof key === "number") {
        const keyValue = scope.manage(this.context.newValue(key));
        keyPtr = keyValue.getHandle();
      } else if (typeof key === "string") {
        const keyValue = scope.manage(this.context.newValue(key));
        keyPtr = keyValue.getHandle();
      } else {
        // For JSValue keys, just use the pointer
        keyPtr = key.getHandle();
      }

      // Process the value
      if (value instanceof VMValue) {
        // For JSValue values, just use the pointer
        valuePtr = value.getHandle();
      } else {
        // Convert JavaScript value to JSValue using the factory
        const valueJSValue = scope.manage(this.context.newValue(value));
        valuePtr = valueJSValue.getHandle();
      }
      // Set the property
      const result = this.context.container.exports.HAKO_SetProp(
        this.context.pointer,
        this.handle,
        keyPtr,
        valuePtr
      );
      if (result === -1) {
        const error = this.context.getLastError();
        if (error) {
          throw error;
        }
      }
      return LEPUS_BOOLToBoolean(result);
    });
  }

  /**
   * Defines a property with a property descriptor on this object.
   *
   * @param key - Property name or VMValue key
   * @param descriptor - Property descriptor with value, getter/setter, and attributes
   * @returns True if the property was defined successfully
   * @throws Error if property definition fails
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  defineProperty(
    key: string | VMValue,
    descriptor: PropertyDescriptor
  ): boolean {
    this.assertAlive();
    return Scope.withScope((scope) => {
      let keyPtr: number;

      if (typeof key === "string") {
        const keyStr = scope.manage(this.context.newValue(key));
        keyPtr = keyStr.getHandle();
      } else {
        keyPtr = key.getHandle();
      }

      // Set up descriptor parameters
      let valuePtr = this.context.container.exports.HAKO_GetUndefined();
      let getPtr = this.context.container.exports.HAKO_GetUndefined();
      let setPtr = this.context.container.exports.HAKO_GetUndefined();
      const configurable = descriptor.configurable || false;
      const enumerable = descriptor.enumerable || false;
      let hasValue = false;

      if (descriptor.value !== undefined) {
        if (descriptor.value instanceof VMValue) {
          valuePtr = descriptor.value.getHandle();
        } else {
          // Convert JavaScript value to JSValue
          const jsValue = scope.manage(this.context.newValue(descriptor.value));
          valuePtr = jsValue.getHandle();
        }
        hasValue = true;
      }

      if (descriptor.get !== undefined) {
        if (descriptor.get instanceof VMValue) {
          getPtr = descriptor.get.getHandle();
        } else {
          throw new Error("Getter must be a JSValue");
        }
      }

      if (descriptor.set !== undefined) {
        if (descriptor.set instanceof VMValue) {
          setPtr = descriptor.set.getHandle();
        } else {
          throw new Error("Setter must be a JSValue");
        }
      }

      const result = this.context.container.exports.HAKO_DefineProp(
        this.context.pointer,
        this.handle,
        keyPtr,
        valuePtr,
        getPtr,
        setPtr,
        configurable ? 1 : 0,
        enumerable ? 1 : 0,
        hasValue ? 1 : 0
      );
      if (result === -1) {
        const error = this.context.getLastError();
        if (error) {
          throw error;
        }
      }
      return LEPUS_BOOLToBoolean(result);
    });
  }

  /**
   * Checks if this value is a global symbol.
   *
   * @returns True if the value is a global symbol
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  isGlobalSymbol(): boolean {
    this.assertAlive();
    return (
      this.context.container.exports.HAKO_IsGlobalSymbol(
        this.context.pointer,
        this.handle
      ) === 1
    );
  }

  /**
   * Gets all own property names of this object.
   *
   * Returns a generator that yields each property name as a VMValue.
   *
   * @param flags - Flags to control which properties to include
   * @returns A generator yielding property name VMValues
   * @throws Error if property enumeration fails
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  *getOwnPropertyNames(
    flags: number = PropertyEnumFlags.String | PropertyEnumFlags.Enumerable
  ): Generator<VMValue, void, unknown> {
    this.assertAlive();

    const scope = new Scope();
    let outPtrsBase: number | null = null;
    let outLen = 0;

    const outPtrPtr = this.context.container.memory.allocatePointerArray(this.context.pointer, 2);
    const outLenPtr = this.context.container.memory.allocateMemory(this.context.pointer, 4);

    scope.add(() => {
      this.context.container.memory.freeMemory(this.context.pointer, outPtrPtr);
      this.context.container.memory.freeMemory(this.context.pointer, outLenPtr);
    });

    this.context.container.memory.writeUint32(outLenPtr, 1000);

    const errorPtr = this.context.container.exports.HAKO_GetOwnPropertyNames(
      this.context.pointer,
      outPtrPtr,
      outLenPtr,
      this.handle,
      flags
    );

    const error = this.context.getLastError(errorPtr);
    if (error) {
      this.context.container.memory.freeValuePointer(
        this.context.pointer,
        errorPtr
      );
      scope.release();
      throw error;
    }

    outLen = this.context.container.memory.readUint32(outLenPtr);
    outPtrsBase = this.context.container.memory.readPointer(outPtrPtr);

    for (let currentIndex = 0; currentIndex < outLen; currentIndex++) {
      const valuePtr = this.context.container.memory.readPointerFromArray(
        outPtrsBase,
        currentIndex
      );
      try {
        yield new VMValue(this.context, valuePtr, ValueLifecycle.Owned);
      } catch (e) {
        // Clean up any remaining value pointers if iteration is aborted
        for (let i = currentIndex; i < outLen; i++) {
          const unyieldedValuePtr =
            this.context.container.memory.readPointerFromArray(outPtrsBase, i);
          this.context.container.memory.freeValuePointer(
            this.context.pointer,
            unyieldedValuePtr
          );
        }
        break;
      }
    }

    if (outPtrsBase !== null) {
      this.context.container.memory.freeMemory(this.context.pointer, outPtrsBase);
    }
    scope.release();
  }

  /**
   * Gets the promise state if this value is a promise.
   *
   * @returns The promise state (Pending, Fulfilled, or Rejected)
   * @throws Error if the value is not a promise
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  getPromiseState(): PromiseState | undefined {
    this.assertAlive();
    if (!this.isPromise()) {
      throw new Error("Value is not a promise");
    }
    switch (this.context.container.exports.HAKO_PromiseState(
      this.context.pointer,
      this.handle
    )) {
      case 0:
        return "pending";
      case 1:
        return "fulfilled";
      case 2:
        return "rejected";
      default:
        return undefined;

    }
  }

  /**
   * Gets the promise result if this value is a fulfilled or rejected promise.
   *
   * @returns The promise result value, or undefined if the promise is pending
   * @throws TypeError if the value is not a promise
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  getPromiseResult(): VMValue | undefined {
    this.assertAlive();
    if (!this.isPromise()) {
      throw new TypeError("Value is not a promise");
    }

    const state = this.getPromiseState();
    if (state !== "fulfilled" && state !== "rejected") {
      return undefined;
    }

    const resultPtr = this.context.container.exports.HAKO_PromiseResult(
      this.context.pointer,
      this.handle
    );
    return new VMValue(this.context, resultPtr, ValueLifecycle.Owned);
  }

  /**
   * Converts this value to a JSON string.
   *
   * @param indent - Number of spaces for indentation, 0 for no formatting
   * @returns JSON string representation
   * @throws Error if JSON conversion fails
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  stringify(indent = 0): string {
    this.assertAlive();
    const jsonPtr = this.context.container.exports.HAKO_ToJson(
      this.context.pointer,
      this.handle,
      indent
    );
    const error = this.context.getLastError(jsonPtr);
    if (error) {
      this.context.container.memory.freeValuePointer(
        this.context.pointer,
        jsonPtr
      );
      throw error;
    }
    return new VMValue(this.context, jsonPtr, ValueLifecycle.Owned).consume(
      (json) => {
        const str = json.asString();
        this.context.container.memory.freeCString(
          this.context.pointer,
          jsonPtr
        );
        return str;
      }
    );
  }

  /**
   * Gets the BigInt value if this is a BigInt.
   *
   * @returns The BigInt value
   * @throws HakoError if BigInt support is not enabled
   * @throws TypeError if the value is not a BigInt
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  getBigInt(): bigint {
    if (!this.context.container.utils.getBuildInfo().hasBignum) {
      throw new HakoError("This build of Hako does not have BigInt enabled.");
    }
    this.assertAlive();
    if (this.type !== "bigint") {
      throw new TypeError("Value is not a BigInt");
    }
    return BigInt(this.asString());
  }

  /**
   * Gets the length of this value if it's an array.
   *
   * @returns The array length
   * @throws Error if the value is not an array
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  getLength(): number {
    this.assertAlive();
    if (!this.isArray()) {
      throw new Error("Value is not an array");
    }
    return this.context.container.utils.getLength(
      this.context.pointer,
      this.handle
    );
  }

  /**
   * Converts this VM value to a native JavaScript value.
   *
   * Handles all JavaScript types including objects and arrays (recursively).
   * Returns a NativeBox that contains the value and implements the Disposable interface.
   *
   * @template TValue - The expected type of the native value
   * @returns A NativeBox containing the native value
   * @throws Error if conversion fails
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  toNativeValue<TValue = unknown>(): NativeBox<TValue> {
    this.assertAlive();
    const type = this.type;
    const disposables: Disposable[] = [];
    disposables.push(this);

    const createResult = (value: unknown): NativeBox<TValue> => {
      let alive = true;
      return {
        value: value as TValue,
        alive,
        dispose() {
          if (!alive) return;
          alive = false;
          for (const d of disposables) d[Symbol.dispose]();
        },
        [Symbol.dispose]() {
          this.dispose();
        },
      };
    };

    try {
      switch (type) {
        case "undefined":
          return createResult(undefined);
        case "null":
          return createResult(null);
        case "boolean":
          return createResult(this.asBoolean());
        case "number":
          return createResult(this.asNumber());
        case "string":
          return createResult(this.asString());
        case "symbol":
          return createResult(Symbol(this.asString()));
        case "bigint":
          return createResult(BigInt(this.asString()));
        case "object": {
          if (this.isArray()) {
            const length = this.getLength();
            const result = [];
            for (let i = 0; i < length; i++) {
              const item = this.getProperty(i).toNativeValue();
              disposables.push(item);
              result.push(item.value);
            }
            return createResult(result);
          }

          const result: Record<string, unknown> = {};
          const ownProps = this.getOwnPropertyNames();
          let iterationResult = ownProps.next();
          try {
            while (!iterationResult.done) {
              const prop = iterationResult.value;
              const propName = prop.consume((v) => v.asString());
              const value = this.getProperty(propName).toNativeValue();
              disposables.push(value);
              result[propName] = value.value;
              iterationResult = ownProps.next();
            }
            return createResult(result);
          } catch (error) {
            // Pass the error to the generator, allowing it to handle internally
            ownProps.throw(error);
            throw error;
          }
        }
        case "function": {
          const jsFunction = (...args: unknown[]): unknown => {
            return Scope.withScope((scope) => {
              const jsArgs = args.map((arg) =>
                scope.manage(this.context.newValue(arg))
              );
              using result = this.context
                .callFunction(this, null, ...jsArgs)
                .unwrap();
              const resultJs = scope.manage(result.toNativeValue());
              return resultJs.value;
            });
          };

          using nameProperty = this.getProperty("name");
          if (nameProperty?.isString()) {
            Object.defineProperty(jsFunction, "name", {
              value: nameProperty.asString(),
              configurable: true,
            });
          }

          jsFunction.toString = () => `[PrimJS Function: ${this.asString()}]`;
          return createResult(jsFunction);
        }
        default:
          throw new Error("Unknown type");
      }
    } catch (error) {
      // Dispose all resources in case of errors
      for (const d of disposables) d[Symbol.dispose]();
      throw error;
    }
  }

  /**
   * Extracts the data from a Uint8Array typed array.
   *
   * Copies the data from the VM typed array to a new host Uint8Array.
   *
   * @returns A Uint8Array containing the copied data
   * @throws TypeError if the value is not a Uint8Array
   * @throws Error if array copying fails
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  copyTypedArray(): Uint8Array {
    this.assertAlive();
    if (this.getTypedArrayType() !== "Uint8Array") {
      throw new TypeError("Value is not a Uint8Array");
    }
    return Scope.withScope((scope) => {
      const pointer = this.context.container.memory.allocatePointerArray(this.context.pointer, 1);
      scope.add(() => {
        this.context.container.memory.freeMemory(this.context.pointer, pointer);
      });

      const bufPtr = this.context.container.exports.HAKO_CopyTypedArrayBuffer(
        this.context.pointer,
        this.handle,
        pointer
      );

      if (bufPtr === 0) {
        const error = this.context.getLastError();
        if (error) {
          throw error;
        }
      }
      const length = this.context.container.memory.readPointerFromArray(
        pointer,
        0
      );
      scope.add(() => {
        this.context.container.memory.freeMemory(this.context.pointer, bufPtr);
      });
      return new Uint8Array(this.context.container.exports.memory.buffer).slice(
        bufPtr,
        bufPtr + length
      );
    });
  }

  /**
   * Extracts the data from an ArrayBuffer.
   *
   * Copies the data from the VM ArrayBuffer to a new host ArrayBuffer.
   *
   * @returns An ArrayBuffer containing the copied data
   * @throws TypeError if the value is not an ArrayBuffer
   * @throws Error if buffer copying fails
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  copyArrayBuffer(): ArrayBuffer {
    this.assertAlive();
    if (!this.isArrayBuffer()) {
      throw new TypeError("Value is not an ArrayBuffer");
    }
    return Scope.withScope((scope) => {
      const pointer = this.context.container.memory.allocatePointerArray(this.context.pointer, 1);
      scope.add(() => {
        this.context.container.memory.freeMemory(this.context.pointer, pointer);
      });

      const bufPtr = this.context.container.exports.HAKO_CopyArrayBuffer(
        this.context.pointer,
        this.handle,
        pointer
      );

      if (bufPtr === 0) {
        const error = this.context.getLastError();
        if (error) {
          throw error;
        }
      }

      const length = this.context.container.memory.readPointer(pointer);

      if (length === 0) {
        return new ArrayBuffer(0);
      }

      scope.add(() => {
        this.context.container.memory.freeMemory(this.context.pointer, bufPtr);
      });

      // Get the memory slice from the WASM buffer
      const mem = this.context.container.memory.slice(bufPtr, length);

      // Create a new ArrayBuffer and copy the data
      const result = new ArrayBuffer(length);
      const resultView = new Uint8Array(result);
      resultView.set(mem);

      return result;
    });
  }

  /**
   * Disposes this value, freeing any associated resources.
   *
   * If this is an owned value, its handle will be freed. Borrowed values
   * will not have their handles freed.
   */
  dispose(): void {
    if (!this.alive) return;
    if (this.lifecycle === ValueLifecycle.Borrowed) {
      this.handle = 0;
      return;
    }
    this.context.container.memory.freeValuePointer(
      this.context.pointer,
      this.handle
    );
    this.handle = 0;
  }

  /**
   * Implements Symbol.dispose for the Disposable interface.
   *
   * This allows VMValue to be used with `using` statements in
   * environments that support the Disposable pattern.
   */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * Compares two VMValues for equality.
   *
   * @param a - First VMValue to compare
   * @param b - Second VMValue to compare
   * @param ctx - Context pointer
   * @param compar - Comparison function from exports
   * @param equalityType - Type of equality comparison to perform
   * @returns True if the values are equal according to the specified comparison
   * @private
   */
  private static isEqual(
    a: VMValue,
    b: VMValue,
    ctx: number,
    compar: HakoExports["HAKO_IsEqual"],
    equalityType: IsEqualOp = IsEqualOp.IsStrictlyEqual
  ): boolean {
    if (a === b) {
      return true;
    }
    // check if both are in the provided context
    if (a.getContextPointer() !== ctx || b.getContextPointer() !== 0) {
      return false;
    }
    // check if different contexts
    if (a.getContextPointer() !== b.getContextPointer()) {
      return false;
    }

    const result = compar(ctx, a.getHandle(), b.getHandle(), equalityType);
    if (result === -1) {
      throw new Error("NOT IMPLEMENTED");
    }
    return Boolean(result);
  }

  /**
   * Gets the class ID of this value.
   *
   * This is useful for checking instance types using instanceof.
   *
   * @returns The class ID, or 0 if not a class instance
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  classId(): number {
    this.assertAlive();
    return this.context.container.exports.HAKO_GetClassID(this.handle);
  }

  getOpaque(): number {
    this.assertAlive();
    const result = this.context.container.exports.HAKO_GetOpaque(
      this.context.pointer,
      this.handle,
      this.classId()
    );
    if (this.context.getLastError()) {
      throw this.context.getLastError();
    }
    return result;
  }

  setOpaque(opaque: number): void {
    this.assertAlive();
    this.context.container.exports.HAKO_SetOpaque(
      this.handle,
      opaque
    );
  }

  /**
   * Checks if this value is an instance of another value (class).
   *
   * Equivalent to the JavaScript `instanceof` operator.
   *
   * @param other - The constructor or class to check against
   * @returns True if this value is an instance of the specified constructor
   * @throws Error if the check fails
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   */
  instanceof(other: VMValue): boolean {
    this.assertAlive();
    const result = this.context.container.exports.HAKO_IsInstanceOf(
      this.context.pointer,
      this.handle,
      other.getHandle()
    );
    if (result === -1) {
      const error = this.context.getLastError();
      if (error) {
        throw error;
      }
    }
    return result === 1;
  }

  /**
   * Checks if this value is strictly equal to another value.
   *
   * Equivalent to the JavaScript `===` operator.
   * See [Equality comparisons and sameness](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness).
   *
   * @param other - The value to compare with
   * @returns True if the values are strictly equal
   */
  eq(other: VMValue): boolean {
    return VMValue.isEqual(
      this,
      other,
      this.getContextPointer(),
      this.context.container.exports.HAKO_IsEqual,
      IsEqualOp.IsStrictlyEqual
    );
  }

  /**
   * Checks if this value is the same value as another (Object.is semantics).
   *
   * Equivalent to JavaScript's `Object.is()` function.
   * See [Equality comparisons and sameness](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness).
   *
   * @param other - The value to compare with
   * @returns True if the values are the same according to Object.is
   */
  sameValue(other: VMValue): boolean {
    return VMValue.isEqual(
      this,
      other,
      this.getContextPointer(),
      this.context.container.exports.HAKO_IsEqual,
      IsEqualOp.IsSameValue
    );
  }

  /**
   * Checks if this value is the same as another using SameValueZero comparison.
   *
   * SameValueZero is like Object.is but treats +0 and -0 as equal.
   * This is the comparison used by methods like Array.prototype.includes().
   * See [Equality comparisons and sameness](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness).
   *
   * @param other - The value to compare with
   * @returns True if the values are the same according to SameValueZero
   */
  sameValueZero(other: VMValue): boolean {
    return VMValue.isEqual(
      this,
      other,
      this.getContextPointer(),
      this.context.container.exports.HAKO_IsEqual,
      IsEqualOp.IsSameValueZero
    );
  }

  /**
   * Verifies that this value is still alive (not disposed).
   *
   * @throws {PrimJSUseAfterFree} If the value has been disposed
   * @private
   */
  private assertAlive(): void {
    if (!this.alive) {
      throw new PrimJSUseAfterFree("VMValue is disposed");
    }
  }
}
