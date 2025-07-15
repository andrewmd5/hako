import { PrimJSError } from "../etc/errors";
import type { HakoRuntime } from "../host/runtime";
import type { DisposableResult } from "../mem/lifetime";
import type { CModuleInitializer } from "../vm/cmodule";
import type { VMContext } from "../vm/context";
import type { VMValue } from "../vm/value";
import type { VmCallResult } from "../vm/vm-interface";

/**
 * Opaque type helper that wraps a basic type with a specific string tag
 * for type safety while maintaining the underlying type's functionality.
 *
 * @template T - The underlying type (e.g., string, number)
 * @template K - A string literal used as a type tag
 */
type Opaque<T, K extends string> = T & { __typename: K };
/**
 * Base64-encoded string type. Uses the Opaque type pattern to differentiate
 * from regular strings at the type level while maintaining string compatibility.
 */
export type Base64 = Opaque<string, "base64">;
//=============================================================================
// Pointer Types
//=============================================================================
/**
 * Pointer to a JavaScript runtime instance in WebAssembly memory.
 * Maps to LEPUSRuntime* in C code.
 */
export type JSRuntimePointer = number;
/**
 * Pointer to a JavaScript execution context in WebAssembly memory.
 * Maps to LEPUSContext* in C code.
 */
export type JSContextPointer = number;
/**
 * Pointer to a mutable JavaScript value in WebAssembly memory.
 * Maps to LEPUSValue* in C code.
 */
export type JSValuePointer = number;
/**
 * Pointer to a constant JavaScript value in WebAssembly memory.
 * Maps to LEPUSValueConst* in C code.
 */
export type JSValueConstPointer = number;
/**
 * A numerical value representing the JavaScript type of a value.
 */
export type HAKOTypeOf = number;
/**
 * JavaScript property atom identifier. Represents a property name
 * that has been interned for faster property lookups.
 * Maps to LEPUSAtom in C code.
 */
export type JSAtom = number;
/**
 * Pointer to a null-terminated C string in WebAssembly memory.
 * Maps to CString in C code.
 */
export type CString = number;
/**
 * Pointer to heap-allocated character data that must be freed.
 * Maps to OwnedHeapChar in C code.
 */
export type OwnedHeapChar = number;
/**
 * Pointer to opaque data in WebAssembly memory.
 */
export type JSVoid = number;
/**
 * Boolean type used in the LEPUS/QuickJS C API.
 * -1: Exception occurred
 * 0: False
 * 1: True
 */
export type LEPUS_BOOL = -1 | 0 | 1;
/**
 * LEPUS_BOOL constant representing an exception state.
 */
export const LEPUS_EXCEPTION: LEPUS_BOOL = -1;
/**
 * LEPUS_BOOL constant representing false.
 */
export const LEPUS_FALSE: LEPUS_BOOL = 0;
/**
 * LEPUS_BOOL constant representing true.
 */
export const LEPUS_TRUE: LEPUS_BOOL = 1;
export type LEPUSModuleDef = number;
/**
 * Converts a LEPUS_BOOL value to a JavaScript boolean.
 *
 * @param value - The LEPUS_BOOL value to convert
 * @returns The corresponding JavaScript boolean
 * @throws {PrimJSError} If the value is not a valid LEPUS_BOOL
 */
export function LEPUS_BOOLToBoolean(value: LEPUS_BOOL): boolean {
  switch (value) {
    case LEPUS_FALSE:
      return false;
    case LEPUS_TRUE:
      return true;
    default:
      throw new PrimJSError(`Invalid LEPUS_BOOL value: ${value}`);
  }
}
//=============================================================================
// Callback Types
//=============================================================================
/**
 * Host function type that can be called from the JavaScript environment.
 *
 * @template VmHandle - Type representing a VM value handle
 * @param this - The 'this' value for the function call
 * @param args - Arguments passed to the function from JavaScript
 * @returns A VM value handle, VM call result, or void
 */
