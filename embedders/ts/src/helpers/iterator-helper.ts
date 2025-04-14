import type { VMContextResult } from "@hako/etc/types";
import { DisposableResult } from "@hako/mem/lifetime";
import type { HakoRuntime } from "@hako/runtime/runtime";
import type { VMContext } from "@hako/vm/context";
import { VMValue } from "@hako/vm/value";

/**
 * Proxies the iteration protocol from the host to a guest iterator.
 *
 * VMIterator bridges the gap between JavaScript iterators in the host environment
 * and iterators inside the VM context, allowing you to iterate over VM collections
 * (arrays, maps, sets, etc.) using standard JavaScript iteration patterns.
 *
 * The guest iterator must be a PrimJS object with a standard `next` method
 * that follows the JavaScript iteration protocol. The iterator also supports
 * optional `return` and `throw` methods for full protocol compliance.
 * See [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols).
 *
 * Resource Management:
 * - If calling any method of the iteration protocol throws an error,
 *   the iterator is disposed after returning the exception as the final value.
 * - When the iterator is done, the handle is disposed automatically.
 * - The caller is responsible for disposing each yielded value.
 * - The class implements Disposable, so it can be used with `using` statements.
 *
 * @example
 * ```typescript
 * // Example: Iterating over a Map in the VM
 * using result = context.evalCode(`
 *   const map = new Map();
 *   map.set("key1", "value1");
 *   map.set("key2", "value2");
 *   map;
 * `);
 * using map = result.unwrap();
 *
 * for (using entriesBox of context.getIterator(map).unwrap()) {
 *   using entriesHandle = entriesBox.unwrap();
 *   using keyHandle = entriesHandle.getProperty(0).toNativeValue();
 *   using valueHandle = entriesHandle.getProperty(1).toNativeValue();
 *
 *   console.log(keyHandle.value, valueHandle.value);
 *   // Process key-value pairs
 * }
 * ```
 *
 * @implements {Disposable} - Implements the Disposable interface for resource cleanup
 * @implements {IterableIterator<VMContextResult<VMValue>>} - Implements the IterableIterator interface
 */
