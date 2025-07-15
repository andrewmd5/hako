import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHakoRuntime, decodeVariant, HAKO_PROD } from "../src";
import type { HakoExports } from "../src/etc/ffi";
import type { ModuleLoaderFunction, TraceEvent } from "../src/etc/types";
import type { HakoRuntime } from "../src/host/runtime";
import { DisposableResult } from "../src/mem/lifetime";
import type { MemoryManager } from "../src/mem/memory";
import type { VMContext } from "../src/vm/context";
import { VMValue } from "../src/vm/value";

const createTraceProfiler = () => {
  // Array to store all trace events
  const events: TraceEvent[] = [];

  // Flag to enable/disable profiling
  let isEnabled = false;

  return {
    /**
     * Handler for function start events
     */
    onFunctionStart: (
      _context: VMContext,
      event: TraceEvent,
      _opaque: number
    ): void => {
      if (isEnabled) {
        events.push(event);
      }
    },

    /**
     * Handler for function end events
     */
    onFunctionEnd: (
      _context: VMContext,
      event: TraceEvent,
      _opaque: number
    ): void => {
      if (isEnabled) {
        events.push(event);
      }
    },

    /**
     * Controls whether profiling is enabled
     */
    setEnabled: (enabled: boolean): void => {
      isEnabled = enabled;
    },

    /**
     * Gets all collected trace events as a JSON string
     */
    getTraceJson: (): string => {
      // Format events according to Trace Event Format
      const traceObject = {
        traceEvents: events,
        displayTimeUnit: "ms",
      };
      return JSON.stringify(traceObject, null, 2);
    },

    /**
     * Gets the raw events array
     */
    getEvents: (): TraceEvent[] => {
      return [...events];
    },

    /**
     * Clears all collected events
     */
    clear: (): void => {
      events.length = 0;
    },
  };
};

const traceProfiler = createTraceProfiler();