export type HostCallbackFunction<VmHandle> = (
  this: VmHandle,
  ...args: VmHandle[]
  // biome-ignore lint/suspicious/noConfusingVoidType: you're annoying
) => VmHandle | VmCallResult<VmHandle> | void;
export type ModuleLoaderResult =
  | { type: "source"; data: string } // Source code
  | { type: "precompiled"; data: number } // Pointer to LEPUSModuleDef
  | { type: "error" } // Module not found
  | null;
/**
 * Function used to load JavaScript module source code.
 *
 * @param moduleName - The name of the module to load
 * @param attributes - Import attributes object (e.g., { type: "json" })
 * @returns The module source code as a string, null if not found
 */
export type ModuleLoaderFunction = (
  moduleName: string,
  attributes?: Record<string, string>
) => ModuleLoaderResult;
/**
 * Function used to normalize module specifiers to absolute module names.
 *
 * @param baseName - The base module name (typically the importing module's name)
 * @param moduleName - The module specifier to normalize
 * @returns The normalized module name
 */
export type ModuleNormalizerFunction = (
  baseName: string,
  moduleName: string
) => string;
/**
 * Function used to resolve module names (import.meta.resolve).
 *
 * @param moduleName - The module name to resolve
 * @param currentModule - The current module context
 * @returns The fully qualified path to the module, or undefined if not found
 */
export type ModuleResolverFunction = (
  moduleName: string,
  currentModule?: string
) => string | undefined;
/**
 * Function used to initialize a C module.
 * This is called when the module is loaded into the runtime.
 *
 * @param module - The CModuleInitializer instance representing the module
 * @returns A status code indicating success (0) or failure (non-zero)
 */
export type ModuleInitFunction = (module: CModuleInitializer) => number;
/**
 * Function used to finalize a C classes
 */
export type ClassConstructorHandler = (
  context: VMContext,
  newTarget: VMValue,
  args: VMValue[],
  classId: number
) => VMValue;
export type ClassFinalizerHandler = (
  runtime: HakoRuntime,
  opaque: number,
  classId: number
) => void;
export interface ClassOptions {
  finalizer?: ClassFinalizerHandler;
  methods?: Record<string, HostCallbackFunction<VMValue>>;
  staticMethods?: Record<string, HostCallbackFunction<VMValue>>;
}
/**
 * Basic interrupt handler function signature for C callbacks.
 * This is the low-level function called by the C side.
 *
 * @returns `true` to interrupt JavaScript execution, `false` to continue
 */
export type InterruptHandlerFunction = () => boolean;
/**
 * Enhanced interrupt handler that receives the runtime object.
 * Determines if JavaScript execution inside the VM should be interrupted.
 *
 * @param runtime - The Hako runtime instance that is executing JavaScript
 * @param context - The VM context in which the JavaScript is executing
 * @param opaque - Opaque pointer data passed through from the enableInterruptHandler call
 * @returns `true` to interrupt JS execution, `false` or `undefined` to continue
 */
export type InterruptHandler = (
  runtime: HakoRuntime,
  context: VMContext,
  opaque: JSVoid
) => boolean | undefined;
/**
 * Phase type for the trace events we're tracking
 */
export type TraceEventPhase = "B" | "E";
/**
 * Structure of a trace event for function profiling
 */
export type TraceEvent = {
  /** Function name */
  name: string;
  /** Category - always "js" for our events */
  cat: "js";
  /** Phase - 'B' for begin or 'E' for end */
  ph: TraceEventPhase;
  /** Timestamp in microseconds */
  ts: number;
  /** Process ID - always 1 for our events */
  pid: 1;
  /** Thread ID - always 1 for our events */
  tid: 1;
};
/**
 * Handler for function profiling events
 */
