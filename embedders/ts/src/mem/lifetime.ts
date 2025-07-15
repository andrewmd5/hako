import { type MaybeAsyncBlock, maybeAsync } from "../helpers/asyncify-helpers";
import type { SuccessOrFail } from "../vm/vm-interface";
/**
 * A container for native values that need deterministic cleanup.
 *
 * NativeBox provides a uniform interface for managing the lifecycle of values
 * that may have associated resources requiring explicit cleanup.
 *
 * @template TValue - The type of value contained in the box
 */
export type NativeBox<TValue> = {
  /**
   * The contained value
   */
  value: TValue;

  /**
   * Indicates if the boxed value is still valid and usable
   */
  alive: boolean;

  /**
   * Releases any resources associated with the boxed value
   */
  dispose(): void;

  /**
   * Implements the Symbol.dispose method for the Disposable interface
   */
  [Symbol.dispose](): void;
};

/**
 * Checks if a value implements the disposable interface.
 *
 * This type guard determines if a value is disposable by checking if it has
 * both an 'alive' boolean property and a 'dispose' method.
 *
 * @param value - The value to check
 * @returns True if the value is disposable, false otherwise
 */
function isDisposable(
  value: unknown
): value is { alive: boolean; dispose(): unknown } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "dispose" in value &&
      typeof value.dispose === "function" &&
      "alive" in value &&
      typeof value.alive === "boolean"
  );
}

/**
 * Checks if a value is an instance of AbstractDisposableResult.
 *
 * @param value - The value to check
 * @returns True if the value is an AbstractDisposableResult, false otherwise
 */
export function isAbstractDisposableResult(
  value: unknown
): value is AbstractDisposableResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      value instanceof AbstractDisposableResult
  );
}

/**
 * Abstract base class for disposable result types.
 *
 * This class provides the foundation for creating disposable success and failure
 * result types that can be used for operations that might fail and need resource
 * cleanup regardless of outcome.
 *
 * @implements {Disposable} - Implements the Disposable interface
 */
abstract class AbstractDisposableResult implements Disposable {
  /**
   * Creates a success result with the provided value.
   *
   * @template S - Success value type
   * @template F - Failure value type
   * @param value - The success value
   * @returns A disposable success result containing the value
   */
  static success<S, F>(value: S): DisposableSuccess<S> {
    return new DisposableSuccess(value) satisfies SuccessOrFail<S, F>;
  }

  /**
   * Creates a failure result with the provided error.
   *
   * @template S - Success value type
   * @template F - Failure value type
   * @param error - The error value
   * @param onUnwrap - Callback to execute when unwrap is called on this failure
   * @returns A disposable failure result containing the error
   */
  static fail<S, F>(
    error: F,
    onUnwrap: (status: SuccessOrFail<S, F>) => void
  ): DisposableFail<F> {
    return new DisposableFail(
      error,
      onUnwrap as (status: SuccessOrFail<never, F>) => void
    ) satisfies SuccessOrFail<S, F>;
  }

  /**
   * Checks if a result is a DisposableResult.
   *
   * @template S - Success value type
   * @template F - Failure value type
   * @param result - The result to check
   * @returns True if the result is a DisposableResult, false otherwise
   */
  static is<S, F>(
    result: SuccessOrFail<S, F>
  ): result is DisposableResult<S, F> {
    return result instanceof AbstractDisposableResult;
  }

  /**
   * Indicates if the result's contained value is still valid and usable.
   */
  abstract get alive(): boolean;

  /**
   * Releases any resources associated with the result.
   */
  abstract dispose(): void;

  /**
   * Implements the Symbol.dispose method for the Disposable interface.
   */
  [Symbol.dispose](): void {
    this.dispose();
  }
}

/**
 * Represents a successful operation result with disposable resources.
 *
 * This class wraps a success value and provides methods to safely access or
 * dispose of the contained value.
 *
 * @template S - The type of the success value
 * @extends {AbstractDisposableResult}
 */
export class DisposableSuccess<S> extends AbstractDisposableResult {
  /**
   * Indicates this is a success result with no error.
   */
  declare error?: undefined;

  /**
   * Creates a new DisposableSuccess.
   *
   * @param value - The success value
   */
  constructor(readonly value: S) {
    super();
  }

  /**
   * Checks if the contained value is still valid and usable.
   *
   * If the value implements the disposable interface, this returns its 'alive' status.
   * Otherwise, it returns true.
   *
   * @returns The alive status of the contained value
   */
  override get alive() {
    return isDisposable(this.value) ? this.value.alive : true;
  }

  /**
   * Disposes of the contained value if it is disposable.
   */
  override dispose(): void {
    if (isDisposable(this.value)) {
      this.value.dispose();
    }
  }

  /**
   * Unwraps the success value.
   *
   * @returns The contained success value
   */
  unwrap(): S {
    return this.value;
  }

  /**
   * Unwraps the success value or returns a fallback if this was a failure.
   *
   * Since this is a success result, this always returns the contained value
   * and ignores the fallback.
   *
   * @template T - The type of the fallback value
   * @param _fallback - The fallback value (ignored)
   * @returns The contained success value
   */
  unwrapOr<T>(_fallback: T): S {
    return this.value;
  }
}

/**
 * Represents a failed operation result with disposable resources.
 *
 * This class wraps an error value and provides methods to either safely access
 * a fallback value or throw the contained error.
 *
 * @template F - The type of the error value
 * @extends {AbstractDisposableResult}
 */
export class DisposableFail<F> extends AbstractDisposableResult {
  /**
   * Creates a new DisposableFail.
   *
   * @param error - The error value
   * @param onUnwrap - Callback to execute when unwrap is called on this failure
   */
  constructor(
    readonly error: F,
    private readonly onUnwrap: (status: SuccessOrFail<never, F>) => void
  ) {
    super();
  }

