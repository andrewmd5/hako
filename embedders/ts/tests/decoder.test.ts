import { describe, expect, it } from "bun:test";
import { decodeVariant, HAKO_DEBUG } from "../src";

describe("Decoder", () => {
  it("should decode the debug variant", () => {
    expect(() => decodeVariant(HAKO_DEBUG)).not.toThrow();
  });
});