export type ProfilerEventHandler = {
  /**
   * Handler for function start event
   * @param context - The VM context in which the function is executing
   * @param event - The trace event for the function start
   * @param opaque - Opaque pointer data passed through from the caller
   */
  onFunctionStart: (
    context: VMContext,
    event: TraceEvent,
    opaque: JSVoid
  ) => void;
  /**
   * Handler for function end event
   * @param context - The VM context in which the function is executing
   * @param event - The trace event for the function end
   * @param opaque - Opaque pointer data passed through from the caller
   */
  onFunctionEnd: (
    context: VMContext,
    event: TraceEvent,
    opaque: JSVoid
  ) => void;
};
/**
 * Result type for executing pending Promise jobs (microtasks).
 * On success, contains the number of jobs executed.
 * On failure, contains the error value and associated context.
 */
export type ExecutePendingJobsResult = DisposableResult<
  /** Number of jobs successfully executed. */
  number,
  /** The error that occurred. */
  VMValue & {
    /** The context where the error occurred. */
    context: VMContext;
  }
>;
//=============================================================================
// Intrinsics Constants and Configuration
//=============================================================================

export const INTRINSIC_BASE_OBJECTS = 1 << 0;
export const INTRINSIC_DATE = 1 << 1;
export const INTRINSIC_EVAL = 1 << 2;
export const INTRINSIC_STRING_NORMALIZE = 1 << 3;
export const INTRINSIC_REGEXP = 1 << 4;
export const INTRINSIC_REGEXP_COMPILER = 1 << 5;
export const INTRINSIC_JSON = 1 << 6;
export const INTRINSIC_PROXY = 1 << 7;
export const INTRINSIC_MAP_SET = 1 << 8;
export const INTRINSIC_TYPED_ARRAYS = 1 << 9;
export const INTRINSIC_PROMISE = 1 << 10;
export const INTRINSIC_BIGINT = 1 << 11;
export const INTRINSIC_BIGFLOAT = 1 << 12;
export const INTRINSIC_BIGDECIMAL = 1 << 13;
export const INTRINSIC_OPERATOR_OVERLOADING = 1 << 14;
export const INTRINSIC_BIGNUM_EXT = 1 << 15;
export const INTRINSIC_PERFORMANCE = 1 << 16;
export const INTRINSIC_CRYPTO = 1 << 17;

const INTRINSIC_FLAG_MAP = {
  BaseObjects: INTRINSIC_BASE_OBJECTS,
  Date: INTRINSIC_DATE,
  Eval: INTRINSIC_EVAL,
  StringNormalize: INTRINSIC_STRING_NORMALIZE,
  RegExp: INTRINSIC_REGEXP,
  RegExpCompiler: INTRINSIC_REGEXP_COMPILER,
  JSON: INTRINSIC_JSON,
  Proxy: INTRINSIC_PROXY,
  MapSet: INTRINSIC_MAP_SET,
  TypedArrays: INTRINSIC_TYPED_ARRAYS,
  Promise: INTRINSIC_PROMISE,
  BigInt: INTRINSIC_BIGINT,
  BigFloat: INTRINSIC_BIGFLOAT,
  BigDecimal: INTRINSIC_BIGDECIMAL,
  OperatorOverloading: INTRINSIC_OPERATOR_OVERLOADING,
  BignumExt: INTRINSIC_BIGNUM_EXT,
  Performance: INTRINSIC_PERFORMANCE,
  Crypto: INTRINSIC_CRYPTO,
} as const;

export type Intrinsics = {
  [K in keyof typeof INTRINSIC_FLAG_MAP]?: boolean;
};

/**
 * The default set of JavaScript language features enabled in a new context.
 * @see {@link ContextOptions}
 */
export const DefaultIntrinsics = Object.freeze({
  BaseObjects: true,
  Date: true,
  Eval: true,
  StringNormalize: true,
  RegExp: true,
  JSON: true,
  Proxy: true,
  MapSet: true,
  TypedArrays: true,
  Promise: true,
} as const satisfies Intrinsics);

