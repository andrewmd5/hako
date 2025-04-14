/**
 * error.ts - Error handling utilities for PrimJS wrapper
 */
import type { HakoExports } from "@hako/etc/ffi";
import type { MemoryManager } from "@hako/mem/memory";
import type { JSContextPointer, JSValuePointer } from "@hako/etc/types";

/**
 * Base error class for Hako-related errors.
 * Used for errors that occur within the Hako runtime wrapper itself,
 * not for JavaScript errors that happen within a VM context.
 */
export class HakoError extends Error {
  /**
   * Creates a new HakoError instance.
   *
   * @param message - The error message
   */
  constructor(message: string) {
    super(message);
    this.name = "HakoError";
  }
}

/**
 * Custom error class for representing JavaScript errors that occur inside the PrimJS engine.
 *
 * This class contains both a native error message and optional additional JavaScript
 * error details extracted from the PrimJS context, providing rich error information
 * for debugging.
 */
export class PrimJSError extends Error {
  /**
   * Creates a new PrimJSError instance.
   *
   * @param message - The error message from the wrapper
   * @param jsError - Optional JavaScript error details from the PrimJS context
   * @param jsError.message - The error message from the JavaScript context
   * @param jsError.stack - Optional stack trace from the JavaScript context
   * @param jsError.name - Optional error name from the JavaScript context (e.g., "TypeError")
   * @param jsError.cause - Optional error cause if the error has a cause property
   */
  constructor(
    message: string,
    public readonly jsError?: {
      message: string;
      stack?: string;
      name?: string;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = "PrimJSError";
  }
}

/**
 * Error thrown when attempting to use a PrimJS resource after it has been freed.
 *
 * This is a memory safety error that happens when code tries to access objects, contexts,
 * or other resources that have already been released.
 */
export class PrimJSUseAfterFree extends Error {
  /**
   * The name of this error type.
   */
  name = "PrimJSUseAfterFree";
}

/**
 * Manages error handling operations for the PrimJS engine.
 *
 * Provides utilities for error creation, retrieval, and processing, with special
 * handling for bridging native JavaScript errors into the host environment.
 */
export class ErrorManager {
  private exports: HakoExports;
  private memory: MemoryManager;

  /**
   * Creates a new ErrorManager instance.
   *
   * @param exports - The WebAssembly exports interface for calling the PrimJS engine
   * @param memory - The memory manager for handling WebAssembly memory operations
   */
  constructor(exports: HakoExports, memory: MemoryManager) {
    this.exports = exports;
    this.memory = memory;
  }

  /**
   * Checks if a JSValue is an exception and retrieves the error object.
   *
   * This function should only be called once for a given error state, as it
   * will reset the error state in the PrimJS context.
   *
   * @param ctx - PrimJS context pointer
   * @param ptr - Optional JSValue pointer to check. If not provided, the function
   *              will check the last exception in the context.
   * @returns Pointer to the exception object or 0 if not an exception
   */
  getLastErrorPointer(
    ctx: JSContextPointer,
    ptr?: JSValuePointer
  ): JSValuePointer {
    return this.exports.HAKO_GetLastError(ctx, ptr ? ptr : 0);
  }

  /**
   * Creates a new Error instance within the PrimJS context.
   *
   * This produces an empty Error object in the JavaScript environment that
   * can be populated with properties like message, name, etc.
   *
   * @param ctx - PrimJS context pointer
   * @returns Pointer to the new Error object
   */
  newError(ctx: JSContextPointer): JSValuePointer {
    return this.exports.HAKO_NewError(ctx);
  }

  /**
   * Throws an error in the PrimJS context.
   *
   * This sets the given error as the current exception in the JavaScript environment,
   * equivalent to a `throw` statement in JavaScript.
   *
   * @param ctx - PrimJS context pointer
   * @param errorPtr - Pointer to the error JSValue to throw
   * @returns Pointer to the exception JSValue (typically used as an indicator of an error state)
   */
  throwError(ctx: JSContextPointer, errorPtr: JSValuePointer): JSValuePointer {
    return this.exports.HAKO_Throw(ctx, errorPtr);
  }

  /**
   * Throws a reference error with the specified message in the PrimJS context.
   *
   * This is a convenience method that creates and throws a ReferenceError with
   * the given message in a single operation.
   *
   * @param ctx - PrimJS context pointer
   * @param message - Error message for the ReferenceError
   */
  throwErrorMessage(ctx: JSContextPointer, message: string): void {
    const msgPtr = this.memory.allocateString(message);
    this.exports.HAKO_RuntimeJSThrow(ctx, msgPtr);
    this.memory.freeMemory(msgPtr);
  }

  /**
   * Extracts detailed error information from a PrimJS exception.
   *
   * This method attempts to retrieve rich error details including stack traces
   * and error causes by dumping and parsing the error object from the JavaScript context.
   *
   * @param ctx - PrimJS context pointer
   * @param ptr - Pointer to the exception JSValue
   * @returns A structured object containing error details
   * @private
   */
  private dumpException(
    ctx: JSContextPointer,
    ptr: JSValuePointer
  ): {
    message: string;
    stack?: string;
    name?: string;
    cause?: unknown;
  } {
    let errorStr = "";
    const errorStrPtr = this.exports.HAKO_Dump(ctx, ptr);
    errorStr = this.memory.readString(errorStrPtr);
    this.memory.freeCString(ctx, errorStrPtr);

    // Try to parse as JSON
    try {
      const errorObj = JSON.parse(errorStr);
      return {
        message: errorObj.message || errorStr,
        stack: errorObj.stack,
        name: errorObj.name,
        cause: errorObj.cause,
      };
    } catch (e) {
      // Not valid JSON, just return the string
      return { message: errorStr };
    }
  }

  /**
   * Creates a PrimJSError from a PrimJS exception.
   *
   * This method bridges the gap between errors in the JavaScript environment
   * and errors in the host environment, preserving important debugging information.
   *
   * @param ctx - PrimJS context pointer
   * @param ptr - Pointer to the exception JSValue
   * @returns A PrimJSError instance containing the error details
   */
  getExceptionDetails(ctx: JSContextPointer, ptr: JSValuePointer): PrimJSError {
    const details = this.dumpException(ctx, ptr);
    const message = details.message;
    const error = new PrimJSError(message, details);
    if (details.stack) {
      error.stack = details.stack;
    }
    return error;
  }
}