export class VMIterator
  implements Disposable, IterableIterator<VMContextResult<VMValue>>
{
  /**
   * Reference to the runtime that owns this iterator
   */
  public owner: HakoRuntime;

  /**
   * Cached reference to the iterator's 'next' method
   * @private
   */
  private _next: VMValue | undefined;

  /**
   * Flag indicating if the iterator has completed
   * @private
   */
  private _isDone = false;

  /**
   * Creates a new VMIterator to proxy iteration for a VM object
   *
   * @param handle - The VM object that implements the iterator protocol
   * @param context - The VM context in which the iterator exists
   */
  constructor(
    public handle: VMValue,
    public context: VMContext
  ) {
    this.owner = context.runtime;
  }

  /**
   * Returns this iterator instance, making VMIterator both an Iterable and Iterator.
   *
   * This enables using VMIterator with for-of loops.
   *
   * @returns This iterator instance
   */
  [Symbol.iterator]() {
    return this;
  }

  /**
   * Gets the next value in the iteration sequence.
   *
   * This method calls the 'next' method on the VM iterator and processes its result
   * to conform to the JavaScript iterator protocol in the host environment.
   *
   * @param value - Optional value to pass to the iterator's next method
   * @returns An iterator result object with the next value and done status
   */
  next(value?: VMValue): IteratorResult<VMContextResult<VMValue>, unknown> {
    if (!this.alive || this._isDone) {
      return {
        done: true,
        value: undefined,
      };
    }

    // Lazily retrieve and cache the 'next' method
    if (this._next === undefined) {
      this._next = this.handle.getProperty("next");
    }
    const nextMethod = this._next;
    return this.callIteratorMethod(nextMethod, value);
  }

  /**
   * Properly terminates the iterator and returns a final value.
   *
   * If the VM iterator has a 'return' method, this calls that method.
   * This method is automatically called by for-of loops when breaking out
   * of the loop early, allowing for proper resource cleanup.
   *
   * @param value - Optional value to pass to the iterator's return method
   * @returns An iterator result object marking the iterator as done
   */
  return(value?: VMValue): IteratorResult<VMContextResult<VMValue>, unknown> {
    if (!this.alive) {
      return {
        done: true,
        value: undefined,
      };
    }

    const returnMethod = this.handle.getProperty("return");
    if (returnMethod.isUndefined() && value === undefined) {
      // This may be an automatic call by the host Javascript engine,
      // but the guest iterator doesn't have a `return` method.
      // Don't call it then.
      this.dispose();
      return {
        done: true,
        value: undefined,
      };
    }

    const result = this.callIteratorMethod(returnMethod, value);
    returnMethod.dispose();
    this.dispose();
    return result;
  }

  /**
   * Signals an error to the iterator and terminates iteration.
   *
   * If the VM iterator has a 'throw' method, this calls that method to propagate
   * an error into the iterator, which might trigger catch blocks inside generator
   * functions in the VM.
   *
   * @param e - Error or VMValue to throw into the iterator
   * @returns An iterator result object with the error result
   * @throws {TypeError} If the error is neither an Error nor a VMValue
   */
  throw(e?: unknown): IteratorResult<VMContextResult<VMValue>, unknown> {
    if (!this.alive) {
      return {
        done: true,
        value: undefined,
      };
    }

    if (!(e instanceof Error) && !(e instanceof VMValue)) {
      throw new TypeError(
        "throw() argument must be an Error or VMValue. How did it come to this?"
      );
    }

    const errorHandle = e instanceof VMValue ? e : this.context.newError(e);
    const throwMethod = this.handle.getProperty("throw");
    const result = this.callIteratorMethod(throwMethod, errorHandle);
    if (errorHandle.alive) {
      errorHandle.dispose();
    }
    throwMethod.dispose();
    this.dispose();
    return result;
  }

  /**
   * Checks if the iterator is still alive and not disposed.
   *
   * @returns True if the iterator handle is still alive, false otherwise
   */
  get alive() {
    return this.handle.alive;
  }

  /**
   * Disposes of all resources associated with this iterator.
   *
   * This method is idempotent - calling it multiple times has no additional effect.
   * It ensures that all handles are properly disposed.
   */
  dispose() {
    this._isDone = true;
    this.handle.dispose();
    if (this._next?.alive) {
      this._next.dispose();
    }
  }

  /**
   * Implements the Symbol.dispose method for the Disposable interface.
   *
   * This allows the iterator to be used with the using statement
   * in environments that support the Disposable pattern.
   */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * Helper method to call an iterator protocol method and process its result.
   *
   * This handles calling 'next', 'return', or 'throw' on the VM iterator and
   * processes the result to conform to the JavaScript iterator protocol.
   *
   * @param method - The VM method to call (next, return, or throw)
   * @param input - Optional value to pass to the method
   * @returns An iterator result object
   * @private
   */
  private callIteratorMethod(
    method: VMValue,
    input?: VMValue
  ): IteratorResult<VMContextResult<VMValue>, unknown> {
    // Call the method on the VM iterator
    const callResult = input
      ? this.context.callFunction(method, this.handle, input)
      : this.context.callFunction(method, this.handle);

    // If an error occurred, dispose the iterator and return the error
    if (callResult.error) {
      this.dispose();
      return {
        value: callResult,
      };
    }

    // Check the 'done' property to determine if iteration is complete
    using done = callResult.value
      .getProperty("done")
      .consume((v) => v.toNativeValue<boolean>());

    if (done.value) {
      // If done, dispose resources and return done
      callResult.value.dispose();
      this.dispose();
      return {
        done: done.value,
        value: undefined,
      };
    }

    // Extract the 'value' property and return it with done status
    const value = callResult.value.getProperty("value");
    callResult.dispose();
    return {
      value: DisposableResult.success(value),
      done: done.value,
    };
  }
}
