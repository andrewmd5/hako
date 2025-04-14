/**
 * Yields a value that may be a Promise, and resumes with the resolved value.
 * This is a helper generator function that enables Promise-aware yielding in
 * generator-based async flows.
 *
 * @template T - The type of the value being yielded or resolved from the Promise
 * @param value - A value or Promise to yield
 * @returns The resolved value after yielding
 */
function* awaitYield<T>(value: T | Promise<T>) {
  return (yield value) as T;
}

/**
 * Transforms a generator that yields values or promises into a generator
 * that handles the promises internally and yields only resolved values.
 *
 * @template T - The return type of the original generator
 * @template Yielded - The type of values yielded by the original generator
 * @param generator - The source generator that may yield promises
 * @returns A new generator that yields resolved values
 */
function awaitYieldOf<T, Yielded>(
  generator: Generator<Yielded | Promise<Yielded>, T, Yielded>
): Generator<T | Promise<T>, T, T> {
  return awaitYield(awaitEachYieldedPromise(generator));
}

/**
 * Extended type for the awaitYield function that includes the 'of' method.
 */
export type AwaitYield = typeof awaitYield & {
  /**
   * Transforms a generator that yields values or promises into a generator
   * that handles the promises internally.
   */
  of: typeof awaitYieldOf;
};

/**
 * Helper utility for working with generators that may yield promises.
 * Provides methods for awaiting yielded values in generator-based async flows.
 */
const AwaitYield: AwaitYield = awaitYield as AwaitYield;
AwaitYield.of = awaitYieldOf;

/**
 * Creates a function that may or may not be async, using a generator-based approach.
 *
 * This utility allows writing functions that can handle both synchronous and
 * asynchronous operations with a unified syntax. If any yielded value is a Promise,
 * the function will return a Promise. Otherwise, it returns synchronously.
 *
 * Within the generator, call `yield awaited(maybePromise)` to await a value
 * that may or may not be a promise.
 *
 * @template Args - Type of the function arguments
 * @template This - Type of 'this' context
 * @template Return - Function return type
 * @template Yielded - Type of values yielded in the generator
 *
 * @param that - The 'this' context to bind to the generator function
 * @param fn - Generator function that implements the potentially async logic
 * @returns A function that returns either the result directly or a Promise of the result
 *
 * @example
 * ```typescript
 * class Example {
 *   private delay = maybeAsyncFn(this, function* (awaited, ms: number) {
 *     yield awaited(new Promise(resolve => setTimeout(resolve, ms)));
 *     return "Done waiting";
 *   });
 *
 *   async test() {
 *     // Will return a Promise because it contains an async operation
 *     const result = await this.delay(1000);
 *     console.log(result); // "Done waiting"
 *   }
 * }
 * ```
 */
export function maybeAsyncFn<
  /** Function arguments */
  Args extends unknown[],
  This,
  /** Function return type */
  Return,
  /** Yields to unwrap */
  Yielded,
>(
  that: This,
  fn: (
    this: This,
    awaited: AwaitYield,
    ...args: Args
  ) => Generator<Yielded | Promise<Yielded>, Return, Yielded>
): (...args: Args) => Return | Promise<Return> {
  return (...args: Args) => {
    const generator = fn.call(that, AwaitYield, ...args);
    return awaitEachYieldedPromise(generator);
  };
}

/**
 * Type definition for a generator block that can be used with maybeAsync/maybeAsyncFn.
 *
 * @template Return - The return type of the generator
 * @template This - The type of 'this' context
 * @template Yielded - The type of values yielded by the generator
 * @template Args - Optional array of additional argument types
 */
export type MaybeAsyncBlock<
  Return,
  This,
  Yielded,
  Args extends unknown[] = [],
> = (
  this: This,
  awaited: AwaitYield,
  ...args: Args
) => Generator<Yielded | Promise<Yielded>, Return, Yielded>;

/**
 * Executes a generator function that may contain asynchronous operations.
 *
 * This is a simpler version of maybeAsyncFn for one-off executions,
 * rather than creating a reusable function.
 *
 * @template Return - The return type of the generator
 * @template This - The type of 'this' context
 * @template Yielded - The type of values yielded by the generator
 *
 * @param that - The 'this' context to bind to the generator function
 * @param startGenerator - Generator function that implements the potentially async logic
 * @returns Either the result directly or a Promise of the result
 *
 * @example
 * ```typescript
 * const result = maybeAsync(this, function* (awaited) {
 *   const data = yield awaited(fetch('https://example.com').then(r => r.json()));
 *   return data.title;
 * });
 * ```
 */
export function maybeAsync<Return, This, Yielded>(
  that: This,
  startGenerator: (
    this: This,
    awaited: AwaitYield
  ) => Generator<Yielded | Promise<Yielded>, Return, Yielded>
): Return | Promise<Return> {
  const generator = startGenerator.call(that, AwaitYield);
  return awaitEachYieldedPromise(generator);
}

/**
 * Core utility that processes a generator by awaiting any Promises that are yielded.
 *
 * This function drives the execution of a generator, handling both synchronous values
 * and Promises that may be yielded. If any yielded value is a Promise, the function
 * awaits its resolution before continuing the generator. If all yielded values
 * are synchronous, the function returns synchronously.
 *
 * @template Yielded - The type of values yielded by the generator
 * @template Returned - The return type of the generator
 *
 * @param gen - The generator to process
 * @returns Either the final result directly or a Promise of the final result
 */
export function awaitEachYieldedPromise<Yielded, Returned>(
  gen: Generator<Yielded | Promise<Yielded>, Returned, Yielded>
): Returned | Promise<Returned> {
  type NextResult = ReturnType<typeof gen.next>;

  /**
   * Processes each step of the generator.
   *
   * @param step - The result of the previous generator.next() call
   * @returns The final result or a Promise leading to the next step
   */
  function handleNextStep(step: NextResult): Returned | Promise<Returned> {
    if (step.done) {
      return step.value;
    }

    if (step.value instanceof Promise) {
      return step.value.then(
        (value) => handleNextStep(gen.next(value)),
        (error) => handleNextStep(gen.throw(error))
      );
    }

    return handleNextStep(gen.next(step.value));
  }

  return handleNextStep(gen.next());
}
