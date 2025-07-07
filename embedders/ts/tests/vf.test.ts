import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHakoRuntime } from "../src/";
import { HakoError } from "../src/etc/errors";
import type { HostCallbackFunction } from "../src/etc/types";
import type { HakoRuntime } from "../src/host/runtime";
import type { VMContext } from "../src/vm/context";
import type { VMValue } from "../src/vm/value";

describe("ValueFactory", () => {
  let runtime: HakoRuntime;
  let context: VMContext;

  // Helper to load WASM binary
  const loadWasmBinary = async () => {
    // Adjust the path as necessary for your project
    const wasmPath = await Bun.file("../../bridge/build/hako.wasm").bytes();

    return wasmPath;
  };

  beforeEach(async () => {
    // Initialize Hako with real WASM binary
    const wasmBinary = await loadWasmBinary();
    runtime = await createHakoRuntime({
      wasm: {
        io: {
          stdout: (lines) => console.log(lines),
          stderr: (lines) => console.error(lines),
        },
      },
      loader: {
        binary: wasmBinary,
      },
    });
    context = runtime.createContext();
  });

  afterEach(() => {
    // Clean up resources
    if (context) {
      context.release();
    }
    if (runtime) {
      runtime.release();
    }
  });

  // Primitive Value Tests
  describe("Primitive Values", () => {
    it("should create undefined value", () => {
      using undefinedVal = context.newValue(undefined);
      expect(undefinedVal.isUndefined()).toBe(true);
    });

    it("should create null value", () => {
      using nullVal = context.newValue(null);
      expect(nullVal.isNull()).toBe(true);
    });

    it("should create true boolean value", () => {
      using trueVal = context.newValue(true);
      expect(trueVal.isBoolean()).toBe(true);
      expect(trueVal.asBoolean()).toBe(true);
    });

    it("should create false boolean value", () => {
      using falseVal = context.newValue(false);
      expect(falseVal.isBoolean()).toBe(true);
      expect(falseVal.asBoolean()).toBe(false);
    });

    it("should create integer number value", () => {
      using intVal = context.newValue(42);
      expect(intVal.isNumber()).toBe(true);
      expect(intVal.asNumber()).toBe(42);
    });

    it("should create floating point number value", () => {
      using floatVal = context.newValue(42.5);
      expect(floatVal.isNumber()).toBe(true);
      expect(floatVal.asNumber()).toBe(42.5);
    });

    it("should create large number value", () => {
      using largeNum = context.newValue(1234567890.123456);
      expect(largeNum.isNumber()).toBe(true);
      expect(largeNum.asNumber()).toBeCloseTo(1234567890.123456);
    });

    it("should create negative number value", () => {
      using negNum = context.newValue(-42.5);
      expect(negNum.isNumber()).toBe(true);
      expect(negNum.asNumber()).toBe(-42.5);
    });

    it("should create string value", () => {
      using strVal = context.newValue("hello");
      expect(strVal.isString()).toBe(true);
      expect(strVal.asString()).toBe("hello");
    });

    it("should create empty string value", () => {
      using emptyStr = context.newValue("");
      expect(emptyStr.isString()).toBe(true);
      expect(emptyStr.asString()).toBe("");
    });

    it("should create string with special characters", () => {
      using specialStr = context.newValue("hello\nworld\t\"'\\");
      expect(specialStr.isString()).toBe(true);
      expect(specialStr.asString()).toBe("hello\nworld\t\"'\\");
    });
  });

  // Object Tests
  describe("Objects", () => {
    it("should create empty object", () => {
      using emptyObj = context.newValue({});
      expect(emptyObj.isObject()).toBe(true);
      for (const prop of emptyObj.getOwnPropertyNames()) {
        prop.dispose();
      }
    });

    it("should create object with string property", () => {
      using obj = context.newValue({ name: "test" });
      expect(obj.isObject()).toBe(true);

      using nameVal = obj.getProperty("name");
      expect(nameVal.isString()).toBe(true);
      expect(nameVal.asString()).toBe("test");
    });

    it("should create object with number property", () => {
      using obj = context.newValue({ value: 42 });
      expect(obj.isObject()).toBe(true);

      using valueVal = obj.getProperty("value");
      expect(valueVal.isNumber()).toBe(true);
      expect(valueVal.asNumber()).toBe(42);
    });

    it("should create object with boolean property", () => {
      using obj = context.newValue({ isActive: true });
      expect(obj.isObject()).toBe(true);

      using boolVal = obj.getProperty("isActive");
      expect(boolVal.isBoolean()).toBe(true);
      expect(boolVal.asBoolean()).toBe(true);
    });

    it("should create object with null property", () => {
      using obj = context.newValue({ nullProp: null });
      expect(obj.isObject()).toBe(true);

      using nullVal = obj.getProperty("nullProp");
      expect(nullVal.isNull()).toBe(true);
    });

    it("should create object with nested object", () => {
      using obj = context.newValue({
        nested: { inner: true },
      });
      expect(obj.isObject()).toBe(true);

      using nestedVal = obj.getProperty("nested");
      expect(nestedVal.isObject()).toBe(true);

      using innerVal = nestedVal.getProperty("inner");
      expect(innerVal.isBoolean()).toBe(true);
      expect(innerVal.asBoolean()).toBe(true);
    });

    it("should create object with multiple properties", () => {
      using obj = context.newValue({
        name: "test",
        value: 42,
        isActive: true,
      });

      using nameVal = obj.getProperty("name");
      using valueVal = obj.getProperty("value");
      using isActiveVal = obj.getProperty("isActive");

      expect(nameVal.asString()).toBe("test");
      expect(valueVal.asNumber()).toBe(42);
      expect(isActiveVal.asBoolean()).toBe(true);
    });
  });

  // Array Tests
  describe("Arrays", () => {
    it("should create empty array", () => {
      using emptyArr = context.newValue([]);
      expect(emptyArr.isArray()).toBe(true);

      using lengthProp = emptyArr.getProperty("length");
      expect(lengthProp.asNumber()).toBe(0);
    });

    it("should create array with primitive elements", () => {
      using arr = context.newValue([1, "two", true, null]);
      expect(arr.isArray()).toBe(true);

      using lengthProp = arr.getProperty("length");
      expect(lengthProp.asNumber()).toBe(4);

      using elem0 = arr.getProperty(0);
      using elem1 = arr.getProperty(1);
      using elem2 = arr.getProperty(2);
      using elem3 = arr.getProperty(3);

      expect(elem0.asNumber()).toBe(1);
      expect(elem1.asString()).toBe("two");
      expect(elem2.asBoolean()).toBe(true);
      expect(elem3.isNull()).toBe(true);
    });

    it("should create array with nested array", () => {
      using arr = context.newValue([1, [2, 3]]);
      expect(arr.isArray()).toBe(true);

      using nestedArr = arr.getProperty(1);
      expect(nestedArr.isArray()).toBe(true);

      using nestedLen = nestedArr.getProperty("length");
      expect(nestedLen.asNumber()).toBe(2);

      using nestedElem0 = nestedArr.getProperty(0);
      using nestedElem1 = nestedArr.getProperty(1);

      expect(nestedElem0.asNumber()).toBe(2);
      expect(nestedElem1.asNumber()).toBe(3);
    });

    it("should create array with object element", () => {
      using arr = context.newValue([{ key: "value" }]);

      using objElem = arr.getProperty(0);
      expect(objElem.isObject()).toBe(true);

      using keyProp = objElem.getProperty("key");
      expect(keyProp.asString()).toBe("value");
    });

    it("should create array with mixed types", () => {
      using arr = context.newValue([
        1,
        "string",
        true,
        null,
        [1, 2],
        { key: "value" },
      ]);

      using elem0 = arr.getProperty(0);
      using elem1 = arr.getProperty(1);
      using elem2 = arr.getProperty(2);
      using elem3 = arr.getProperty(3);
      using elem4 = arr.getProperty(4);
      using elem5 = arr.getProperty(5);

      expect(elem0.isNumber()).toBe(true);
      expect(elem1.isString()).toBe(true);
      expect(elem2.isBoolean()).toBe(true);
      expect(elem3.isNull()).toBe(true);
      expect(elem4.isArray()).toBe(true);
      expect(elem5.isObject()).toBe(true);
    });
  });

  // Function Tests
  describe("Functions", () => {
    it("should create function", () => {
      const testFn: HostCallbackFunction<VMValue> = () => {
        return context.newValue("result");
      };

      using fnVal = context.newValue(testFn, { name: "testFn" });
      expect(fnVal.isFunction()).toBe(true);
    });

    it("should create function and call it with no arguments", () => {
      const testFn: HostCallbackFunction<VMValue> = () => {
        return context.newValue("result");
      };

      using fnVal = context.newValue(testFn, { name: "testFn" });
      using result = context.callFunction(fnVal, null);

      expect(result.error).toBeUndefined();
      expect(result.unwrap().asString()).toBe("result");
    });

    it("should create function and call it with arguments", () => {
      const testFn: HostCallbackFunction<VMValue> = (
        x: VMValue,
        y: VMValue
      ) => {
        const numX = x.asNumber();
        const numY = y.asNumber();
        return context.newValue(numX + numY);
      };

      using fnVal = context.newValue(testFn, { name: "testFn" });
      using arg1 = context.newValue(5);
      using arg2 = context.newValue(7);
      using result = context.callFunction(fnVal, null, arg1, arg2);

      expect(result.error).toBeUndefined();
      expect(result.unwrap().asNumber()).toBe(12);
    });

    it("should create function that returns undefined", () => {
      const testFn: HostCallbackFunction<VMValue> = () => {
        return context.newValue(undefined);
      };

      using fnVal = context.newValue(testFn, { name: "testFn" });

      using result = context.callFunction(fnVal, undefined);

      expect(result.error).toBeUndefined();
      expect(result.unwrap().isUndefined()).toBe(true);
    });
  });

  // BigInt Tests
  describe("BigInt", () => {
    it("should create positive BigInt", () => {
      if (!runtime.build.hasBignum) {
        expect(() => {
          context.newValue(9007199254740991n);
        }).toThrow(HakoError);
      } else {
        const bigIntValue = 9007199254740991n; // Maximum safe integer as BigInt
        using bigIntVal = context.newValue(bigIntValue);
        expect(bigIntVal.asString()).toBe("9007199254740991");
      }
    });

    it("should create negative BigInt", () => {
      if (!runtime.build.hasBignum) {
        expect(() => {
          context.newValue(-9007199254740991n);
        }).toThrow(HakoError);
      } else {
        const negativeBigInt = -9007199254740991n;
        using negBigIntVal = context.newValue(negativeBigInt);

        expect(negBigIntVal.asString()).toBe("-9007199254740991");
      }
    });

    it("should create BigInt larger than 32-bit", () => {
      if (!runtime.build.hasBignum) {
        expect(() => {
          context.newValue(12345678901234567890n);
        }).toThrow(HakoError);
      } else {
        const largeBigInt = 12345678901234567890n;
        using largeBigIntVal = context.newValue(largeBigInt);

        expect(largeBigIntVal.asString()).toBe("12345678901234567890");
      }
    });
  });

  // Symbol Tests
  describe("Symbol", () => {
    it("should create Symbol with description", () => {
      const jsSymbol = Symbol("testSymbol");
      using symbolVal = context.newValue(jsSymbol);

      expect(symbolVal.isSymbol()).toBe(true);
    });

    it("should create Symbol without description", () => {
      const jsSymbol = Symbol();
      using symbolVal = context.newValue(jsSymbol);

      expect(symbolVal.isSymbol()).toBe(true);
    });

    it("should use Symbol as object property", () => {
      const jsSymbol = Symbol("testSymbol");
      using symbolVal = context.newValue(jsSymbol);
      using obj = context.newValue({});

      obj.setProperty(symbolVal, "symbolValue");
      using propVal = obj.getProperty(symbolVal);

      expect(propVal.asString()).toBe("symbolValue");
    });

    it("should create global Symbol", () => {
      const jsSymbol = Symbol.for("globalTestSymbol");
      using symbolVal = context.newSymbol(jsSymbol, true);

      expect(symbolVal.isSymbol()).toBe(true);
      expect(symbolVal.isGlobalSymbol()).toBe(true);

      using obj = context.newValue({});
      obj.setProperty(symbolVal, "symbolValue");
      using propVal = obj.getProperty(symbolVal);
      expect(propVal.asString()).toBe("symbolValue");

      using eqSymbol = context.newSymbol(jsSymbol, true);
    });
  });

  // Date Tests
  describe("Date", () => {
    it("should create Date object", () => {
      const jsDate = new Date("2023-01-01T00:00:00Z");
      using dateVal = context.newValue(jsDate);
      expect(dateVal.classId()).toBe(10);
    });
    it("should handle current Date", () => {
      const now = new Date();
      using dateVal = context.newValue(now);

      using evalResult = context.evalCode(`
                (function(date) {
                    return date.valueOf();
                })
            `);

      using evalFn = evalResult.unwrap();
      using result = context.callFunction(evalFn, null, dateVal);

      expect(result.unwrap().asNumber()).toBe(now.valueOf());
    });
  });

  // ArrayBuffer Tests
  describe("ArrayBuffer", () => {
    it("should create ArrayBuffer", () => {
      const buffer = new ArrayBuffer(4);
      using bufferVal = context.newValue(buffer);

      expect(bufferVal.isArrayBuffer()).toBe(true);
    });

    it("should create Uint8Array", () => {
      const uint8Array = new Uint8Array([1, 2, 3, 4, 5]);
      using arrayVal = context.newValue(uint8Array);

      expect(arrayVal.isArrayBuffer()).toBe(true);

      const returnedBuffer = arrayVal.copyArrayBuffer();
      expect(returnedBuffer).toBeDefined();

      expect(returnedBuffer).toEqual(uint8Array.buffer);
    });

    it("should create Int32Array", () => {
      const int32Array = new Int32Array([10, 20, 30]);
      using int32Val = context.newValue(int32Array);

      const int32Buffer = int32Val.copyArrayBuffer();
      expect(int32Buffer).toBeDefined();

      const dv = new DataView(int32Buffer);
      expect(dv.getInt32(0, true)).toBe(10);
      expect(dv.getInt32(4, true)).toBe(20);
      expect(dv.getInt32(8, true)).toBe(30);
    });

    it("should create empty ArrayBuffer", () => {
      const emptyBuffer = new ArrayBuffer(0);
      using emptyVal = context.newValue(emptyBuffer);

      expect(emptyVal.isArrayBuffer()).toBe(true);

      const returnedBuffer = emptyVal.copyArrayBuffer();
      expect(returnedBuffer).toBeDefined();

      expect(returnedBuffer.byteLength).toBe(0);
    });
  });

  // Error Tests
  describe("Error", () => {
    it("should create Error object", () => {
      const jsError = new Error("Test error message");
      using errorVal = context.newValue(jsError);

      using message = errorVal.getProperty("message");
      expect(message.asString()).toEqual(jsError.message);
    });

    it("should preserve Error name", () => {
      const jsError = new Error("Test error");
      using errorVal = context.newValue(jsError);

      using name = errorVal.getProperty("name");
      expect(name.asString()).toEqual(jsError.name);
    });

    it("should preserve Error stack", () => {
      const jsError = new Error("Test error");
      using errorVal = context.newValue(jsError);

      using stack = errorVal.getProperty("stack");
      expect(jsError.stack).toBeDefined();
      expect(stack.asString()).toEqual(jsError.stack as string);
    });

    it("should create Error with cause", () => {
      const causeError = new Error("Cause error");
      const errorWithCause = new Error("Main error", { cause: causeError });
      using errorVal = context.newValue(errorWithCause);

      using message = errorVal.getProperty("message");
      expect(message.asString()).toEqual(errorWithCause.message);
      using cause = errorVal.getProperty("cause");
      expect(cause.isError()).toBe(true);
      using causeMessage = cause.getProperty("message");
      expect(causeMessage.asString()).toEqual(causeError.message);
    });

    it("should create TypeError", () => {
      const typeError = new TypeError("Type error message");
      using errorVal = context.newValue(typeError);

      using message = errorVal.getProperty("message");
      using name = errorVal.getProperty("name");

      expect(message.asString()).toBe("Type error message");
      expect(name.asString()).toBe("TypeError");
    });
  });

  // Complex Object Tests
  describe("Complex Objects", () => {
    it("should create object with deeply nested structure", () => {
      using obj = context.newValue({
        level1: {
          level2: {
            level3: {
              value: 42,
            },
          },
        },
      });

      using level1 = obj.getProperty("level1");
      using level2 = level1.getProperty("level2");
      using level3 = level2.getProperty("level3");
      using value = level3.getProperty("value");

      expect(value.asNumber()).toBe(42);
    });

    it("should create object with array of objects", () => {
      using obj = context.newValue({
        items: [
          { id: 1, name: "Item 1" },
          { id: 2, name: "Item 2" },
        ],
      });

      using items = obj.getProperty("items");
      using item0 = items.getProperty(0);
      using item1 = items.getProperty(1);

      using id0 = item0.getProperty("id");
      using name0 = item0.getProperty("name");
      using id1 = item1.getProperty("id");
      using name1 = item1.getProperty("name");

      expect(id0.asNumber()).toBe(1);
      expect(name0.asString()).toBe("Item 1");
      expect(id1.asNumber()).toBe(2);
      expect(name1.asString()).toBe("Item 2");
    });

    it("should catch circular reference", () => {
      const obj: any = { name: "circular" };
      obj.self = obj; // circular reference
      expect(() => {
        using circular = context.newValue(obj);
      }).toThrow(TypeError);
    });
  });
});