/**
 * Converts an Intrinsics object into the corresponding bitfield value.
 *
 * @param intrinsics - The Intrinsics configuration object
 * @returns A combined value representing all enabled features
 */
export function intrinsicsToFlags(intrinsics: Intrinsics): number {
  return Object.entries(intrinsics).reduce((result, [key, enabled]) => {
    if (enabled && key in INTRINSIC_FLAG_MAP) {
      return result | INTRINSIC_FLAG_MAP[key as keyof typeof INTRINSIC_FLAG_MAP];
    }
    return result;
  }, 0);
}

//=============================================================================
// Context Configuration
//=============================================================================
/**
 * Configuration options for creating a JavaScript execution context.
 * Pass to {@link HakoRuntime#newContext}.
 */
export interface ContextOptions {
  /**
   * What built-in objects and language features to enable?
   * If unset, the default intrinsics will be used.
   * To omit all intrinsics, pass an empty array.
   *
   * To remove a specific intrinsic, but retain the other defaults,
   * override it from {@link DefaultIntrinsics}
   * ```ts
   * const contextWithoutDateOrEval = runtime.newContext({
   * intrinsics: {
   * ...DefaultIntrinsics,
   * Date: false,
   * }
   * })
   * ```
   */
  intrinsics?: Intrinsics;
  /**
   * Wrap the provided context instead of constructing a new one.
   * @private Used internally, not intended for direct use
   */
  contextPointer?: JSContextPointer;
  /**
   * Maximum stack size for JavaScript execution in this context, in bytes.
   * Helps prevent stack overflow attacks in untrusted code.
   */
  maxStackSizeBytes?: number;
}

//=============================================================================
// Evaluation Configuration
//=============================================================================

// EvalFlag constants
export const EVAL_FLAG_GLOBAL = 0; // LEPUS_EVAL_TYPE_GLOBAL (0 << 0)
export const EVAL_FLAG_MODULE = 1 << 0; // LEPUS_EVAL_TYPE_MODULE (1 << 0)
export const EVAL_FLAG_DIRECT = 2 << 0; // LEPUS_EVAL_TYPE_DIRECT (2 << 0)
export const EVAL_FLAG_INDIRECT = 3 << 0; // LEPUS_EVAL_TYPE_INDIRECT (3 << 0)
export const EVAL_FLAG_TYPE_MASK = 3 << 0; // LEPUS_EVAL_TYPE_MASK (3 << 0)
export const EVAL_FLAG_STRICT = 1 << 3; // LEPUS_EVAL_FLAG_STRICT (1 << 3)
export const EVAL_FLAG_RESERVED = 1 << 4; // LEPUS_EVAL_FLAG_STRIP (1 << 4)
export const EVAL_FLAG_COMPILE_ONLY = 1 << 5; // LEPUS_EVAL_FLAG_COMPILE_ONLY (1 << 5)
export const EVAL_FLAG_DEBUGGER_NO_PERSIST_SCRIPT = 1 << 6; // LEPUS_DEBUGGER_NO_PERSIST_SCRIPT (1 << 6)

/**
 * Type for evaluation flag values
 */
export type EvalFlag = number;

/**
 * Bit flag for stripping source code
 * @internal
 */
export const JS_STRIP_SOURCE = 1 << 0; // 1
/**
 * Bit flag for stripping all debug information including source code
 * @internal
 */
export const JS_STRIP_DEBUG = 1 << 1; // 2
/**
 * Options for configuring code stripping behavior
 */
export interface StripOptions {
  /**
   * When true, source code will be stripped from the compiled output
   */
  stripSource?: boolean;
  /**
   * When true, all debug information including source code will be stripped
   * Setting this to true automatically enables stripSource as well
   */
  stripDebug?: boolean;
}
/**
 * Options for evaluating JavaScript code in a context.
 */
