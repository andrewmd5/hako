import type { VMContext } from "@hako/vm/context";
import type { HakoRuntime } from "@hako/runtime/runtime";
import type { VMValue } from "@hako/vm/value";

/**
 * Represents a Promise in the "pending" state.
 *
 * This interface is part of the JSPromiseState union type that represents
 * all possible states of a JavaScript Promise in the PrimJS engine.
 *
 * @see {@link JSPromiseState}
 */
export interface JSPromiseStatePending {
  /**
   * Discriminator property indicating this is a pending promise state.
   */
  type: "pending";

  /**
   * The error property here allows unwrapping a JSPromiseState with {@link VMContext#unwrapResult}.
   * Unwrapping a pending promise will throw a {@link PrimJSError}.
   *
   * This is a getter that creates an error on demand rather than storing one permanently.
   */
  get error(): Error;
}

/**
 * Represents a Promise in the "fulfilled" state.
 *
 * This interface is part of the JSPromiseState union type that represents
 * all possible states of a JavaScript Promise in the PrimJS engine.
 *
 * @see {@link JSPromiseState}
 */
export interface JSPromiseStateFulfilled {
  /**
   * Discriminator property indicating this is a fulfilled promise state.
   */
  type: "fulfilled";

  /**
   * The value with which the Promise was fulfilled.
   */
  value: VMValue;

  /**
   * Error is undefined for fulfilled promises.
   */
  error?: undefined;

  /**
   * Indicates that the original value wasn't actually a Promise.
   *
   * When attempting to get the promise state of a non-Promise value,
   * the system returns a fulfilled state containing the original value,
   * with this flag set to true.
   */
  notAPromise?: boolean;
}

/**
 * Represents a Promise in the "rejected" state.
 *
 * This interface is part of the JSPromiseState union type that represents
 * all possible states of a JavaScript Promise in the PrimJS engine.
 *
 * @see {@link JSPromiseState}
 */
export interface JSPromiseStateRejected {
  /**
   * Discriminator property indicating this is a rejected promise state.
   */
  type: "rejected";

  /**
   * The error value with which the Promise was rejected.
   */
  error: VMValue;
}

/**
 * Deferred Promise implementation for the Hako runtime.
 *
 * HakoDeferredPromise wraps a PrimJS promise {@link handle} and allows
 * {@link resolve}ing or {@link reject}ing that promise. Use it to bridge asynchronous
 * code on the host to APIs inside a VMContext.
 *
 * Managing the lifetime of promises is tricky. There are three
 * {@link PrimJSHandle}s inside of each deferred promise object: (1) the promise
 * itself, (2) the `resolve` callback, and (3) the `reject` callback.
 *
 * Proper cleanup depends on the usage scenario:
 *
 * - If the promise will be fulfilled before the end of it's {@link owner}'s lifetime,
 *   the only cleanup necessary is `deferred.handle.dispose()`, because
 *   calling {@link resolve} or {@link reject} will dispose of both callbacks automatically.
 *
 * - As the return value of a {@link VmFunctionImplementation}, return {@link handle},
 *   and ensure that either {@link resolve} or {@link reject} will be called. No other
 *   clean-up is necessary.
 *
 * - In other cases, call {@link dispose}, which will dispose {@link handle} as well as the
 *   PrimJS handles that back {@link resolve} and {@link reject}. For this object,
 *   {@link dispose} is idempotent.
 *
 * @implements {Disposable} - Implements the Disposable interface for resource cleanup
 */
export class HakoDeferredPromise implements Disposable {
  /**
   * Reference to the runtime that owns this promise.
   */
  public owner: HakoRuntime;

  /**
   * Reference to the context in which this promise was created.
   */
  public context: VMContext;

  /**
   * A handle of the Promise instance inside the VMContext.
   *
   * You must dispose {@link handle} or the entire HakoDeferredPromise once you
   * are finished with it to prevent memory leaks.
   */
  public handle: VMValue;

  /**
   * A native JavaScript Promise that will resolve once this deferred promise is settled.
   *
   * This can be used to await the settlement of the promise from the host environment.
   */
  public settled: Promise<void>;