  /**
   * Checks if the contained error is still valid and usable.
   *
   * If the error implements the disposable interface, this returns its 'alive' status.
   * Otherwise, it returns true.
   *
   * @returns The alive status of the contained error
   */
  override get alive(): boolean {
    return isDisposable(this.error) ? this.error.alive : true;
  }

  /**
   * Disposes of the contained error if it is disposable.
   */
  override dispose(): void {
    if (isDisposable(this.error)) {
      this.error.dispose();
    }
  }

  /**
   * Attempts to unwrap the success value, but this will always throw since
   * this is a failure result.
   *
   * @throws The contained error
   * @returns Never returns
   */
  unwrap(): never {
    this.onUnwrap(this);
    throw this.error;
  }

  /**
   * Unwraps the success value or returns a fallback if this was a failure.
   *
   * Since this is a failure result, this always returns the fallback value.
   *
   * @template T - The type of the fallback value
   * @param fallback - The fallback value to return
   * @returns The fallback value
   */
  unwrapOr<T>(fallback: T): T {
    return fallback;
  }
}

/**
 * Union type representing either a successful or failed operation result,
 * both with disposable resource management.
 *
 * @template S - The type of the success value
 * @template F - The type of the error value
 */
export type DisposableResult<S, F> = DisposableSuccess<S> | DisposableFail<F>;

/**
 * Factory and utility functions for creating and working with DisposableResults.
 */
export const DisposableResult = AbstractDisposableResult;

/**
 * Helper function for handling scope cleanup in finally blocks.
 *
 * This function handles the complex error handling logic needed when both
 * the main operation and the cleanup might throw errors. It prioritizes
 * the original error but adds the cleanup error as a property for debugging.
 *
 * @param scope - The scope to release
 * @param blockError - Any error that occurred in the main operation
 * @throws Combined error if both main operation and cleanup failed
 * @throws Original error if only the main operation failed
 * @throws Cleanup error if only the cleanup failed
 * @private
 */
function scopeFinally(scope: Scope, blockError: Error | undefined) {
  let disposeError: Error | undefined;
  try {
    scope.release();
  } catch (error) {
    disposeError = error as unknown as Error;
  }

  if (blockError && disposeError) {
    Object.assign(blockError, {
      message: `${blockError.message}\n Then, failed to dispose scope: ${disposeError.message}`,
      disposeError,
    });
    throw blockError;
  }

  if (blockError || disposeError) {
    throw blockError || disposeError;
  }
}

/**
 * A utility class that helps manage resources with automatic cleanup.
 *
 * Scope collects cleanup functions to be executed when the scope is disposed,
 * ensuring deterministic resource cleanup even in the presence of exceptions.
 * It follows the RAII (Resource Acquisition Is Initialization) pattern.
 *
 * @implements {Disposable} - Implements the Disposable interface
 */
export class Scope implements Disposable {
  /**
   * Collection of cleanup functions to be executed on disposal
   * @private
   */
  private cleanupFns: Array<() => void> = [];

  /**
   * Flag indicating if the scope has been disposed
   * @private
   */
  private isDisposed = false;

  /**
   * Adds a cleanup function to be executed when the scope is disposed.
   *
   * Cleanup functions are executed in reverse order (LIFO) during disposal.
   *
   * @param fn - The cleanup function to add
   * @throws Error if the scope has already been disposed
   */
  public add(fn: () => void): void {
    if (this.isDisposed) {
      throw new Error("Cannot add cleanup function to a disposed scope");
    }
    this.cleanupFns.push(fn);
  }

  /**
   * Executes all cleanup functions and clears the list.
   *
   * Cleanup functions are executed in reverse order (LIFO).
   * If already disposed, this is a no-op.
   * Errors in cleanup functions are caught and logged to avoid masking other errors.
   */
  public release(): void {
    if (this.isDisposed) {
      return;
    }

    // Execute cleanup functions in reverse order (LIFO)
    for (let i = this.cleanupFns.length - 1; i >= 0; i--) {
      try {
        this.cleanupFns[i]();
      } catch (error) {
        console.error("Error during cleanup:", error);
      }
    }
    this.cleanupFns = [];
    this.isDisposed = true;
  }

  /**
   * Registers a disposable value to be managed by this scope.
   *
   * If the value implements the disposable interface, its dispose method
   * will be called when the scope is disposed.
   *
   * @template T - The type of the value to manage
   * @param value - The value to manage
   * @returns The same value, allowing for chained method calls
   */
  public manage<T>(value: T): T {
    if (isDisposable(value)) {
      this.add(() => {
        if (value.alive) {
          value.dispose();
        }
      });
    }
    return value;
  }

  /**
   * Executes a function within a scope and automatically disposes the scope afterward.
   *
   * This is a convenience method that creates a scope, executes the provided function
   * with the scope as an argument, and ensures the scope is disposed regardless of
   * whether the function succeeds or throws.
   *
   * @template T - The return type of the function
   * @param block - The function to execute within the scope
   * @returns The result of the function
   */
  public static withScope<T>(block: (scope: Scope) => T): T {
    const scope = new Scope();
    let blockError: Error | undefined;
    try {
      return block(scope);
    } catch (error) {
      blockError = error as unknown as Error;
      throw error;
    } finally {
      scopeFinally(scope, blockError);
    }
  }

  /**
   * Implements the Symbol.dispose method for the Disposable interface.
   *
   * This allows the scope to be used with the using statement
   * in environments that support the Disposable pattern.
   */
  [Symbol.dispose](): void {
    this.release();
  }
}
