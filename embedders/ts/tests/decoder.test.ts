import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { decodeVariant, HAKO_DEBUG } from "../src";
describe("Decoder", () => {
  it("should decode the debug variant", () => {
    const module = decodeVariant(HAKO_DEBUG);
  });
});