export interface ContextEvalOptions {
  /**
   * Global code (default), or "module" code?
   *
   * - When type is `"global"`, the code is evaluated in the global scope of the context,
   * and the return value is the result of the last expression.
   * - When type is `"module"`, the code is evaluated as a module scope, may use `import`,
   * `export`, and top-level `await`. The return value is the module's exports,
   * or a promise for the module's exports.
   */
  type?: "global" | "module";
  /** Force "strict" mode */
  strict?: boolean;
  /**
   * Compile but do not run the code. The result is an object with a
   * JS_TAG_FUNCTION_BYTECODE or JS_TAG_MODULE tag. It can be executed
   * with JS_EvalFunction().
   */
  compileOnly?: boolean;
  /** Don't persist script in debugger */
  noPersist?: boolean;
  /** Filename for error reporting */
  fileName?: string;
  /** Automatically detect if code should be treated as a module */
  detectModule?: boolean;
}
/**
 * Converts evaluation options to the corresponding bitfield flags.
 *
 * @param evalOptions - Options object, number (raw flags), or undefined
 * @returns The combined EvalFlag bitfield
 */
export function evalOptionsToFlags(
  evalOptions: ContextEvalOptions | number | undefined
): EvalFlag {
  if (typeof evalOptions === "number") {
    return evalOptions;
  }
  if (evalOptions === undefined) {
    return EVAL_FLAG_GLOBAL;
  }
  if (
    evalOptions.type !== undefined &&
    evalOptions.type !== "global" &&
    evalOptions.type !== "module"
  ) {
    throw new PrimJSError(
      `Invalid eval type: ${evalOptions.type}. Must be "global" or "module".`
    );
  }
  const { type, strict, compileOnly, noPersist } = evalOptions;
  let flags = 0;
  if (type === "global") flags |= EVAL_FLAG_GLOBAL;
  if (type === "module") flags |= EVAL_FLAG_MODULE;
  if (strict) flags |= EVAL_FLAG_STRICT;
  if (compileOnly) flags |= EVAL_FLAG_COMPILE_ONLY;
  if (noPersist) flags |= EVAL_FLAG_DEBUGGER_NO_PERSIST_SCRIPT;
  return flags;
}

//=============================================================================
// Promise States
//=============================================================================
/**
 * JavaScript Promise states.
 */
export type PromiseState =
  /** Promise has not been resolved or rejected yet */
  | "pending"
  /** Promise has been resolved with a value */
  | "fulfilled"
  /** Promise has been rejected with a reason */
  | "rejected";

//=============================================================================
// Property Enumeration
//=============================================================================

// PropertyEnumFlags constants
export const PROPERTY_ENUM_STRING = 1 << 0;
export const PROPERTY_ENUM_SYMBOL = 1 << 1;
export const PROPERTY_ENUM_PRIVATE = 1 << 2;
export const PROPERTY_ENUM_ENUMERABLE = 1 << 4;
export const PROPERTY_ENUM_NON_ENUMERABLE = 1 << 5;
export const PROPERTY_ENUM_CONFIGURABLE = 1 << 6;
export const PROPERTY_ENUM_NON_CONFIGURABLE = 1 << 7;
export const PROPERTY_ENUM_NUMBER = 1 << 14;
export const PROPERTY_ENUM_COMPLIANT = 1 << 15;

/**
 * Type for property enumeration flag values
 */
export type PropertyEnumFlags = number;

//=============================================================================
// JavaScript Types
//=============================================================================

/**
 * String representation of JavaScript types, aligned with typeof operator results.
 */
export type JSType =
  | "undefined"
  | "object"
  | "string"
  | "symbol"
  | "boolean"
  | "number"
  | "bigint"
  | "function";

//=============================================================================
// Value Lifecycle Management
//=============================================================================
/**
 * Lifecycle modes for JavaScript values.
 */
export type ValueLifecycle = "owned" | "borrowed" | "temporary";