describe("JSContext", () => {
  let runtime: HakoRuntime;
  let context: VMContext;

  beforeEach(async () => {
    traceProfiler.clear();
    // Initialize Hako with real WASM binary
    const wasmBinary = decodeVariant(HAKO_PROD);
    runtime = await createHakoRuntime({
      wasm: {
        io: {
          stdout: (lines) => console.log(lines),
          stderr: (lines) => console.error(lines),
        },
      },
      loader: {
        binary: wasmBinary,
        fetch: fetch,
      },
    });
    runtime.enableProfileCalls(traceProfiler);
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

  it("should create a context successfully", () => {
    expect(context).toBeDefined();
    expect(context.pointer).toBeGreaterThan(0);
    expect(context.runtime.pointer).toBe(runtime.pointer);
  });

  it("should set max stack size", () => {
    const stackSize = 1024 * 1024; // 1MB
    expect(() => {
      context.setMaxStackSize(stackSize);
    }).not.toThrow();
  });

  it("should set the opaque data", () => {
    const data = JSON.stringify({ kind: "test" });
    context.setOpaqueData(data);
    const opaqueData = context.getOpaqueData();
    expect(opaqueData).toEqual(data);

    context.freeOpaqueData();

    // also test the ABI
    const mem: MemoryManager = context.container.memory;
    const exports: HakoExports = context.container.exports;

    const strPointer = mem.allocateString(context.pointer, data);
    exports.HAKO_SetContextData(context.pointer, strPointer);

    const roundtrip = exports.HAKO_GetContextData(context.pointer);

    const str = mem.readString(roundtrip);
    expect(str).toEqual(data);
    mem.freeMemory(context.pointer, roundtrip);
    exports.HAKO_SetContextData(context.pointer, 0);
  });

  describe("Code evaluation", () => {
    it("should evaluate simple JavaScript expressions", () => {
      using result = context.evalCode("1 + 2");
      expect(DisposableResult.is(result)).toBe(true);
      expect(result.error).toBeUndefined();

      const jsValue = result.unwrap();
      expect(jsValue.asNumber()).toBe(3);
    });

    it("should interrupt bad fibonacci code", () => {
      const handler = runtime.createGasInterruptHandler(1000);
      runtime.enableInterruptHandler(handler);
      context.setMaxStackSize(1000);
      using result = context.evalCode(`
        function fibonacci(n) {
   return n < 1 ? 0
        : n <= 2 ? 1
        : fibonacci(n - 1) + fibonacci(n - 2)
}
fibonacci(50);
       `);
      expect(() => result.unwrap()).toThrow("interrupted");
    });

    it("should calcuclate a fibonacci number", () => {
      using result = context.evalCode(`
       "use strict";

function fibonacci(n) {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  
  function multiplyMatrix(A, B) {
    const C = [
      [0, 0],
      [0, 0]
    ];
    
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        for (let k = 0; k < 2; k++) {
          C[i][j] += A[i][k] * B[k][j];
        }
      }
    }
    
    return C;
  }
  
  function matrixPower(A, n) {
    if (n === 1) return A;
    if (n % 2 === 0) {
      const half = matrixPower(A, n / 2);
      return multiplyMatrix(half, half);
    } else {
      const half = matrixPower(A, (n - 1) / 2);
      const halfSquared = multiplyMatrix(half, half);
      return multiplyMatrix(A, halfSquared);
    }
  }
  
  const baseMatrix = [
    [1, 1],
    [1, 0]
  ];
  
  const resultMatrix = matrixPower(baseMatrix, n - 1);
  return resultMatrix[0][0];
}

fibonacci(100);
      `);

      const jsValue = result.unwrap();
      expect(jsValue.asNumber()).toBe(354224848179261900000);
    });

    it("should evaluate expressions with variables", () => {
      using result = context.evalCode("let x = 5; let y = 10; x + y");
      expect(result.error).toBeUndefined();

      const jsValue = result.unwrap();
      expect(jsValue.asNumber()).toBe(15);
    });

    it("should create a base64 string with padding", () => {
      const base64String = "HelloQ==";
      using result = context.evalCode(`
				const uint8Array = new Uint8Array([29, 233, 101, 161]);
				uint8Array.toBase64()
		`);
      expect(result.unwrap().asString()).toEqual(base64String);
    });

    it("should verify Performance API implementation", () => {
      type performanceData = {
        now: number;
        origin: number;
        current: number;
        nowType: string;
        originType: string;
      };
      // Test the performance API implementation
      using result = context.evalCode(`
    let a = {
      now: performance.now(),
      origin: performance.timeOrigin,
      current: performance.timeOrigin + performance.now(),
      nowType: typeof performance.now(),
      originType: typeof performance.timeOrigin
    }
    a
  `);

      using value = context.unwrapResult<VMValue>(result);
      using nativeValue = value.toNativeValue<performanceData>();
      const performanceData = nativeValue.value;
      console.log("Performance API results:", performanceData);

      // Verify that the types are correct (should be numbers)
      expect(performanceData.nowType).toEqual("number");
      expect(performanceData.originType).toEqual("number");

      // Verify that now() returns a small positive number (milliseconds since context creation)
      expect(performanceData.now).toBeGreaterThanOrEqual(0);

      // Verify that timeOrigin is a large number (milliseconds since Unix epoch)
      // Checking if it's at least from year 2020 (1577836800000 = Jan 1, 2020)
      expect(performanceData.origin).toBeGreaterThan(1577836800000);
    });

    it("should create a base64 string without padding", () => {
      const base64String = "HelloQ";
      using result = context.evalCode(`
				const uint8Array = new Uint8Array([29, 233, 101, 161]);
				uint8Array.toBase64({ omitPadding: true })
		`);
      expect(result.unwrap().asString()).toEqual(base64String);
    });

    it("should create a base64 string with URL-safe alphabet", () => {
      const base64String = "Love_you";
      using result = context.evalCode(`
				const uint8Array = new Uint8Array([46, 139, 222, 255, 42, 46]);
				uint8Array.toBase64({ alphabet: "base64url" });
		`);
      expect(result.unwrap().asString()).toEqual(base64String);
    });

    it("should create a UInt8Array from a base64 string", () => {
      const unencodedData = new Uint8Array([
        60, 98, 62, 77, 68, 78, 60, 47, 98, 62,
      ]);
      using result = context.evalCode(`
				 const data = Uint8Array.fromBase64("PGI+ TURO PC9i Ph");
        
					 data
		`);
      const data = result.unwrap();
      expect(data.type).toBe("object");
      expect(data.isTypedArray()).toBe(true);
      expect(data.getTypedArrayType()).toBe("Uint8Array");
      // make sure the data is the same
      const datav = data.copyTypedArray();
      expect(datav).toEqual(unencodedData);
    });

    it("should handle a map", () => {
      using result = context.evalCode(`
				const map = new Map();
				map.set("key1", "value1");
				map.set("key2", "value2");
				map.get("key1");
			`);
      expect(result.error).toBeUndefined();
      const jsValue = result.unwrap();
      expect(jsValue.asString()).toBe("value1");
    });

    it("should handle syntax errors", () => {
      using result = context.evalCode("let x = ;");
      expect(result.error).toBeDefined();

      // Should throw when unwrapped
      expect(() => result.unwrap()).toThrow();
    });

    it("should evaluate code with custom filename", () => {
      using result = context.evalCode("1 + 2", { fileName: "test.js" });
      expect(result.error).toBeUndefined();

      const jsValue = result.unwrap();
      expect(jsValue.asNumber()).toBe(3);
    });

    it("should use unwrapResult for error handling", () => {
      // Success case
      using successResult = context.evalCode("40 + 2");
      const successValue = context.unwrapResult<VMValue>(successResult);
      expect(successValue.asNumber()).toBe(42);

      // Error case
      using errorResult = context.evalCode(
        'throw new Error("Test error", { cause: new Error("test") });'
      );
      expect(() => context.unwrapResult(errorResult)).toThrow("Test error");
    });
  });

  describe("Crypto API", () => {
  describe("getRandomValues", () => {
    it("should fill Uint8Array with random values", () => {
      using result = context.evalCode(`
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        array;
      `);
      
      const jsValue = result.unwrap();
      expect(jsValue.isTypedArray()).toBe(true);
      expect(jsValue.getTypedArrayType()).toBe("Uint8Array");
      
      const data = jsValue.copyTypedArray();
      expect(data).toBeInstanceOf(Uint8Array);
      expect(data.length).toBe(16);
      
      // Check that values are not all zeros (very unlikely with random data)
      const allZeros = Array.from(data).every(byte => byte === 0);
      expect(allZeros).toBe(false);
    });

    it("should work with different typed array types", () => {
      using result = context.evalCode(`
        const results = {};
        
        const uint8 = new Uint8Array(4);
        crypto.getRandomValues(uint8);
        results.uint8 = Array.from(uint8);
        
        const uint16 = new Uint16Array(4);
        crypto.getRandomValues(uint16);
        results.uint16 = Array.from(uint16);
        
        const uint32 = new Uint32Array(4);
        crypto.getRandomValues(uint32);
        results.uint32 = Array.from(uint32);
        
        results;
      `);
      
      using value = context.unwrapResult<VMValue>(result);
      using nativeValue = value.toNativeValue<any>();
      const results = nativeValue.value;
      
      expect(results.uint8).toHaveLength(4);
      expect(results.uint16).toHaveLength(4);
      expect(results.uint32).toHaveLength(4);
      
      // Check that arrays contain non-zero values
      expect(results.uint8.some(v => v !== 0)).toBe(true);
      expect(results.uint16.some(v => v !== 0)).toBe(true);
      expect(results.uint32.some(v => v !== 0)).toBe(true);
    });

    it("should throw error for arrays exceeding 65536 bytes", () => {
      using result = context.evalCode(`
        try {
          const largeArray = new Uint8Array(65537);
          crypto.getRandomValues(largeArray);
          false; // Should not reach here
        } catch (error) {
          error.message;
        }
      `);
      
      const errorMessage = result.unwrap().asString();
      expect(errorMessage).toContain("65536");
    });

    it("should throw error for invalid array types", () => {
      using result = context.evalCode(`
        try {
          crypto.getRandomValues(new Float32Array(4));
          false; // Should not reach here
        } catch (error) {
          error.message;
        }
      `);
      
      const errorMessage = result.unwrap().asString();
      expect(errorMessage).toContain("getRandomValues requires");
    });

    it("should return the same array that was passed in", () => {
      using result = context.evalCode(`
        const array = new Uint8Array(8);
        const returned = crypto.getRandomValues(array);
        returned === array;
      `);
      
      expect(result.unwrap().asBoolean()).toBe(true);
    });
  });

  describe("randomUUID", () => {
    it("should generate valid UUID v4", () => {
      using result = context.evalCode(`crypto.randomUUID()`);
      
      const uuid = result.unwrap().asString();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it("should generate different UUIDs on each call", () => {
      using result = context.evalCode(`
        const uuid1 = crypto.randomUUID();
        const uuid2 = crypto.randomUUID();
        const uuid3 = crypto.randomUUID();
        [uuid1, uuid2, uuid3];
      `);
      
      using value = context.unwrapResult<VMValue>(result);
      using nativeValue = value.toNativeValue<string[]>();
      const uuids = nativeValue.value;
      
      expect(uuids).toHaveLength(3);
      expect(uuids[0]).not.toBe(uuids[1]);
      expect(uuids[1]).not.toBe(uuids[2]);
      expect(uuids[0]).not.toBe(uuids[2]);
    });

    it("should have correct UUID v4 structure", () => {
      using result = context.evalCode(`
        const uuid = crypto.randomUUID();
        const parts = uuid.split('-');
        ({
          length: uuid.length,
          parts: parts.length,
          partLengths: parts.map(p => p.length),
          version: uuid[14], // Should be '4'
          variant: uuid[19]  // Should be '8', '9', 'a', or 'b'
      });
      `);
      
      using value = context.unwrapResult<VMValue>(result);
      using nativeValue = value.toNativeValue<any>();
      const info = nativeValue.value;
      
      expect(info.length).toBe(36);
      expect(info.parts).toBe(5);
      expect(info.partLengths).toEqual([8, 4, 4, 4, 12]);
      expect(info.version).toBe('4');
      expect(['8', '9', 'a', 'b']).toContain(info.variant);
    });
  });

  describe("randomUUIDv7", () => {
    it("should generate valid UUID v7", () => {
      using result = context.evalCode(`crypto.randomUUIDv7()`);
      
      const uuid = result.unwrap().asString();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it("should generate UUIDs with timestamps in order", () => {
      using result = context.evalCode(`
        const uuid1 = crypto.randomUUIDv7();
        // Small delay to ensure different timestamps
        for (let i = 0; i < 1000; i++) { Math.random(); }
        const uuid2 = crypto.randomUUIDv7();
        
        // Extract timestamp portions (first 12 hex chars)
        const ts1 = uuid1.substring(0, 13).replace('-', '');
        const ts2 = uuid2.substring(0, 13).replace('-', '');
        
        ({
          uuid1,
          uuid2,
          ts1,
          ts2,
          ordered: ts1 <= ts2
      });
      `);
      
      using value = context.unwrapResult<VMValue>(result);
      using nativeValue = value.toNativeValue<any>();
      const info = nativeValue.value;
      
      expect(info.ordered).toBe(true);
      expect(info.uuid1).not.toBe(info.uuid2);
    });

    it("should accept custom timestamp", () => {
      using result = context.evalCode(`
        const customTime = 1640995200000; // 2022-01-01 00:00:00 UTC
        const uuid = crypto.randomUUIDv7(customTime);
        
        // Extract the timestamp portion
        const timestampHex = uuid.substring(0, 13).replace('-', '');
        const extractedTime = parseInt(timestampHex, 16);
        
        ({
          uuid,
          customTime,
          extractedTime,
          matches: extractedTime === customTime
      });
      `);
      
      using value = context.unwrapResult<VMValue>(result);
      using nativeValue = value.toNativeValue<any>();
      const info = nativeValue.value;
      
      expect(info.matches).toBe(true);
      expect(info.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it("should have correct UUID v7 structure", () => {
      using result = context.evalCode(`
        const uuid = crypto.randomUUIDv7();
        ({
          length: uuid.length,
          version: uuid[14], // Should be '7'
          variant: uuid[19]  // Should be '8', '9', 'a', or 'b'
      });
      `);
      
      using value = context.unwrapResult<VMValue>(result);
      using nativeValue = value.toNativeValue<any>();
      const info = nativeValue.value;
      
      expect(info.length).toBe(36);
      expect(info.version).toBe('7');
      expect(['8', '9', 'a', 'b']).toContain(info.variant);
    });

    it("should be sortable by creation time", () => {
      using result = context.evalCode(`
        const uuids = [];
        const times = [];
        
        for (let i = 0; i < 5; i++) {
          const time = Date.now() + i * 100; // Ensure different timestamps
          uuids.push(crypto.randomUUIDv7(time));
          times.push(time);
        }
        
        const sorted = [...uuids].sort();
        const timeSorted = uuids.slice(); // Should already be in time order
        
        ({
          uuids,
          sorted,
          isAlreadySorted: JSON.stringify(sorted) === JSON.stringify(timeSorted)
      });
      `);
      
      using value = context.unwrapResult<VMValue>(result);
      using nativeValue = value.toNativeValue<any>();
      const info = nativeValue.value;
      
      expect(info.isAlreadySorted).toBe(true);
    });

    it("should throw error for invalid timestamp", () => {
      using result = context.evalCode(`
        try {
          crypto.randomUUIDv7("invalid");
          false; // Should not reach here
        } catch (error) {
          error.message;
        }
      `);
      
      const errorMessage = result.unwrap().asString();
      expect(errorMessage).toContain("must be a number");
    });
  });
});

  describe("C Module support", () => {
    it("should create a C module with the builder API", () => {
      let initWasCalled = false;
      let capturedValue: string | undefined;

      // Bind a function to capture values
      using global = context.getGlobalObject();
      using captureFunc = context.newFunction("capture", (value) => {
        capturedValue = value.asString();
        return context.undefined();
      });
      global.setProperty("capture", captureFunc);

      // Create the C module with inline handler
      const moduleBuilder = runtime
        .createCModule("my-c-module", (module) => {
          initWasCalled = true;

          // Set the export value easily
          module.setExport("greeting", "hello from C module");
          module.setExport("foo", module.getPrivateValue());

          return 0; // Success
        })
        .addExport("greeting")
        .addExport("foo");

      moduleBuilder.setPrivateValue("bar");

      expect(moduleBuilder.pointer).not.toBe(0);
      expect(moduleBuilder.exportNames).toEqual(["greeting", "foo"]);
      expect(initWasCalled).toBe(false);

      // Set up module loader
      runtime.enableModuleLoader((mn, att) => {
        return { type: "precompiled", data: moduleBuilder.pointer };
      });

      // Import the module and capture the value
      using result = context.evalCode(
        `
        import { greeting, foo } from 'my-c-module';
        export const test = greeting;
        export const test2 = foo;
        capture(greeting);
      `,
        { type: "module" }
      );

      // Check that everything worked
      expect(initWasCalled).toBe(true);
      expect(capturedValue).toBe("hello from C module");

      // Check the namespace
      using namespace = result.unwrap();
      using property = namespace.getProperty("test");
      expect(property.asString()).toBe("hello from C module");

      // Verify module name
      expect(moduleBuilder.name).toBe("my-c-module");
    });

    it("should support multiple exports and functions", () => {
      let initWasCalled = false;
      const capturedValues: Record<string, unknown> = {};

      // Create capture function
      using global = context.getGlobalObject();
      using captureFunc = context.newFunction("captureAll", (...values) => {
        values.forEach((value, index) => {
          capturedValues[`value${index}`] = value.asString();
        });
        return context.undefined();
      });
      global.setProperty("captureAll", captureFunc);

      // Create module with multiple exports and inline handler
      const moduleBuilder = runtime
        .createCModule("multi-export-module", (module) => {
          initWasCalled = true;

          // Set multiple exports at once
          module.setExports({
            greeting: "Hello from C!",
            version: "1.0.0",
            count: 42,
            isEnabled: true,
          });

          // Set a function export
          module.setFunction("add", (a, b) => {
            return module.context.newNumber(a.asNumber() + b.asNumber());
          });

          return 0;
        })
        .addExports(["greeting", "version", "count", "isEnabled", "add"]);

      expect(moduleBuilder.exportNames).toEqual([
        "greeting",
        "version",
        "count",
        "isEnabled",
        "add",
      ]);

      runtime.enableModuleLoader(() => {
        return { type: "precompiled", data: moduleBuilder.pointer };
      });

      using result = context.evalCode(
        `
        import { greeting, version, count, isEnabled, add } from 'multi-export-module';
        
        const sum = add(10, 20);
        captureAll(greeting, version, count.toString(), isEnabled.toString(), sum.toString());
        
        export { greeting, version, count, isEnabled, sum };
      `,
        { type: "module" }
      );

      expect(initWasCalled).toBe(true);
      expect(capturedValues.value0).toBe("Hello from C!");
      expect(capturedValues.value1).toBe("1.0.0");
      expect(capturedValues.value2).toBe("42");
      expect(capturedValues.value3).toBe("true");
      expect(capturedValues.value4).toBe("30");

      // Verify module properties
      expect(moduleBuilder.name).toBe("multi-export-module");
    });

    it("should support JSON modules", () => {
      let initWasCalled = false;

      // Sample JSON data
      const jsonData = {
        name: "my-package",
        version: "1.2.3",
        dependencies: {
          lodash: "^4.17.21",
          react: "^18.0.0",
        },
        scripts: {
          test: "jest",
          build: "webpack",
        },
      };

      let capturedData: typeof jsonData | null = null;

      // Create capture function
      using global = context.getGlobalObject();
      using captureFunc = context.newFunction("captureJSON", (value) => {
        using box = value.toNativeValue<typeof jsonData>();
        capturedData = box.value;
        return context.undefined();
      });
      global.setProperty("captureJSON", captureFunc);

      // Create JSON module
      const moduleBuilder = runtime
        .createCModule("package.json", (module) => {
          initWasCalled = true;

          // Export the JSON object as default export
          module.setExport("default", module.getPrivateValue());

          return 0;
        })
        .addExport("default");

      // Parse JSON and set as private value
      const parsedJson = JSON.parse(JSON.stringify(jsonData));
      moduleBuilder.setPrivateValue(parsedJson);

      expect(moduleBuilder.exportNames).toEqual(["default"]);

      runtime.enableModuleLoader(() => {
        return { type: "precompiled", data: moduleBuilder.pointer };
      });

      using result = context.evalCode(
        `
        import packageData from 'package.json' with { type: 'json' };
        captureJSON(packageData);
        export default packageData;
      `,
        { type: "module" }
      );

      expect(initWasCalled).toBe(true);
      expect(capturedData).toBeDefined();

      expect(capturedData!.name).toBe("my-package");
      expect(capturedData!.version).toBe("1.2.3");
      expect(capturedData!.dependencies).toEqual(parsedJson.dependencies);

      // Verify the exported data structure
      using namespace = result.unwrap();
      using defaultExport = namespace.getProperty("default");
      using nameProperty = defaultExport.getProperty("name");
      expect(nameProperty.asString()).toBe("my-package");
    });

    it("should support class exports", () => {
      let initWasCalled = false;
      const capturedResults: string[] = [];

      // Create capture function
      using global = context.getGlobalObject();
      using captureFunc = context.newFunction("captureResult", (value) => {
        capturedResults.push(value.asString());
        return context.undefined();
      });
      global.setProperty("captureResult", captureFunc);

      // Create module with class export using the existing setClass method
      using moduleBuilder = runtime
        .createCModule("class-module", (module) => {
          initWasCalled = true;

          // Create the Point class with simple initialization
          module.setClass(
            "Point",
            (instance, args) => {
              // Extract constructor arguments
              const x = args[0]?.asNumber() || 0;
              const y = args[1]?.asNumber() || 0;

              // Store coordinates as opaque data (pack x,y into single number)
              const opaque = (x << 16) | (y & 0xffff);
              instance.setOpaque(opaque);

              // No return needed - instance is handled automatically
            },
            {
              methods: {
                getX: function () {
                  // Extract x from opaque data
                  const opaque = this.getOpaque();
                  const x = (opaque >> 16) & 0xffff;

                  return module.context.newNumber(x);
                },
                getY: function () {
                  // Extract y from opaque data
                  const opaque = this.getOpaque();
                  const y = opaque & 0xffff;
                  return module.context.newNumber(y);
                },
              },
            }
          );

          return 0;
        })
        .addExport("Point");

      runtime.enableModuleLoader(() => {
        return { type: "precompiled", data: moduleBuilder.pointer };
      });

      using result = context.evalCode(
        `
        import { Point } from 'class-module';
        const p1 = new Point(10, 20);
        const x = p1.getX();
        const y = p1.getY();
        captureResult(\`Point(\${x}, \${y})\`);
        export { Point };
      `,
        { type: "module" }
      );

      using namespace = result.unwrap();
      expect(initWasCalled).toBe(true);
      expect(capturedResults[0]).toBe("Point(10, 20)");
    });

    it("should support class finalizer", () => {
      let initWasCalled = false;
      let finalizerCallCount = 0;

      // Create module with class that has a finalizer
      using moduleBuilder = runtime
        .createCModule("finalizer-module", (module) => {
          initWasCalled = true;

          module.setClass(
            "TestClass",
            (instance) => {
              // Allocate some memory and store as opaque
              const memory = module.context.container.memory;
              const ptr = memory.allocateString(module.context.pointer, "test");
              instance.setOpaque(ptr);
            },
            {
              finalizer: (runtime: HakoRuntime, opaque: number) => {
                runtime.freeMemory(opaque);
                finalizerCallCount++;
              },
            }
          );

          return 0;
        })
        .addExport("TestClass");

      runtime.enableModuleLoader(() => {
        return { type: "precompiled", data: moduleBuilder.pointer };
      });

      using result = context.evalCode(
        `
      import { TestClass } from 'finalizer-module';
      const obj = new TestClass();
      export { TestClass };
    `,
        { type: "module" }
      );

      expect(initWasCalled).toBe(true);
      expect(finalizerCallCount).toBe(1);
    });
  });
  describe("Value creation", () => {
    it("should create primitive values", () => {
      // Undefined
      using undefinedVal = context.undefined();
      expect(undefinedVal.isUndefined()).toBe(true);

      // Null
      using nullVal = context.null();
      expect(nullVal.isNull()).toBe(true);

      // Boolean
      using trueVal = context.true();
      using falseVal = context.false();
      expect(trueVal.asBoolean()).toBe(true);
      expect(falseVal.asBoolean()).toBe(false);

      // Number
      using numVal = context.newNumber(42.5);
      expect(numVal.asNumber()).toBe(42.5);

      // String
      using strVal = context.newString("hello");
      expect(strVal.asString()).toBe("hello");
    });

    it("should create and manipulate objects", () => {
      using obj = context.newObject();

      // Set properties
      using nameVal = context.newString("test");
      using numVal = context.newNumber(42);

      obj.setProperty("name", nameVal);
      obj.setProperty("value", numVal);

      // Get properties
      using retrievedName = obj.getProperty("name");
      using retrievedValue = obj.getProperty("value");

      expect(retrievedName?.asString()).toBe("test");
      expect(retrievedValue?.asNumber()).toBe(42);
    });

    it("should create and manipulate arrays", () => {
      using arr: VMValue = context.newArray();

      // Add elements
      arr.setProperty(0, "hello");
      arr.setProperty(1, 42);
      arr.setProperty(2, true);

      // Get length
      using lengthProp = arr.getProperty("length");
      expect(lengthProp?.asNumber()).toBe(3);

      // Get elements
      using elem0 = arr.getProperty(0);
      using elem1 = arr.getProperty(1);
      using elem2 = arr.getProperty(2);

      expect(elem0?.asString()).toBe("hello");
      expect(elem1?.asNumber()).toBe(42);
      expect(elem2?.asBoolean()).toBe(true);
    });

    it("should create and use array buffers", () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      using arrBuf = context.newArrayBuffer(data);

      // Get the data back
      const retrievedData = arrBuf.copyArrayBuffer();
      expect(retrievedData).toBeDefined();

      expect(retrievedData.byteLength).toBe(5);

      expect(retrievedData).toEqual(data.buffer);
    });

    it("should create and use symbols", () => {
      using symbol = context.newSymbol("testSymbol");

      // Verify it's a symbol
      expect(symbol.isSymbol()).toBe(true);

      // Test symbol in an object
      using obj = context.newObject();
      obj.setProperty(symbol, "symbolValue");

      using value = obj.getProperty(symbol);
      expect(value?.asString()).toBe("symbolValue");
    });

    it("should get and iterate a map", () => {
      // lets eval code that creates a map

      using result = context.evalCode(`
				const map = new Map();
				map.set("key1", "value1");
				map.set("key2", "value2");
				map;
			`);
      using map = result.unwrap();

      for (using entriesBox of context.getIterator(map).unwrap()) {
        using entriesHandle = entriesBox.unwrap();
        using keyHandle = entriesHandle.getProperty(0).toNativeValue();
        using valueHandle = entriesHandle.getProperty(1).toNativeValue();
        if (keyHandle.value === "key1") {
          expect(valueHandle.value).toBe("value1");
        }
        if (keyHandle.value === "key2") {
          expect(valueHandle.value).toBe("value2");
        }
      }
    });

    it("should create and call functions", () => {
      using func = context.newFunction("add", (a, b) => {
        // Return the result
        return context.newNumber(a.asNumber() + b.asNumber());
      });
      // Call the function
      using arg1 = context.newNumber(5);
      using arg2 = context.newNumber(7);
      using result = context.callFunction(
        func,
        context.undefined(),
        arg1,
        arg2
      );
      expect(result.unwrap().asNumber()).toBe(12);
    });
  });

  describe("JS conversion", () => {
    it("should convert JS values to PrimJS values", () => {
      // Test primitives
      using testString = context.newValue("hello");
      expect(testString.asString()).toBe("hello");

      using testNumber = context.newValue(42.5);
      expect(testNumber.asNumber()).toBe(42.5);

      using testBool = context.newValue(true);
      expect(testBool.asBoolean()).toBe(true);

      using testNull = context.newValue(null);
      expect(testNull.isNull()).toBe(true);

      using testUndefined = context.newValue(undefined);
      expect(testUndefined.isUndefined()).toBe(true);

      using testArray = context.newValue([1, "two", true]);
      expect(testArray.isArray()).toBe(true);

      using arrLen = testArray.getProperty("length");
      expect(arrLen?.asNumber()).toBe(3);

      using arrElem0 = testArray.getProperty(0);
      using arrElem1 = testArray.getProperty(1);
      using arrElem2 = testArray.getProperty(2);

      expect(arrElem0?.asNumber()).toBe(1);
      expect(arrElem1?.asString()).toBe("two");
      expect(arrElem2?.asBoolean()).toBe(true);
    });

    it("should convert PrimJS values to JS values", () => {
      // Create some PrimJS values
      using str = context.newString("hello");
      using num = context.newNumber(42.5);
      using bool = context.true();
      using nul = context.null();
      using undef = context.undefined();

      // Create an array
      using arr = context.newArray();
      arr.setProperty(0, 1);
      arr.setProperty(1, "two");
      arr.setProperty(2, true);

      // Create an object
      using obj = context.newObject();
      obj.setProperty("name", "test");
      obj.setProperty("value", 42);

      // Convert to JS
      expect(str.toNativeValue().value).toBe("hello");
      expect(num.toNativeValue().value).toBe(42.5);
      expect(bool.toNativeValue().value).toBe(true);
      expect(nul.toNativeValue().value).toBe(null);
      expect(undef.toNativeValue().value).toBe(undefined);

      using arrJS = arr.toNativeValue();
      expect(Array.isArray(arrJS.value)).toBe(true);
      expect(arrJS.value).toEqual([1, "two", true]);

      using objJS = obj.toNativeValue();
      expect(typeof objJS.value).toBe("object");
      expect(objJS.value).toEqual({ name: "test", value: 42 });
    });
  });

  describe("Error handling", () => {
    it("should create and throw errors", () => {
      // Create an error
      const errorMsg = new Error("Test error message");
      using error = context.newError(errorMsg);
      // Throw the error
      using exception = context.throwError(error);
      const lastError = context.getLastError(exception);
      expect(lastError?.message).toBe("Test error message");
    });

    it("should throw errors from strings", () => {
      using thrownError = context.throwError("Direct error message");
      const lastError = context.getLastError(thrownError);
      expect(lastError?.message).toBe("Direct error message");
    });

    it("should check for exceptions", () => {
      // Create an exception value
      using result = context.evalCode('throw new Error("Test exception");');
      expect(result.error instanceof VMValue).toBe(true);
      expect(() => context.unwrapResult(result)).toThrow("Test exception");
    });
  });

  describe("Promise handling", () => {
    it("should resolve already-settled async function promises without deadlocking", async () => {
      // This test reproduces the deadlock issue from the GitHub issue
      const code = `export const run = async (name) => { return "Hello" + name };`;

      using result = context.evalCode(code, { type: "module" });
      expect(result.error).toBeUndefined();

      using mod = result.unwrap();
      using runFunction = mod.getProperty("run");

      // Call the async function - this creates an already-settled promise
      using arg = context.newValue("Test");
      console.log("Calling runFunction with arg:", arg.asString());
      using callResult = context.callFunction(runFunction, null, arg);
      using promiseHandle = callResult.unwrap();
      console.log("Promise handle created:");

      // Verify it's a promise and already settled
      expect(promiseHandle.isPromise()).toBe(true);

      // Before the fix: this would deadlock because the promise is already settled
      // After the fix: this should resolve without blocking
      const startTime = Date.now();
      console.log("Resolving promise handle...");
      using resolvedResult = await context.resolvePromise(promiseHandle);
      const endTime = Date.now();

      // Should resolve quickly (within reasonable time, not hang indefinitely)
      expect(endTime - startTime).toBeLessThan(1000); // Should be much faster than 1 second

      using resolvedHandle = resolvedResult.unwrap();
      expect(resolvedHandle.asString()).toBe("HelloTest");
    });

    it("should handle promise resolution", async () => {
      const fakeFileSystem = new Map([["example.txt", "Example file content"]]);
      using readFileHandle = context.newFunction("readFile", (pathHandle) => {
        const path = pathHandle.asString();
        pathHandle.dispose();
        const promise = context.newPromise();
        setTimeout(() => {
          const content = fakeFileSystem.get(path);
          using contentHandle = context.newString(content || "");
          promise.resolve(contentHandle);
        }, 100);
        // IMPORTANT: Once you resolve an async action inside PrimJS,
        // call runtime.executePendingJobs() to run any code that was
        // waiting on the promise or callback.
        promise.settled.then(() => context.runtime.executePendingJobs());
        return promise.handle;
      });

      // basic logging function
      using log = context.newFunction("log", (message) => {
        console.log("Log:", message.asString());
        message.dispose();
        return context.undefined();
      });
      // register the log function
      using glob: VMValue = context.getGlobalObject();
      glob.setProperty("readFile", readFileHandle);
      glob.setProperty("log", log);

      using result = context.evalCode(`(async () => {
                const buffer = new ArrayBuffer(8);
		
                const content = await readFile('example.txt')
                
                return content;
            })()`);

      using promiseHandle = context.unwrapResult<VMValue>(result);
      using resolvedResult = await context.resolvePromise(promiseHandle);
      using resolvedHandle = context.unwrapResult<VMValue>(resolvedResult);
      expect(resolvedHandle.asString()).toEqual("Example file content");
    });
  });

  describe("Binary JSON", () => {
    it("should encode and decode objects with bjson", () => {
      // Create a test object
      using obj = context.newValue({
        string: "hello",
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: { a: 1, b: 2 },
      });

      // Encode to bjson
      const encoded = context.bjsonEncode(obj);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);

      // Decode from bjson
      using decoded = context.bjsonDecode(encoded);
      expect(decoded).not.toBeNull();

      if (decoded) {
        // Convert both to JS for comparison
        using objJS = obj.toNativeValue();
        using decodedJS = decoded.toNativeValue();

        // Compare
        expect(decodedJS.value).toEqual(objJS.value);
      }
    });
  });

  describe("Module loading", () => {
    it("should load and execute a simple module", () => {
      // Setup a simple module loader with one module
      const moduleMap = new Map([
        [
          "my-module",
          `
      // This is our simple module that exports a function
      export const hello = (name) => {
        return "Hello, " + name + "!";
      }
    `,
        ],
      ]);

      // Enable the module loader
      const loader: ModuleLoaderFunction = (moduleName: string) => {
        const moduleContent = moduleMap.get(moduleName);
        if (!moduleContent) {
          return null;
        }
        return { type: "source", data: moduleContent };
      };
      const resolver = (
        moduleName: string,
        currentModule: string | undefined
      ) => {
        console.log(`Resolving module: ${moduleName} from ${currentModule}`);
        // For simplicity, just
        return moduleName;
      };
      runtime.enableModuleLoader(loader, undefined, resolver);

      runtime.setStripInfo();

      // Test importing the module and creating a new function
      using result = context.evalCode(
        `
    // Import the function from our module
    import { hello } from 'my-module?hello=true';
    
    // Create and export our own function
    export const sayGoodbye = (name) => {
      return "Goodbye, " + name + "!";
    }
    
    // Use the imported function and export the result
    export const greeting = hello("World");
  `,
        { type: "module" }
      );
      type ModuleExports = {
        hello: (name: string) => string;
        sayGoodbye: (name: string) => string;
        greeting: string;
      };

      // Get the module result
      using jsValue = result.unwrap();
      using jsObject = jsValue.toNativeValue<ModuleExports>();

      expect(jsObject).toBeDefined();
      expect(jsObject.value).toBeDefined();
      expect(jsObject.value.greeting).toBe("Hello, World!");
      expect(jsObject.value.sayGoodbye).toBeDefined();
      expect(jsObject.value.sayGoodbye("Tester")).toBe("Goodbye, Tester!");
    });
  });

  describe("Global object", () => {
    it("should access the global object", () => {
      using global = context.getGlobalObject();
    });

    it("should add properties to global object", () => {
      using global = context.getGlobalObject();
      // Add a global variable
      global.setProperty("testGlobal", 42);

      // Evaluate code that uses the global
      using result = context.evalCode("testGlobal + 10");
      const value = result.unwrap();
      expect(value.asNumber()).toBe(52);
    });
  });

  it("should properly release resources", () => {
    // Create a new context for this test
    const testContext = runtime.createContext();

    // Create some values to make sure they're cleaned up
    const str = testContext.newString("test");
    const num = testContext.newNumber(42);
    const obj = testContext.newObject();

    // Dispose the values
    str.dispose();
    num.dispose();
    obj.dispose();

    // Test that release doesn't throw
    expect(() => {
      testContext.release();
    }).not.toThrow();

    // Release again should be no-op
    expect(() => {
      testContext.release();
    }).not.toThrow();
  });

  it("should compile and not crash with cyclic labels", () => {
    const gasInte = runtime.createGasInterruptHandler(100);
    runtime.enableInterruptHandler(gasInte);
    using result = context.evalCode(`
	  for (;;) {
        l: break l;
        l: break l;
        l: break l;
    }
	`);
    expect(() => result.unwrap()).toThrow("interrupted");
  });

  it("should support Symbol.dispose", () => {
    // Create a new context for this test
    const testContext = runtime.createContext();

    // Use Symbol.dispose
    expect(() => {
      testContext[Symbol.dispose]();
    }).not.toThrow();
  });

  describe("Bytecode compilation and evaluation", () => {
    it("should compile and evaluate simple JavaScript", () => {
      const code = "40 + 2";

      // Compile to bytecode
      using compileResult = context.compileToByteCode(code);
      const bytecode = compileResult.unwrap();

      expect(bytecode).toBeInstanceOf(Uint8Array);
      expect(bytecode.length).toBeGreaterThan(0);

      // Evaluate the bytecode
      using evalResult = context.evalByteCode(bytecode);
      using result = evalResult.unwrap();

      expect(result.asNumber()).toBe(42);
    });

    it("should compile and evaluate a function", () => {
      const code = `
      function add(a, b) {
        return a + b;
      }
      add(10, 15);
    `;

      using compileResult = context.compileToByteCode(code);
      const bytecode = compileResult.unwrap();

      using evalResult = context.evalByteCode(bytecode);
      using result = evalResult.unwrap();

      expect(result.asNumber()).toBe(25);
    });

    it("should compile and evaluate an ES6 module", () => {
      const code = `
      export const test = "Hello, World!";
      export const value = 42;
      export function multiply(x) {
        return x * 2;
      }
      // Remove console.log since console may not be available
      const loaded = true;
      loaded
    `;

      // Compile module code
      using compileResult = context.compileToByteCode(code, {
        type: "module",
        fileName: "test.mjs",
      });
      const bytecode = compileResult.unwrap();

      // Evaluate the module bytecode
      using evalResult = context.evalByteCode(bytecode);
      using moduleNamespace = evalResult.unwrap();

      // Check module exports
      using valueExport = moduleNamespace.getProperty("value");
      using multiplyExport = moduleNamespace.getProperty("multiply");

      console.log(context.dump(moduleNamespace));

      expect(valueExport?.asNumber()).toBe(42);
      expect(multiplyExport?.isFunction()).toBe(true);

      // Test calling the exported function
      using arg = context.newNumber(5);
      using callResult = context.callFunction(multiplyExport, null, arg);
      using callResultValue = callResult.unwrap();
      expect(callResultValue.asNumber()).toBe(10);
    });

    it("should handle auto-detection of modules", () => {
      const moduleCode = `
      export const greeting = "Hello, World!";
    `;

      // Should auto-detect as module due to export statement
      using compileResult = context.compileToByteCode(moduleCode, {
        detectModule: true,
      });
      const bytecode = compileResult.unwrap();

      using evalResult = context.evalByteCode(bytecode);
      using result = evalResult.unwrap();

      // Should return module namespace, not undefined
      expect(result.isObject()).toBe(true);
      using greetingProp = result.getProperty("greeting");
      expect(greetingProp?.asString()).toBe("Hello, World!");
    });

    it("should handle .mjs files as modules", () => {
      const code = `
      const message = "I'm a module!";
      export { message };
    `;

      using compileResult = context.compileToByteCode(code, {
        fileName: "test.mjs",
        detectModule: true,
      });
      const bytecode = compileResult.unwrap();

      using evalResult = context.evalByteCode(bytecode);
      using moduleNamespace = evalResult.unwrap();

      console.log(context.dump(moduleNamespace));

      expect(moduleNamespace.isObject()).toBe(true);
      using messageExport = moduleNamespace.getProperty("message");
      expect(messageExport?.asString()).toBe("I'm a module!");
    });

    it("should support load-only mode", () => {
      const code = `
      throw new Error("Code executed when it shouldn't have");
      42;
    `;

      using compileResult = context.compileToByteCode(code);
      const bytecode = compileResult.unwrap();

      // Load but don't execute
      using evalResult = context.evalByteCode(bytecode, { loadOnly: true });
      using loadedObject = evalResult.unwrap();

      // Should return the loaded object without executing it
      // The object type depends on the compiled code structure
      expect(loadedObject).toBeDefined();
      // No error should be thrown since we didn't execute
    });

    it("should handle compilation errors gracefully", () => {
      const invalidCode = "let x = ;"; // Syntax error

      using compileResult = context.compileToByteCode(invalidCode);

      // Should return an error, not crash
      expect(compileResult.error).toBeDefined();
      expect(() => compileResult.unwrap()).toThrow();
    });

    it("should handle runtime errors in bytecode", () => {
      const code = `
      function throwError() {
        throw new Error("Runtime error from bytecode");
      }
      throwError();
    `;

      using compileResult = context.compileToByteCode(code);
      const bytecode = compileResult.unwrap();

      using evalResult = context.evalByteCode(bytecode);

      // Should handle runtime errors properly
      expect(evalResult.error).toBeDefined();
      expect(() => evalResult.unwrap()).toThrow("Runtime error from bytecode");
    });

    it("should work with async functions and promises", async () => {
      // Add a simple setTimeout implementation to the global scope
      using global = context.getGlobalObject();
      using setTimeoutFunc = context.newFunction(
        "setTimeout",
        (callback, delay) => {
          // Simulate async behavior with immediate execution for testing
          using result = context.callFunction(callback, null);
          return context.undefined();
        }
      );
      global.setProperty("setTimeout", setTimeoutFunc);

      const code = `
      async function delayedAdd(a, b) {
        // Use Promise.resolve instead of setTimeout for simpler testing
        await Promise.resolve();
        return a + b;
      }
      delayedAdd(20, 22);
    `;

      using compileResult = context.compileToByteCode(code);
      const bytecode = compileResult.unwrap();

      using evalResult = context.evalByteCode(bytecode);
      using promiseResult = evalResult.unwrap();

      expect(promiseResult.isPromise()).toBe(true);

      // Execute pending jobs to resolve the promise
      context.runtime.executePendingJobs();

      // Check if promise is now resolved
      const state = promiseResult.getPromiseState();
      if (state === "fulfilled") {
        using result = promiseResult.getPromiseResult();
        console.log("Promise resolved");
        expect(result?.asNumber()).toBe(42);
      } else {
        // If still pending, resolve it
        console.log("Resolving pending promise...");
        using resolvedResult = await context.resolvePromise(promiseResult);
        using finalResult = resolvedResult.unwrap();
        expect(finalResult.asNumber()).toBe(42);
      }
    });

    it("should preserve variable scope and closures", () => {
      const code = `
      function createCounter(start) {
        let count = start;
        return function() {
          return ++count;
        };
      }
      
      const counter = createCounter(5);
      [counter(), counter(), counter()];
    `;

      using compileResult = context.compileToByteCode(code);
      const bytecode = compileResult.unwrap();

      using evalResult = context.evalByteCode(bytecode);
      using arrayResult = evalResult.unwrap();

      expect(arrayResult.isArray()).toBe(true);

      using first = arrayResult.getProperty(0);
      using second = arrayResult.getProperty(1);
      using third = arrayResult.getProperty(2);

      expect(first?.asNumber()).toBe(6);
      expect(second?.asNumber()).toBe(7);
      expect(third?.asNumber()).toBe(8);
    });

    it("should handle complex objects and data structures", () => {
      const code = `
      const data = {
        numbers: [1, 2, 3],
        nested: {
          value: 42
        },
        date: new Date("2024-01-01")
      };
      data;
    `;

      using compileResult = context.compileToByteCode(code);
      const bytecode = compileResult.unwrap();

      using evalResult = context.evalByteCode(bytecode);
      using result = evalResult.unwrap();

      expect(result.isObject()).toBe(true);

      using numbers = result.getProperty("numbers");
      expect(numbers?.isArray()).toBe(true);

      using length = numbers?.getProperty("length");
      expect(length?.asNumber()).toBe(3);

      using nested = result.getProperty("nested");
      using value = nested?.getProperty("value");
      expect(value?.asNumber()).toBe(42);
    });

    it("should maintain compatibility with regular eval", () => {
      // Use different variable names to avoid redeclaration
      const code1 = `
      const a = 10;
      const b = 20;
      const result = a * b + 5;
      result;
    `;

      const code2 = `
      const x = 10;
      const y = 20;
      const outcome = x * y + 5;
      outcome;
    `;

      // Evaluate directly
      using directResult = context.evalCode(code1);
      const directValue = directResult.unwrap();

      // Compile then evaluate
      using compileResult = context.compileToByteCode(code2);
      const bytecode = compileResult.unwrap();

      using evalResult = context.evalByteCode(bytecode);
      using bytecodeValue = evalResult.unwrap();

      // Results should be identical
      expect(bytecodeValue.asNumber()).toBe(directValue.asNumber());
      expect(bytecodeValue.asNumber()).toBe(205);
    });

    it("should handle empty bytecode gracefully", () => {
      const emptyBytecode = new Uint8Array(0);

      using evalResult = context.evalByteCode(emptyBytecode);
      using result = evalResult.unwrap();

      expect(result.isUndefined()).toBe(true);
    });

    it("should compile empty code to valid bytecode", () => {
      using compileResult = context.compileToByteCode("");
      const bytecode = compileResult.unwrap();

      expect(bytecode).toBeInstanceOf(Uint8Array);
      expect(bytecode.length).toBe(0);

      using evalResult = context.evalByteCode(bytecode);
      using result = evalResult.unwrap();

      expect(result.isUndefined()).toBe(true);
    });

    it("should compile and evaluate modules with imports", () => {
      // Setup module loader for bytecode testing
      const moduleMap = new Map([
        [
          "math-utils",
          `
          export function square(x) {
            return x * x;
          }
          export const PI = 3.14159;
        `,
        ],
      ]);

      runtime.enableModuleLoader((moduleName) => {
        const moduleContent = moduleMap.get(moduleName);
        if (!moduleContent) {
          return null;
        }
        return { type: "source", data: moduleContent };
      });

      const code = `
      import { square, PI } from 'math-utils';
      export const area = square(5) * PI;
      export { square };
    `;

      using compileResult = context.compileToByteCode(code, {
        type: "module",
        fileName: "main.mjs",
      });
      const bytecode = compileResult.unwrap();

      using evalResult = context.evalByteCode(bytecode);
      using moduleNamespace = evalResult.unwrap();

      using areaExport = moduleNamespace.getProperty("area");
      using squareExport = moduleNamespace.getProperty("square");

      expect(areaExport?.asNumber()).toBeCloseTo(78.54, 2);
      expect(squareExport?.isFunction()).toBe(true);
    });

    it("should export function declarations and have them available in module namespace", () => {
      const code = `
   export const value = 42;
   export function multiply(x) {
     return x * 2;
   }
   export let loaded = true;
 `;

      using compileResult = context.compileToByteCode(code, {
        type: "module",
        fileName: "test-functions.mjs",
      });
      const bytecode = compileResult.unwrap();

      using evalResult = context.evalByteCode(bytecode);
      using moduleNamespace = evalResult.unwrap();

      console.log("Module namespace:", context.dump(moduleNamespace));

      // Check that function declaration is properly exported and accessible
      using multiplyExport = moduleNamespace.getProperty("multiply");
      using valueExport = moduleNamespace.getProperty("value");
      using loadedExport = moduleNamespace.getProperty("loaded");

      expect(multiplyExport?.isFunction()).toBe(true);
      expect(valueExport?.asNumber()).toBe(42);
      expect(loadedExport?.asBoolean()).toBe(true);

      // Test calling the exported function
      using arg = context.newNumber(5);
      using callResult = context.callFunction(multiplyExport, null, arg);
      expect(callResult.unwrap().asNumber()).toBe(10);
    });

    it("should export both function declarations and const functions, and handle 'this' in modules", () => {
      const code = `
   export const value = 42;
   export function multiply(x) {
     return x * 2;
   }
   export const constFunc = function(x) {
     return x * 3;
   };
   export const arrowFunc = (x) => x * 4;
   
   // Test 'this' behavior in module context
   export function getThis() {
     return this;
   }
   
   export const getThisConst = function() {
     return this;
   };
   
   export const getThisArrow = () => this;
   
   // Test that 'this' is undefined in module context
   export const thisIsUndefined = (this === undefined);
 `;

      using compileResult = context.compileToByteCode(code, {
        type: "module",
        fileName: "test-functions-this.mjs",
      });
      const bytecode = compileResult.unwrap();

      using evalResult = context.evalByteCode(bytecode);
      using moduleNamespace = evalResult.unwrap();

      // Check all exports are present
      using multiplyExport = moduleNamespace.getProperty("multiply");
      using constFuncExport = moduleNamespace.getProperty("constFunc");
      using arrowFuncExport = moduleNamespace.getProperty("arrowFunc");
      using valueExport = moduleNamespace.getProperty("value");
      using getThisExport = moduleNamespace.getProperty("getThis");
      using getThisConstExport = moduleNamespace.getProperty("getThisConst");
      using getThisArrowExport = moduleNamespace.getProperty("getThisArrow");
      using thisIsUndefinedExport =
        moduleNamespace.getProperty("thisIsUndefined");

      // Verify types
      expect(multiplyExport?.isFunction()).toBe(true);
      expect(constFuncExport?.isFunction()).toBe(true);
      expect(arrowFuncExport?.isFunction()).toBe(true);
      expect(valueExport?.asNumber()).toBe(42);
      expect(thisIsUndefinedExport?.asBoolean()).toBe(true);

      // Test calling all function types
      using arg = context.newNumber(5);

      using multiplyResult = context.callFunction(multiplyExport, null, arg);
      using multiplyValue = multiplyResult.unwrap();
      expect(multiplyValue.asNumber()).toBe(10);
    });
  });

  it("should properly hoist function declarations in modules", () => {
    const code = `
   // Call function before declaration - should work due to hoisting
   export const result = multiply(21);
   
   export function multiply(x) {
     return x * 2;
   }
   
   // Also test that const/let are NOT hoisted (should be undefined here)
   export const constValue = 42;
   export let letValue = "test";
 `;

    using compileResult = context.compileToByteCode(code, {
      type: "module",
      fileName: "hoisting-test.mjs",
    });
    const bytecode = compileResult.unwrap();

    using evalResult = context.evalByteCode(bytecode);
    using moduleNamespace = evalResult.unwrap();

    console.log("Module namespace:", context.dump(moduleNamespace));

    // Check that hoisting worked - function was called before declaration
    using resultExport = moduleNamespace.getProperty("result");
    using multiplyExport = moduleNamespace.getProperty("multiply");
    using constValueExport = moduleNamespace.getProperty("constValue");
    using letValueExport = moduleNamespace.getProperty("letValue");

    expect(resultExport?.asNumber()).toBe(42); // 21 * 2 = 42
    expect(multiplyExport?.isFunction()).toBe(true);
    expect(constValueExport?.asNumber()).toBe(42);
    expect(letValueExport?.asString()).toBe("test");

    // Verify the function still works when called directly
    using arg = context.newNumber(10);
    using callResult = context.callFunction(multiplyExport, null, arg);
    expect(callResult.unwrap().asNumber()).toBe(20);
  });

  it("should properly hoist function declarations in non-module scripts", () => {
    const code = `
   // Call function before declaration - should work due to hoisting
   var result = multiply(21);
   
   function multiply(x) {
     return x * 2;
   }
   
   // Return an object with our values for testing
   ({
     result: result,
     multiply: multiply,
     constValue: 42
   });
 `;

    using compileResult = context.compileToByteCode(code, {
      type: "global", // Explicitly non-module
      fileName: "hoisting-script-test.js",
    });
    const bytecode = compileResult.unwrap();

    using evalResult = context.evalByteCode(bytecode);
    using scriptResult = evalResult.unwrap();

    console.log("Script result:", context.dump(scriptResult));

    // Check that hoisting worked - function was called before declaration
    using resultProp = scriptResult.getProperty("result");
    using multiplyProp = scriptResult.getProperty("multiply");
    using constValueProp = scriptResult.getProperty("constValue");

    expect(resultProp?.asNumber()).toBe(42); // 21 * 2 = 42
    expect(multiplyProp?.isFunction()).toBe(true);
    expect(constValueProp?.asNumber()).toBe(42);

    // Verify the function still works when called directly
    using arg = context.newNumber(10);
    using callResult = context.callFunction(multiplyProp, null, arg);
    expect(callResult.unwrap().asNumber()).toBe(20);
  });

  it("should handle class static initialization blocks", () => {
    const code = `
   class MyClass {
     static value = 10;
     
     // Static initialization block
     static {
       this.computedValue = this.value * 2;
       this.initialized = true;
     }
     
     static getValue() {
       return this.computedValue;
     }
   }
   
   // Export the class and its static properties
   ({
     MyClass: MyClass,
     value: MyClass.value,
     computedValue: MyClass.computedValue,
     initialized: MyClass.initialized,
     getValue: MyClass.getValue()
   });
 `;

    using compileResult = context.compileToByteCode(code, {
      type: "global",
      fileName: "class-static-init-test.js",
    });
    const bytecode = compileResult.unwrap();

    using evalResult = context.evalByteCode(bytecode);
    using result = evalResult.unwrap();

    // Check that static initialization block executed
    using valueProp = result.getProperty("value");
    using computedValueProp = result.getProperty("computedValue");
    using initializedProp = result.getProperty("initialized");
    using getValueProp = result.getProperty("getValue");

    expect(valueProp?.asNumber()).toBe(10);
    expect(computedValueProp?.asNumber()).toBe(20); // 10 * 2
    expect(initializedProp?.asBoolean()).toBe(true);
    expect(getValueProp?.asNumber()).toBe(20);

    // Test that the class itself is functional
    using classConstructor = result.getProperty("MyClass");
    expect(classConstructor.isFunction()).toBe(true);
  });
});
