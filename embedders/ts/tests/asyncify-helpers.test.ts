import { describe, expect, it } from "vitest";
import { maybeAsyncFn } from "../src/helpers/asyncify-helpers";

describe("maybeAsync", () => {
  const addPromises = maybeAsyncFn(
    undefined,
    function* (
      awaited,
      a: number | Promise<number>,
      b: number | Promise<number>
    ) {
      return (yield* awaited(a)) + (yield* awaited(b));
    }
  );

  it("has sync output for sync inputs", () => {
    const sum2 = addPromises(5, 6);
    expect(sum2).toBe(11);
  });

  it("has async output for async inputs", async () => {
    const result = addPromises(Promise.resolve(1), 2);
    expect(result).toBeInstanceOf(Promise);
    const sum = await result;
    expect(sum).toBe(3);
  });

  it("throws any sync errors", () => {
    // eslint-disable-next-line require-yield
    // biome-ignore lint/correctness/useYield: <explanation>
    const fn = maybeAsyncFn(undefined, function* () {
      throw new Error("sync error");
    });

    expect(() => fn()).toThrowError(/sync error/);
  });

  it("it throws async errors", async () => {
    const fn = maybeAsyncFn(undefined, function* (awaited) {
      yield* awaited(new Promise((resolve) => setTimeout(resolve, 50)));
      throw new Error("async error");
    });

    try {
      await fn();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("async error");
    }
  });
});
