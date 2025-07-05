import type { Container } from "@hako/runtime/container";
import type { VMContext } from "@hako/vm/context";
import {
  detectCircularReferences,
  ValueLifecycle,
  type HostCallbackFunction,
} from "@hako/etc/types";
import { VMValue } from "@hako/vm/value";
import { HakoError } from "@hako/etc/errors";

/**
 * Factory class for creating JavaScript values in the PrimJS virtual machine.
 *
 * ValueFactory converts JavaScript values from the host environment into
 * their corresponding representations in the PrimJS VM. It handles all primitive
 * and complex types, with special handling for objects, functions, and errors.
 *
 * @implements {Disposable} - Implements the Disposable interface for resource cleanup
 */
export class ValueFactory implements Disposable {
  /**
   * The VM context in which values will be created
   * @private
   */
  private context: VMContext;

  /**
   * Reference to the container with core services
   * @private
   */
  private container: Container;

  /**
   * Creates a new ValueFactory instance.
   *
   * @param context - The VM context in which values will be created
   * @param container - The service container providing access to PrimJS services
   */
  constructor(context: VMContext, container: Container) {
    this.context = context;
    this.container = container;
  }

  /**
   * Gets the VM context associated with this factory.
   *
   * @returns The VM context
   */
  public getContext(): VMContext {
    return this.context;
  }

  /**
   * Converts a JavaScript value from the host environment to a VM value.
   *
   * This method handles all primitive types (undefined, null, boolean, number, string, bigint),
   * as well as complex types (arrays, objects, dates, errors, etc.). It recursively converts
   * nested values in objects and arrays.
   *
   * @param value - The JavaScript value to convert
   * @param options - Additional options for value creation:
   *                  - name: For functions, the function name (required)
   *                  - isGlobal: For symbols, whether it's a global symbol
   *                  - proto: For objects, an optional prototype object
   * @returns A VM value representation of the input
   * @throws Error if the value type is unsupported or conversion fails
   */
  public fromNativeValue(
    value: unknown,
    options: Record<string, unknown> = {}
  ): VMValue {
    if (value === undefined) {
      return this.createUndefined();
    }
    if (value === null) {
      return this.createNull();
    }
    if (typeof value === "boolean") {
      return this.createBoolean(value);
    }
    if (typeof value === "number") {
      return this.createNumber(value);
    }
    if (typeof value === "string") {
      return this.createString(value);
    }
    if (typeof value === "bigint") {
      return this.createBigInt(value);
    }
    if (typeof value === "symbol") {
      return this.createSymbol(value, options);
    }
    if (typeof value === "function") {
      return this.createFunction(
        value as HostCallbackFunction<VMValue>,
        options
      );
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      return this.createArrayBuffer(value);
    }
    if (Array.isArray(value)) {
      return this.createArray(value);
    }
    if (value instanceof Date) {
      return this.createDate(value);
    }
    if (value instanceof Error) {
      // Handle Error object
      return this.createError(value);
    }
    if (typeof value === "object") {
      return this.createObject(value as Record<string, unknown>, options);
    }
    // If we reach here, we couldn't convert the value
    throw new Error("Unsupported value type");
  }

  /**
   * Creates a VM Error object from a JavaScript Error.
   *
   * @param value - The JavaScript Error object
   * @returns A VM Error object with name, message, stack, and cause properties
   * @private
   */
  private createError(value: Error): VMValue {
    const errorPtr = this.container.exports.HAKO_NewError(this.context.pointer);
    using message = this.createString(value.message);
    using name = this.createString(value.name);
    using stack = this.createString(value.stack || "");

    // Extract cause from Error object
    const extractCause = (err: Error): unknown => {
      if (err.cause !== undefined) {
        return err.cause;
      }
      // Check for options-style Error constructor
      const errWithOptions = err as { options?: { cause?: unknown } };
      return errWithOptions.options?.cause;
    };

    const causeValue = extractCause(value);
    using cause =
      causeValue !== undefined ? this.fromNativeValue(causeValue) : null;

    // Set message property
    using messageKey = this.createString("message");
    this.container.exports.HAKO_SetProp(
      this.context.pointer,
      errorPtr,
      messageKey.getHandle(),
      message.getHandle()
    );

    // Set name property
    using nameKey = this.createString("name");
    this.container.exports.HAKO_SetProp(
      this.context.pointer,
      errorPtr,
      nameKey.getHandle(),
      name.getHandle()
    );

    // Set cause property if it exists
    if (cause) {
      using causeKey = this.createString("cause");
      this.container.exports.HAKO_SetProp(
        this.context.pointer,
        errorPtr,
        causeKey.getHandle(),
        cause.getHandle()
      );
    }

    // Set stack property
    using stackKey = this.createString("stack");
    this.container.exports.HAKO_SetProp(
      this.context.pointer,
      errorPtr,
      stackKey.getHandle(),
      stack.getHandle()
    );

    return new VMValue(this.context, errorPtr, ValueLifecycle.Owned);
  }