//=============================================================================
// Memory Usage Information
//=============================================================================
/**
 * Memory usage statistics returned by HAKO_RuntimeComputeMemoryUsage.
 * Provides detailed information about memory consumption by different components.
 */
export interface MemoryUsage {
  /** Maximum memory limit in bytes, or -1 if no limit */
  malloc_limit: number;
  /** Current memory usage in bytes */
  memory_used_size: number;
  /** Number of active malloc allocations */
  malloc_count: number;
  /** Total count of memory allocations */
  memory_used_count: number;
  /** Number of interned property names (atoms) */
  atom_count: number;
  /** Memory used by atoms in bytes */
  atom_size: number;
  /** Number of string objects */
  str_count: number;
  /** Memory used by strings in bytes */
  str_size: number;
  /** Number of JavaScript objects */
  obj_count: number;
  /** Memory used by objects in bytes */
  obj_size: number;
  /** Number of object properties */
  prop_count: number;
  /** Memory used by properties in bytes */
  prop_size: number;
  /** Number of object shapes */
  shape_count: number;
  /** Memory used by shapes in bytes */
  shape_size: number;
  /** Number of JavaScript functions */
  lepus_func_count: number;
  /** Memory used by functions in bytes */
  lepus_func_size: number;
  /** Memory used by function bytecode in bytes */
  lepus_func_code_size: number;
  /** Number of PC to line mappings for debugging */
  lepus_func_pc2line_count: number;
  /** Memory used by PC to line mappings in bytes */
  lepus_func_pc2line_size: number;
  /** Number of C functions exposed to JavaScript */
  c_func_count: number;
  /** Number of arrays */
  array_count: number;
  /** Number of fast arrays (optimized for numeric indices) */
  fast_array_count: number;
  /** Number of elements in fast arrays */
  fast_array_elements: number;
  /** Number of binary objects (ArrayBuffer, TypedArray) */
  binary_object_count: number;
  /** Memory used by binary objects in bytes */
  binary_object_size: number;
}

//=============================================================================
// Property Descriptors
//=============================================================================
/**
 * Property descriptor for defining object properties.
 * Similar to the standard JavaScript Object.defineProperty descriptor.
 */
export interface PropertyDescriptor {
  /** Property value */
  value?: VMValue;
  /** Whether the property can be changed and deleted */
  configurable?: boolean;
  /** Whether the property shows up during enumeration */
  enumerable?: boolean;
  /** Getter function */
  get?: (this: VMValue) => VMValue;
  /** Setter function */
  set?: (this: VMValue, value: VMValue) => void;
}

//=============================================================================
// Resource Limits
//=============================================================================
/**
 * Configuration options for resource-limited interrupt handlers.
 */
export interface ResourceLimitOptions {
  /** Maximum execution time in milliseconds */
  maxTimeMs?: number;
  /** Maximum memory usage in bytes */
  maxMemoryBytes?: number;
  /** Maximum number of steps to execute */
  maxSteps?: number;
  /** How often to check memory usage (every N steps) */
  memoryCheckInterval?: number;
}

//=============================================================================
// Additional Types
//=============================================================================
/** Uses === operator semantics */
type EqualOpStrict = "strict";
/** Uses Object.is() semantics */
type EqualOpSame = "same";
/** Uses Array.prototype.includes() semantics (treats +0 and -0 as equal) */
type EqualOpSameZero = "same-zero";
export type EqualOp = EqualOpStrict | EqualOpSame | EqualOpSameZero;

/**
 * Promise executor function type, compatible with standard JavaScript Promise.
 */
export type PromiseExecutor<ResolveT, RejectT> = (
  resolve: (value: ResolveT | PromiseLike<ResolveT>) => void,
  reject: (reason: RejectT) => void
) => void;

/**
 * Result type for VMContext operations.
 */
export type VMContextResult<S> = DisposableResult<S, VMValue>;

/**
 * Interface for Error objects with an options property containing a cause.
 */
