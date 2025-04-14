<div align="center">

<p>
  <a href="https://repl.hakojs.com">
    <img width="500" alt="Hako logo" src="https://github.com/user-attachments/assets/d0e2a30f-d5a2-4737-b64f-7d7bad5902b3" />
  </a>
  <p>Hako (ha-ko) or 箱 means “box” in Japanese. </p>
</p>

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0.txt)


Hako is a embeddable, lightweight, secure, high-performance JavaScript engine. It is a fork of PrimJS; Hako has full support for ES2019 and later ESNext features, and offers superior performance and a better development experience when compared to QuickJS. 

</div>


## Installation

```bash
npm install hakojs
```

## Runtime and Context Lifecycle

Creating and properly disposing of runtimes and contexts:

```javascript
import { createHakoRuntime, decodeVariant, HAKO_PROD } from "hakojs";

// Initialize with the WASM binary
const wasmBinary = decodeVariant(HAKO_PROD);
const runtime = await createHakoRuntime({
  wasm: {
    io: {
      stdout: (lines) => console.log(lines),
      stderr: (lines) => console.error(lines),
    }
  },
  loader: {
    binary: wasmBinary,
  }
});

// Create a JavaScript execution context
const vm = runtime.createContext();

// Always clean up resources when done
vm.release();
runtime.release();

// Modern JavaScript using the Disposable pattern
using runtime = await createHakoRuntime({...});
using vm = runtime.createContext();
```

## Code Evaluation

```javascript
// Evaluate simple expressions
using result = vm.evalCode("1 + 2");
if (!result.error) {
  const value = result.unwrap();
  console.log(value.asNumber()); // 3
}

// Using unwrapResult for error handling
try {
  using successResult = vm.evalCode("40 + 2");
  const value = vm.unwrapResult(successResult);
  console.log(value.asNumber()); // 42
} catch (error) {
  console.error("Error:", error);
}

// Evaluating with custom filename
using result = vm.evalCode("1 + 2", { fileName: "test.js" });
```

## Resource Management

### VMValue Lifecycle

```javascript
// Always dispose VMValues when no longer needed
const strVal = vm.newString("hello");
try {
  // Use strVal...
  console.log(strVal.asString());
} finally {
  strVal.dispose();
}

// Using statement with TypeScript 5.2+
using numVal = vm.newNumber(42.5);
console.log(numVal.asNumber());
// Automatically disposed at end of scope
```

### Creating and Managing Objects

```javascript
using obj = vm.newObject();

// Set properties
using nameVal = vm.newString("test");
using numVal = vm.newNumber(42);

obj.setProperty("name", nameVal);
obj.setProperty("value", numVal);

// Get properties
using retrievedName = obj.getProperty("name");
using retrievedValue = obj.getProperty("value");

console.log(retrievedName.asString()); // "test"
console.log(retrievedValue.asNumber()); // 42
```

### Working with Arrays

```javascript
const arr = vm.newArray();

// Add elements
arr.setProperty(0, "hello");
arr.setProperty(1, 42);
arr.setProperty(2, true);

// Get length
const lengthProp = arr.getProperty("length");
console.log(lengthProp.asNumber()); // 3

// Get elements
const elem0 = arr.getProperty(0);
const elem1 = arr.getProperty(1);
const elem2 = arr.getProperty(2);

console.log(elem0.asString()); // "hello"
console.log(elem1.asNumber()); // 42
console.log(elem2.asBoolean()); // true

// Always clean up resources
arr.dispose();
elem0.dispose();
elem1.dispose();
elem2.dispose();
lengthProp.dispose();
```

## Converting Between JavaScript and VM Values

```javascript
// Convert JavaScript values to VM values
using testString = vm.newValue("hello");
using testNumber = vm.newValue(42.5);
using testBool = vm.newValue(true);
using testNull = vm.newValue(null);
using testUndefined = vm.newValue(undefined);
using testArray = vm.newValue([1, "two", true]);
using testObj = vm.newValue({ name: "test", value: 42 });
using testBuffer = vm.newValue(new Uint8Array([1, 2, 3]));

// Convert VM values to JavaScript values
using str = vm.newString("hello");
using jsVal = str.toNativeValue();
console.log(jsVal.value); // "hello"
jsVal.dispose(); // Always dispose NativeBox

// Complex conversions
using obj = vm.newObject();
obj.setProperty("name", "test");
obj.setProperty("value", 42);

using objJS = obj.toNativeValue();
console.log(objJS.value); // { name: "test", value: 42 }
objJS.dispose();
```

## Working with Functions

```javascript
// Create a function in the VM
using func = vm.newFunction("add", (a, b) => {
  return vm.newNumber(a.asNumber() + b.asNumber());
});

// Call the function
using arg1 = vm.newNumber(5);
using arg2 = vm.newNumber(7);
using result = vm.callFunction(func, vm.undefined(), arg1, arg2);

console.log(result.unwrap().asNumber()); // 12
```

## Error Handling

```javascript
// Create and throw errors
const errorMsg = new Error("Test error message");
using error = vm.newError(errorMsg);
using exception = vm.throwError(error);
const lastError = vm.getLastError(exception);
console.log(lastError.message); // "Test error message"

// Throw errors from strings
using thrownError = vm.throwError("Direct error message");
const lastError = vm.getLastError(thrownError);
console.log(lastError.message); // "Direct error message"

// Handle evaluation errors
using result = vm.evalCode('throw new Error("Test exception");');
if (result.error) {
  console.error("Evaluation failed:", vm.getLastError(result.error));
} else {
  // Use result.unwrap()...
}
```