  /**
   * Creates a VM function from a host callback function.
   *
   * @param callback - The host callback function to wrap
   * @param options - Options object with required 'name' property
   * @returns A VM function value
   * @throws Error if function name is not provided
   * @private
   */
  private createFunction(
    callback: HostCallbackFunction<VMValue>,
    options: Record<string, unknown>
  ): VMValue {
    if (!options.name || typeof options.name !== "string") {
      throw new Error("Function name is required");
    }

    const functionId = this.container.callbacks.newFunction(
      this.context.pointer,
      callback,
      options.name
    );

    return new VMValue(this.context, functionId, ValueLifecycle.Owned);
  }

  /**
   * Creates a VM undefined value.
   *
   * @returns A VM undefined value
   * @private
   */
  private createUndefined(): VMValue {
    return new VMValue(
      this.context,
      this.container.exports.HAKO_GetUndefined(),
      ValueLifecycle.Borrowed
    );
  }

  /**
   * Creates a VM null value.
   *
   * @returns A VM null value
   * @private
   */
  private createNull(): VMValue {
    return new VMValue(
      this.context,
      this.container.exports.HAKO_GetNull(),
      ValueLifecycle.Borrowed
    );
  }

  /**
   * Creates a VM boolean value.
   *
   * @param value - The JavaScript boolean value
   * @returns A VM boolean value
   * @private
   */
  private createBoolean(value: boolean): VMValue {
    if (value === true) {
      return new VMValue(
        this.context,
        this.container.exports.HAKO_GetTrue(),
        ValueLifecycle.Borrowed
      );
    }

    return new VMValue(
      this.context,
      this.container.exports.HAKO_GetFalse(),
      ValueLifecycle.Borrowed
    );
  }

  /**
   * Creates a VM number value.
   *
   * @param value - The JavaScript number value
   * @returns A VM number value
   * @private
   */
  private createNumber(value: number): VMValue {
    const numPtr = this.container.exports.HAKO_NewFloat64(
      this.context.pointer,
      value
    );
    return new VMValue(this.context, numPtr, ValueLifecycle.Owned);
  }

  /**
   * Creates a VM string value.
   *
   * @param value - The JavaScript string value
   * @returns A VM string value
   * @private
   */
  private createString(value: string): VMValue {
    const strPtr = this.container.memory.allocateString(this.context.pointer, value);
    const jsStrPtr = this.container.exports.HAKO_NewString(
      this.context.pointer,
      strPtr
    );
    this.container.memory.freeMemory(this.context.pointer, strPtr);
    return new VMValue(this.context, jsStrPtr, ValueLifecycle.Owned);
  }

  /**
   * Creates a VM BigInt value.
   *
   * @param value - The JavaScript BigInt value
   * @returns A VM BigInt value
   * @throws HakoError if BigInt support is not enabled in this build
   * @private
   */
  private createBigInt(value: bigint): VMValue {
    if (!this.context.container.utils.getBuildInfo().hasBignum) {
      throw new HakoError("This build of Hako does not have BigInt enabled.");
    }

    // Determine if the value is negative
    const isNegative = value < 0n;
    // Get the absolute value for easier bit manipulation
    const absValue = isNegative ? -value : value;
    // Extract the low and high 32 bits
    const low = Number(absValue & 0xffffffffn);
    const high = Number(absValue >> 32n);

    let bigIntPtr: number;
    // Call the appropriate WASM export based on the sign
    if (isNegative) {
      bigIntPtr = this.container.exports.HAKO_NewBigInt(
        this.context.pointer,
        low,
        high
      );
    } else {
      bigIntPtr = this.container.exports.HAKO_NewBigUInt(
        this.context.pointer,
        low,
        high
      );
    }

    const lastError = this.context.getLastError(bigIntPtr);
    if (lastError) {
      this.container.memory.freeValuePointer(this.context.pointer, bigIntPtr);
      throw lastError;
    }

    return new VMValue(this.context, bigIntPtr, ValueLifecycle.Owned);
  }