  /**
   * Handle to the resolve function for the promise.
   * @private
   */
  private resolveHandle: VMValue;

  /**
   * Handle to the reject function for the promise.
   * @private
   */
  private rejectHandle: VMValue;

  /**
   * Callback function to resolve the settled promise.
   * @private
   */
  private onSettled!: () => void;

  /**
   * Creates a new HakoDeferredPromise.
   *
   * Use {@link VMContext#newPromise} to create a new promise instead of calling
   * this constructor directly.
   *
   * @param args - Configuration object containing the necessary handles
   * @param args.context - The VM context in which the promise exists
   * @param args.promiseHandle - Handle to the Promise object in the VM
   * @param args.resolveHandle - Handle to the resolve function in the VM
   * @param args.rejectHandle - Handle to the reject function in the VM
   */
  constructor(args: {
    context: VMContext;
    promiseHandle: VMValue;
    resolveHandle: VMValue;
    rejectHandle: VMValue;
  }) {
    this.context = args.context;
    this.owner = args.context.runtime;
    this.handle = args.promiseHandle;
    this.settled = new Promise((resolve) => {
      this.onSettled = resolve;
    });
    this.resolveHandle = args.resolveHandle;
    this.rejectHandle = args.rejectHandle;
  }

  /**
   * Resolves the promise with the given value.
   *
   * This method calls the resolve function in the VM with the provided value.
   * If no value is provided, undefined is used.
   *
   * Calling this method after calling {@link dispose} is a no-op.
   *
   * Note that after resolving a promise, you may need to call
   * {@link PrimJSRuntime#executePendingJobs} to propagate the result to the promise's
   * callbacks.
   *
   * @param value - Optional value to resolve the promise with
   */
  resolve = (value?: VMValue) => {
    if (!this.resolveHandle.alive) {
      return;
    }

    this.context
      .unwrapResult(
        this.context.callFunction(
          this.resolveHandle,
          this.context.undefined(),
          value || this.context.undefined()
        )
      )
      .dispose();

    this.disposeResolvers();
    this.onSettled();
  };

  /**
   * Rejects the promise with the given value.
   *
   * This method calls the reject function in the VM with the provided value.
   * If no value is provided, undefined is used.
   *
   * Calling this method after calling {@link dispose} is a no-op.
   *
   * Note that after rejecting a promise, you may need to call
   * {@link PrimJSRuntime#executePendingJobs} to propagate the result to the promise's
   * callbacks.
   *
   * @param value - Optional value to reject the promise with
   */
  reject = (value?: VMValue) => {
    if (!this.rejectHandle.alive) {
      return;
    }

    this.context
      .unwrapResult(
        this.context.callFunction(
          this.rejectHandle,
          this.context.undefined(),
          value || this.context.undefined()
        )
      )
      .dispose();

    this.disposeResolvers();
    this.onSettled();
  };

  /**
   * Checks if any of the handles associated with this promise are still alive.
   *
   * @returns True if any of the promise, resolve, or reject handles are still alive
   */
  get alive() {
    return (
      this.handle.alive || this.resolveHandle.alive || this.rejectHandle.alive
    );
  }

  /**
   * Disposes of all resources associated with this promise.
   *
   * This method is idempotent - calling it multiple times has no additional effect.
   * It ensures that all handles (promise, resolve, and reject) are properly disposed.
   */
  dispose = () => {
    if (this.handle.alive) {
      this.handle.dispose();
    }
    this.disposeResolvers();
  };

  /**
   * Helper method to dispose of the resolver and rejecter handles.
   * @private
   */
  private disposeResolvers() {
    if (this.resolveHandle.alive) {
      this.resolveHandle.dispose();
    }

    if (this.rejectHandle.alive) {
      this.rejectHandle.dispose();
    }
  }

  /**
   * Implements the Symbol.dispose method for the Disposable interface.
   *
   * This allows the deferred promise to be used with the using statement
   * in environments that support the Disposable pattern.
   */
  [Symbol.dispose](): void {
    this.dispose();
  }
}