## Promise Handling

```javascript
// Example: Using promises with a fake file system
const fakeFileSystem = new Map([["example.txt", "Example file content"]]);

using readFileHandle = vm.newFunction("readFile", (pathHandle) => {
  const path = pathHandle.asString();
  pathHandle.dispose();
  
  // Create a promise
  const promise = vm.newPromise();
  
  // Resolve it asynchronously
  setTimeout(() => {
    const content = fakeFileSystem.get(path);
    using contentHandle = vm.newString(content || "");
    promise.resolve(contentHandle);
    
    // IMPORTANT: Execute pending jobs after resolving
    promise.settled.then(() => vm.runtime.executePendingJobs());
  }, 100);
  
  return promise.handle;
});

// Register the function in the global object
using glob = vm.getGlobalObject();
glob.setProperty("readFile", readFileHandle);

// Use the function in async code
using result = vm.evalCode(`(async () => {
  const content = await readFile('example.txt')
  return content;
})()`);

// Resolve the promise in host JavaScript
using promiseHandle = vm.unwrapResult(result);
using resolvedResult = await vm.resolvePromise(promiseHandle);
using resolvedHandle = vm.unwrapResult(resolvedResult);
console.log(resolvedHandle.asString()); // "Example file content"
```

Sure, I'll add the map iterator example and update the module example to show calling the exported function.

## Iterating Maps with getIterator

```javascript
// Create a Map in the VM 
using result = vm.evalCode(`
  const map = new Map();
  map.set("key1", "value1");
  map.set("key2", "value2");
  map;
`);
using map = result.unwrap();

// Iterate over the map entries
for (using entriesBox of vm.getIterator(map).unwrap()) {
  using entriesHandle = entriesBox.unwrap();
  using keyHandle = entriesHandle.getProperty(0).toNativeValue();
  using valueHandle = entriesHandle.getProperty(1).toNativeValue();
  
  // Process key-value pairs
  if (keyHandle.value === "key1") {
    console.log(valueHandle.value); // "value1"
  }
  if (keyHandle.value === "key2") {
    console.log(valueHandle.value); // "value2"
  }
}
```

## Working with ES Modules

```javascript
// Setup a module loader
const moduleMap = new Map([
  ["my-module", `
    export const hello = (name) => {
      return "Hello, " + name + "!";
    }
  `]
]);

// Enable module loading
runtime.enableModuleLoader((moduleName) => {
  return moduleMap.get(moduleName) || null;
});

// Use modules in code
using result = vm.evalCode(`
  import { hello } from 'my-module';
  
  export const sayGoodbye = (name) => {
    return "Goodbye, " + name + "!";
  }
  
  export const greeting = hello("World");
`, { type: "module" });

// Access exported values
using jsValue = result.unwrap();
using jsObject = jsValue.toNativeValue();
console.log(jsObject.value.greeting); // "Hello, World!"

// Call exported function directly
console.log(jsObject.value.sayGoodbye("Tester")); // "Goodbye, Tester!"
```

```javascript
// Setup a module loader
const moduleMap = new Map([
  ["my-module", `
    export const hello = (name) => {
      return "Hello, " + name + "!";
    }
  `]
]);

// Enable module loading
runtime.enableModuleLoader((moduleName) => {
  return moduleMap.get(moduleName) || null;
});

// Use modules in code
using result = vm.evalCode(`
  import { hello } from 'my-module';
  
  export const sayGoodbye = (name) => {
    return "Goodbye, " + name + "!";
  }
  
  export const greeting = hello("World");
`, { type: "module" });

// Access exported values
using jsValue = result.unwrap();
using jsObject = jsValue.toNativeValue();
console.log(jsObject.value.greeting); // "Hello, World!"
```

## Monitoring and Control

```javascript
// Add an interrupt handler to prevent infinite loops
const handler = runtime.createGasInterruptHandler(1000);
runtime.enableInterruptHandler(handler);

// Set memory constraints
vm.setMaxStackSize(1024 * 1024); // 1MB stack limit

// Enable profiling
const traceProfiler = createTraceProfiler(); // See implementation in the docs
runtime.enableProfileCalls(traceProfiler);
```

## Binary Data Transfer

```javascript
// Working with ArrayBuffers
const data = new Uint8Array([1, 2, 3, 4, 5]);
using arrBuf = vm.newArrayBuffer(data);

// Get the data back
const retrievedData = arrBuf.copyArrayBuffer();
console.log(new Uint8Array(retrievedData)); // Uint8Array([1, 2, 3, 4, 5])

// Binary JSON serialization
using obj = vm.newValue({
  string: "hello",
  number: 42,
  boolean: true,
  array: [1, 2, 3],
  nested: { a: 1, b: 2 },
});

// Encode to binary JSON
const encoded = vm.bjsonEncode(obj);

// Decode from binary JSON
using decoded = vm.bjsonDecode(encoded);
```

## Memory Management Best Practices

1. **Always dispose VMValues** when they're no longer needed
2. **Use the `using` statement** when possible (TypeScript 5.2+)
3. **Check for `.error` in results** before unwrapping them
4. **Call `runtime.executePendingJobs()`** after resolving promises
5. **Release contexts and runtimes** when they're no longer needed
6. **Be careful with circular references** when converting between VM and JS values
7. **Use `vm.unwrapResult()`** to handle errors consistently

## Note

If you're targeting a JavaScript runtime or browser that doesn't support `using` statements, you will need to use Rollup, Babel, or esbuild to transpile your code to a compatible version. The `using` statement is a TypeScript 5.2+ feature that allows for automatic resource management and it is used extensively inside Hako.