interface ErrorWithOptions extends Error {
  options?: {
    cause?: unknown;
  };
}

/**
 * Type guard to check if an Error has options with a cause property.
 *
 * @param error - The error to check
 * @returns True if the error has options with a cause
 */
export function hasOptionsWithCause(error: Error): error is ErrorWithOptions {
  return (
    "options" in error &&
    error.options !== null &&
    typeof error.options === "object" &&
    "cause" in (error.options as object)
  );
}

/**
 * Detects circular references within an object and throws a TypeError when found.
 *
 * @param obj - The object to check for circular references
 * @param path - Optional path string for error messaging (used internally)
 * @throws TypeError when circular reference is detected
 */
export function detectCircularReferences(obj: unknown, path = "root"): void {
  const seen = new Set<unknown>();
  function traverse(value: unknown, currentPath: string): void {
    // Skip primitive values as they can't contain circular references
    if (typeof value !== "object" || value === null) {
      return;
    }
    // Check if we've seen this object before
    if (seen.has(value)) {
      throw new TypeError(`Circular reference detected at ${currentPath}`);
    }
    // Add current object to the set of seen objects
    seen.add(value);
    // Traverse object or array properties
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        traverse(value[i], `${currentPath}[${i}]`);
      }
    } else {
      for (const key of Object.keys(value as object)) {
        traverse(
          (value as Record<string, unknown>)[key],
          `${currentPath}.${key}`
        );
      }
    }
    // Remove current object from the set of seen objects after traversal
    seen.delete(value);
  }
  traverse(obj, path);
}

//=============================================================================
// Build Information
//=============================================================================
/**
 * Information about the build configuration of the Hako WebAssembly module.
 */
export type HakoBuildInfo = {
  /** Version string of the Hako library */
  version: string;
  /** Raw flags value representing build configuration */
  flags: number;
  /** Date and time the module was built */
  buildDate: string;
  /** Version of the WASI SDK used */
  wasiSdkVersion: string;
  /** Version of WASI libc used */
  wasiLibc: string;
  /** LLVM compiler used */
  llvm: string;
  /** Version of LLVM used */
  llvmVersion: string;
  /** Build configuration string */
  config: string;
  // Flag convenience booleans
  /** Whether this is a debug build */
  isDebug: boolean;
  /** Whether sanitizers are enabled */
  hasSanitizer: boolean;
  /** Whether BigNum support is enabled */
  hasBignum: boolean;
  /** Whether LepusNG (next-gen engine) is enabled */
  hasLepusNG: boolean;
  /** Whether debugger support is enabled */
  hasDebugger: boolean;
  /** Whether snapshot support is enabled */
  hasSnapshot: boolean;
  /** Whether compatible memory management is enabled */
  hasCompatibleMM: boolean;
  /** Whether NaN boxing is enabled */
  hasNanbox: boolean;
  /** Whether code cache is enabled */
  hasCodeCache: boolean;
  /** Whether cache profiling is enabled */
  hasCacheProfile: boolean;
  /** Whether memory detection is enabled */
  hasMemDetection: boolean;
  /** Whether atomics support is enabled */
  hasAtomics: boolean;
  /** Whether force garbage collection is enabled */
  hasForceGC: boolean;
  /** Whether Lynx simplification is enabled */
  hasLynxSimplify: boolean;
  /** Whether builtin serialization is enabled */
  hasBuiltinSerialize: boolean;
  /** Whether hako was compiled with profiling enabled */
  hasHakoProfiler: boolean;
};

/**
 * Type of JavaScript TypedArray.
 */
export type TypedArrayType =
  | "Unknown"
  | "Uint8Array"
  | "Uint8ClampedArray"
  | "Int8Array"
  | "Uint16Array"
  | "Int16Array"
  | "Uint32Array"
  | "Int32Array"
  | "BigUint64Array"
  | "BigInt64Array"
  | "Float16Array"
  | "Float32Array"
  | "Float64Array";