  /**
   * Creates a VM Symbol value.
   *
   * @param value - The JavaScript Symbol value
   * @param options - Options object with optional 'isGlobal' property
   * @returns A VM Symbol value
   * @private
   */
  private createSymbol(
    value: symbol,
    options: Record<string, unknown>
  ): VMValue {
    const isGlobal = options.isGlobal || false;
    return this.createString(value.description || "").consume((value) => {
      const jsSymbolPtr = this.container.exports.HAKO_NewSymbol(
        this.context.pointer,
        value.getHandle(),
        isGlobal ? 1 : 0
      );
      return new VMValue(this.context, jsSymbolPtr, ValueLifecycle.Owned);
    });
  }

  /**
   * Creates a VM Array value and populates it with converted elements.
   *
   * @param value - The JavaScript array
   * @returns A VM Array value
   * @private
   */
  private createArray(value: unknown[]): VMValue {
    // Create array and populate it
    const arrayPtr = this.container.exports.HAKO_NewArray(this.context.pointer);
    const jsArray = new VMValue(this.context, arrayPtr, ValueLifecycle.Owned);

    for (let i = 0; i < value.length; i++) {
      using item = this.fromNativeValue(value[i]);
      if (item) {
        jsArray.setProperty(i, item);
      }
    }

    return jsArray;
  }

  /**
   * Creates a VM Date value.
   *
   * @param value - The JavaScript Date object
   * @returns A VM Date value
   * @throws Error if Date creation fails
   * @private
   */
  private createDate(value: Date): VMValue {
    // Get Date constructor from global
    const date = this.container.exports.HAKO_NewDate(
      this.context.pointer,
      value.getTime()
    );

    const error = this.context.getLastError(date);
    if (error) {
      this.container.memory.freeValuePointer(this.context.pointer, date);
      throw error;
    }

    return new VMValue(this.context, date, ValueLifecycle.Owned);
  }

  /**
   * Creates a VM ArrayBuffer value.
   *
   * @param value - The JavaScript ArrayBuffer or view (TypedArray, DataView)
   * @returns A VM ArrayBuffer value
   * @private
   */
  private createArrayBuffer(value: ArrayBuffer | ArrayBufferView): VMValue {
    // Create ArrayBuffer
    let buffer: Uint8Array;
    if (value instanceof ArrayBuffer) {
      buffer = new Uint8Array(value);
    } else {
      buffer = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    const valuePtr = this.container.memory.newArrayBuffer(
      this.context.pointer,
      buffer
    );

    const lastError = this.context.getLastError(valuePtr);
    if (lastError) {
      this.container.memory.freeValuePointer(this.context.pointer, valuePtr);
      throw lastError;
    }   
    return new VMValue(this.context, valuePtr, ValueLifecycle.Owned);
  }

  /**
   * Creates a VM Object value with properties from a JavaScript object.
   *
   * @param value - The JavaScript object
   * @param options - Options object with optional 'proto' property specifying a prototype
   * @returns A VM Object value
   * @throws Error if circular references are detected or object creation fails
   * @private
   */
  private createObject(
    value: Record<string, unknown>,
    options: Record<string, unknown>
  ): VMValue {
    // Check for circular references which can't be represented in the VM
    detectCircularReferences(value);

    // General object case
    const objPtr =
      options.proto && options.proto instanceof VMValue
        ? this.container.exports.HAKO_NewObjectProto(
            this.context.pointer,
            options.proto.getHandle()
          )
        : this.container.exports.HAKO_NewObject(this.context.pointer);

    const lastError = this.context.getLastError(objPtr);
    if (lastError) {
      this.container.memory.freeValuePointer(this.context.pointer, objPtr);
      throw lastError;
    }

    using jsObj = new VMValue(this.context, objPtr, ValueLifecycle.Owned);

    // Add all properties from the source object
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        using propValue = this.fromNativeValue(value[key]);
        if (propValue) {
          jsObj.setProperty(key, propValue);
        }
      }
    }

    return jsObj.dup();
  }

  /**
   * Gets the global object from the VM context.
   *
   * @returns The VM global object
   */
  public getGlobalObject(): VMValue {
    return new VMValue(
      this.context,
      this.container.exports.HAKO_GetGlobalObject(this.context.pointer),
      ValueLifecycle.Owned
    );
  }

  /**
   * Disposes of all resources.
   * 
   * Since caching has been removed, this method is now a no-op
   * but is kept for interface compatibility.
   */
  public dispose(): void {
    // No cached values to dispose of anymore
  }

  /**
   * Implements the Symbol.dispose method for the Disposable interface.
   *
   * This allows the value factory to be used with the using statement
   * in environments that support the Disposable pattern.
   */
  [Symbol.dispose](): void {
    this.dispose();
  }
}