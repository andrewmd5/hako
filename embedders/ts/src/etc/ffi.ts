/**
 * Generated on: 2025-04-14 08:27:22
 * Source file: hako.h
 * Git commit: 1ac71aadb54d23306f1bee8b1b982128dfc4cf4f
 * Git branch: main
 * Git author: andrew <1297077+andrewmd5@users.noreply.github.com>
 * Git remote: https://github.com/andrewmd5/hako.git
 */

/**
 * Generated TypeScript interface for QuickJS exports
 */

import type {
    JSRuntimePointer,
    JSContextPointer,
    JSValuePointer,
    JSValueConstPointer,
    CString,
    OwnedHeapChar,
    LEPUS_BOOL
} from './types';

/**
 * Interface for the raw WASM exports from QuickJS
 */
export interface HakoExports {
    // Memory
    memory: WebAssembly.Memory;
    malloc(size: number): number;
    free(ptr: number): void;

    /**
     * Computes memory usage statistics for the runtime
     *
     * @param rt Runtime to compute statistics for
     * @param ctx Context to use for creating the result object
     * @returns LEPUSValue* - Object containing memory usage statistics
     */
    HAKO_RuntimeComputeMemoryUsage(rt: JSRuntimePointer, ctx: JSContextPointer): JSValuePointer;
    /**
     * Dumps memory usage statistics as a string
     *
     * @param rt Runtime to dump statistics for
     * @returns OwnedHeapChar* - String containing memory usage information
     */
    HAKO_RuntimeDumpMemoryUsage(rt: JSRuntimePointer): CString;

    // Binary JSON
    /**
     * Decodes a value from binary JSON format
     *
     * @param ctx Context to use
     * @param data ArrayBuffer containing encoded data
     * @returns LEPUSValue* - Decoded value
     */
    HAKO_bjson_decode(ctx: JSContextPointer, data: JSValueConstPointer): JSValuePointer;
    /**
     * Encodes a value to binary JSON format
     *
     * @param ctx Context to use
     * @param val Value to encode
     * @returns LEPUSValue* - ArrayBuffer containing encoded data
     */
    HAKO_bjson_encode(ctx: JSContextPointer, val: JSValueConstPointer): JSValuePointer;

    // Constants
    /**
     * Gets a pointer to the false value
     *
     * @returns LEPUSValueConst* - Pointer to the false value
     */
    HAKO_GetFalse(): JSValueConstPointer;
    /**
     * Gets a pointer to the null value
     *
     * @returns LEPUSValueConst* - Pointer to the null value
     */
    HAKO_GetNull(): JSValueConstPointer;
    /**
     * Gets a pointer to the true value
     *
     * @returns LEPUSValueConst* - Pointer to the true value
     */
    HAKO_GetTrue(): JSValueConstPointer;
    /**
     * Gets a pointer to the undefined value
     *
     * @returns LEPUSValueConst* - Pointer to the undefined value
     */
    HAKO_GetUndefined(): JSValueConstPointer;

    // Context Management
    /**
     * Sets the maximum stack size for a context
     *
     * @param ctx Context to configure
     * @param stack_size Maximum stack size in bytes
     */
    HAKO_ContextSetMaxStackSize(ctx: JSContextPointer, stack_size: number): void;
    /**
     * Frees a JavaScript context
     *
     * @param ctx Context to free
     */
    HAKO_FreeContext(ctx: JSContextPointer): void;
    /**
     * Gets opaque data for the context
     *
     * @param ctx Context to get the data from
     * @returns JSVoid* - Pointer to the data
     */
    HAKO_GetContextData(ctx: JSContextPointer): number;
    /**
     * Creates a new JavaScript context
     *
     * @param rt Runtime to create the context in
     * @param intrinsics HAKO_Intrinsic flags to enable
     * @returns LEPUSContext* - Newly created context
     */
    HAKO_NewContext(rt: JSRuntimePointer, intrinsics: number): JSContextPointer;
    /**
     * sets opaque data for the context. you are responsible for freeing the data.
     *
     * @param ctx Context to set the data for
     * @param data Pointer to the data
     */
    HAKO_SetContextData(ctx: JSContextPointer, data: number): void;
    /**
     * If no_lepus_strict_mode is set to true, these conditions will handle, differently: if the object is null or undefined, read properties will return null if the object is null or undefined, write properties will not throw exception.
     *
     * @param ctx Context to set to no strict mode
     */
    HAKO_SetNoStrictMode(ctx: JSContextPointer): void;
    /**
     * Sets the virtual stack size for a context
     *
     * @param ctx Context to set the stack size for
     * @param size Stack size in bytes
     */
    HAKO_SetVirtualStackSize(ctx: JSContextPointer, size: number): void;

    // Debug & Info
    /**
     * Gets the build information
     *
     * @returns HakoBuildInfo* - Pointer to build information
     */
    HAKO_BuildInfo(): number;
    /**
     * Checks if the build is a debug build
     *
     * @returns LEPUS_BOOL - True if debug build, false otherwise
     */
    HAKO_BuildIsDebug(): LEPUS_BOOL;
    /**
     * Checks if the build has leak sanitizer enabled
     *
     * @returns LEPUS_BOOL - True if leak sanitizer is enabled, false otherwise
     */
    HAKO_BuildIsSanitizeLeak(): LEPUS_BOOL;
    /**
     * Enables profiling of function calls
     *
     * @param rt Runtime to enable profiling for
     * @param sampling Sampling rate - If sampling == 0, it's interpreted as "no sampling" which means we log 1/1 calls.
     * @param opaque Opaque data to pass to the callback
     */
    HAKO_EnableProfileCalls(rt: JSRuntimePointer, sampling: number, opaque: number): void;
    /**
     * Gets the PrimJS version number
     *
     * @returns uint64_t - PrimJS version
     */
    HAKO_GetPrimjsVersion(): bigint;
    /**
     * Gets the version string
     *
     * @returns CString* - Version string
     */
    HAKO_GetVersion(): CString;
    /**
     * Performs a recoverable leak check
     *
     * @returns int - Result of leak check
     */
    HAKO_RecoverableLeakCheck(): number;

    // Error Handling
    /**
     * Resolves the the last exception from a context, and returns its Error. Cannot be called twice.
     *
     * @param ctx Context to resolve in
     * @param maybe_exception Value that might be an exception
     * @returns LEPUSValue* - Error object or NULL if not an exception
     */
    HAKO_GetLastError(ctx: JSContextPointer, maybe_exception: JSValuePointer): JSValuePointer;
    /**
     * Checks if a value is an Error
     *
     * @param ctx Context to use
     * @param val Value to check
     * @returns LEPUS_BOOL - 1 if value is an error, 0 otherwise
     */
    HAKO_IsError(ctx: JSContextPointer, val: JSValueConstPointer): LEPUS_BOOL;
    /**
     * Checks if a value is an exception
     *
     * @param val Value to check
     * @returns LEPUS_BOOL - 1 if value is an exception, 0 otherwise
     */
    HAKO_IsException(val: JSValueConstPointer): LEPUS_BOOL;
    /**
     * Throws a JavaScript reference error with a message
     *
     * @param ctx Context to throw the error in
     * @param message Error message
     */
    HAKO_RuntimeJSThrow(ctx: JSContextPointer, message: CString): void;
    /**
     * Throws a JavaScript error
     *
     * @param ctx Context to throw in
     * @param error Error to throw
     * @returns LEPUSValue* - LEPUS_EXCEPTION
     */
    HAKO_Throw(ctx: JSContextPointer, error: JSValueConstPointer): JSValuePointer;

    // Eval
    /**
     * Evaluates JavaScript code
     *
     * @param ctx Context to evaluate in
     * @param js_code Code to evaluate
     * @param js_code_length Code length
     * @param filename Filename for error reporting
     * @param detectModule Whether to auto-detect module code
     * @param evalFlags Evaluation flags
     * @returns LEPUSValue* - Evaluation result
     */
    HAKO_Eval(ctx: JSContextPointer, js_code: CString, js_code_length: number, filename: CString, detectModule: number, evalFlags: number): JSValuePointer;

    // Interrupt Handling
    /**
     * Disables interrupt handler for the runtime
     *
     * @param rt Runtime to disable interrupt handler for
     */
    HAKO_RuntimeDisableInterruptHandler(rt: JSRuntimePointer): void;
    /**
     * Enables interrupt handler for the runtime
     *
     * @param rt Runtime to enable interrupt handler for
     * @param opaque Pointer to user-defined data
     */
    HAKO_RuntimeEnableInterruptHandler(rt: JSRuntimePointer, opaque: number): void;

    // Memory Management
    /**
     * Checks if the context is in garbage collection mode
     *
     * @param ctx Context to check
     * @returns LEPUS_BOOL - True if in GC mode, false otherwise
     */
    HAKO_IsGCMode(ctx: JSContextPointer): LEPUS_BOOL;
    /**
     * Sets the garbage collection threshold
     *
     * @param ctx Context to set the threshold for
     * @param threshold Threshold in bytes
     */
    HAKO_SetGCThreshold(ctx: JSContextPointer, threshold: number): void;

    // Module Loading
    /**
     * Gets the namespace object of a module
     *
     * @param ctx Context to use
     * @param module_func_obj Module function object
     * @returns LEPUSValue* - Module namespace
     */
    HAKO_GetModuleNamespace(ctx: JSContextPointer, module_func_obj: JSValueConstPointer): JSValuePointer;
    /**
     * Disables module loader for the runtime
     *
     * @param rt Runtime to disable module loader for
     */
    HAKO_RuntimeDisableModuleLoader(rt: JSRuntimePointer): void;
    /**
     * Enables module loader for the runtime
     *
     * @param rt Runtime to enable module loader for
     * @param use_custom_normalize Whether to use custom module name normalization
     */
    HAKO_RuntimeEnableModuleLoader(rt: JSRuntimePointer, use_custom_normalize: number): void;

    // Promise
    /**
     * Executes pending promise jobs in the runtime
     *
     * @param rt Runtime to execute jobs in
     * @param maxJobsToExecute Maximum number of jobs to execute
     * @param lastJobContext Pointer to store the context of the last executed job
     * @returns LEPUSValue* - Number of executed jobs or an exception
     */
    HAKO_ExecutePendingJob(rt: JSRuntimePointer, maxJobsToExecute: number, lastJobContext: number): JSValuePointer;
    /**
     * Checks if there are pending promise jobs in the runtime
     *
     * @param rt Runtime to check
     * @returns LEPUS_BOOL - True if jobs are pending, false otherwise
     */
    HAKO_IsJobPending(rt: JSRuntimePointer): LEPUS_BOOL;
    /**
     * Checks if a value is a promise
     *
     * @param ctx Context to use
     * @param promise Value to check
     * @returns LEPUS_BOOL - True if value is a promise, false otherwise
     */
    HAKO_IsPromise(ctx: JSContextPointer, promise: JSValueConstPointer): LEPUS_BOOL;
    /**
     * Creates a new promise capability
     *
     * @param ctx Context to create in
     * @param resolve_funcs_out Array to store resolve and reject functions
     * @returns LEPUSValue* - New promise
     */
    HAKO_NewPromiseCapability(ctx: JSContextPointer, resolve_funcs_out: number): JSValuePointer;
    /**
     * Gets the result value of a promise
     *
     * @param ctx Context to use
     * @param promise Promise to get result from
     * @returns LEPUSValue* - Promise result
     */
    HAKO_PromiseResult(ctx: JSContextPointer, promise: JSValueConstPointer): JSValuePointer;
    /**
     * Gets the state of a promise
     *
     * @param ctx Context to use
     * @param promise Promise to get state from
     * @returns LEPUSPromiseStateEnum - Promise state
     */
    HAKO_PromiseState(ctx: JSContextPointer, promise: JSValueConstPointer): number;

    // Runtime Management
    /**
     * Frees a Hako runtime and associated resources
     *
     * @param rt Runtime to free
     */
    HAKO_FreeRuntime(rt: JSRuntimePointer): void;
    /**
     * Get the current debug info stripping configuration
     *
     * @param rt Runtime to query
     * @returns int - Current stripping flags
     */
    HAKO_GetStripInfo(rt: JSRuntimePointer): number;
    /**
     * Creates a new Hako runtime
     *
     * @returns LEPUSRuntime* - Pointer to the newly created runtime
     */
    HAKO_NewRuntime(): JSRuntimePointer;
    /**
     * Sets memory limit for the runtime
     *
     * @param rt Runtime to set the limit for
     * @param limit Memory limit in bytes, or -1 to disable limit
     */
    HAKO_RuntimeSetMemoryLimit(rt: JSRuntimePointer, limit: number): void;
    /**
     * Configure which debug info is stripped from the compiled code
     *
     * @param rt Runtime to configure
     * @param flags Flags to configure stripping behavior
     */
    HAKO_SetStripInfo(rt: JSRuntimePointer, flags: number): void;

    // Value Creation
    /**
     * Creates a new array
     *
     * @param ctx Context to create in
     * @returns LEPUSValue* - New array
     */
    HAKO_NewArray(ctx: JSContextPointer): JSValuePointer;
    /**
     * Creates a new array buffer using existing memory
     *
     * @param ctx Context to create in
     * @param buffer Buffer to use
     * @param length Buffer length in bytes
     * @returns LEPUSValue* - New ArrayBuffer
     */
    HAKO_NewArrayBuffer(ctx: JSContextPointer, buffer: number, length: number): JSValuePointer;
    /**
     * Creates a new BigInt number
     *
     * @param ctx Context to create in
     * @param low Low 32 bits of the number
     * @param high High 32 bits of the number
     * @returns LEPUSValue* - New BigInt
     */
    HAKO_NewBigInt(ctx: JSContextPointer, low: number, high: number): JSValuePointer;
    /**
     * Creates a new BigUInt number
     *
     * @param ctx Context to create in
     * @param low Low 32 bits of the number
     * @param high High 32 bits of the number
     * @returns LEPUSValue* - New BigUInt
     */
    HAKO_NewBigUInt(ctx: JSContextPointer, low: number, high: number): JSValuePointer;
    /**
     * Creates a new date object
     *
     * @param ctx Context to create in
     * @param time Time value
     * @returns LEPUSValue* - New date object
     */
    HAKO_NewDate(ctx: JSContextPointer, time: number): JSValuePointer;
    /**
     * Creates a new Error object
     *
     * @param ctx Context to create in
     * @returns LEPUSValue* - New Error object
     */
    HAKO_NewError(ctx: JSContextPointer): JSValuePointer;
    /**
     * Creates a new floating point number
     *
     * @param ctx Context to create in
     * @param num Number value
     * @returns LEPUSValue* - New number
     */
    HAKO_NewFloat64(ctx: JSContextPointer, num: number): JSValuePointer;
    /**
     * Creates a new function with a host function ID
     *
     * @param ctx Context to create in
     * @param func_id Function ID to call on the host
     * @param name Function name
     * @returns LEPUSValue* - New function
     */
    HAKO_NewFunction(ctx: JSContextPointer, func_id: number, name: CString): JSValuePointer;
    /**
     * Creates a new empty object
     *
     * @param ctx Context to create in
     * @returns LEPUSValue* - New object
     */
    HAKO_NewObject(ctx: JSContextPointer): JSValuePointer;
    /**
     * Creates a new object with specified prototype
     *
     * @param ctx Context to create in
     * @param proto Prototype object
     * @returns LEPUSValue* - New object
     */
    HAKO_NewObjectProto(ctx: JSContextPointer, proto: JSValueConstPointer): JSValuePointer;
    /**
     * Creates a new string
     *
     * @param ctx Context to create in
     * @param string String content
     * @returns LEPUSValue* - New string
     */
    HAKO_NewString(ctx: JSContextPointer, string: CString): JSValuePointer;
    /**
     * Creates a new symbol
     *
     * @param ctx Context to create in
     * @param description Symbol description
     * @param isGlobal Whether to create a global symbol
     * @returns LEPUSValue* - New symbol
     */
    HAKO_NewSymbol(ctx: JSContextPointer, description: CString, isGlobal: number): JSValuePointer;

    // Value Management
    /**
     * Duplicates a JavaScript value pointer
     *
     * @param ctx Context to use
     * @param val Value to duplicate
     * @returns LEPUSValue* - Pointer to the duplicated value
     */
    HAKO_DupValuePointer(ctx: JSContextPointer, val: JSValueConstPointer): JSValuePointer;
    /**
     * Frees a C string managed by a context
     *
     * @param ctx Context that allocated the string
     * @param str String to free
     */
    HAKO_FreeCString(ctx: JSContextPointer, str: CString): void;
    /**
     * Frees a JavaScript value pointer
     *
     * @param ctx Context the value belongs to
     * @param value Value pointer to free
     */
    HAKO_FreeValuePointer(ctx: JSContextPointer, value: JSValuePointer): void;
    /**
     * Frees a JavaScript value pointer using a runtime
     *
     * @param rt Runtime the value belongs to
     * @param value Value pointer to free
     */
    HAKO_FreeValuePointerRuntime(rt: JSRuntimePointer, value: JSValuePointer): void;
    /**
     * Frees a void pointer managed by a context
     *
     * @param ctx Context that allocated the pointer
     * @param ptr Pointer to free
     */
    HAKO_FreeVoidPointer(ctx: JSContextPointer, ptr: number): void;

    // Value Operations
    /**
     * Gets a JavaScript value from an argv array
     *
     * @param argv Array of values
     * @param index Index to get
     * @returns LEPUSValueConst* - Value at index
     */
    HAKO_ArgvGetJSValueConstPointer(argv: number, index: number): JSValueConstPointer;
    /**
     * Calls a function
     *
     * @param ctx Context to use
     * @param func_obj Function to call
     * @param this_obj This value
     * @param argc Number of arguments
     * @param argv_ptrs Array of argument pointers
     * @returns LEPUSValue* - Function result
     */
    HAKO_Call(ctx: JSContextPointer, func_obj: JSValueConstPointer, this_obj: JSValueConstPointer, argc: number, argv_ptrs: number): JSValuePointer;
    /**
     * Copy the buffer from a guest ArrayBuffer
     *
     * @param ctx Context to use
     * @param data ArrayBuffer to get buffer from
     * @param out_len Pointer to store length of the buffer
     * @returns JSVoid* - Buffer pointer
     */
    HAKO_CopyArrayBuffer(ctx: JSContextPointer, data: JSValueConstPointer, out_len: number): number;
    /**
     * Copy the buffer pointer from a TypedArray
     *
     * @param ctx Context to use
     * @param data TypedArray to get buffer from
     * @param out_len Pointer to store length of the buffer
     * @returns JSVoid* - Buffer pointer
     */
    HAKO_CopyTypedArrayBuffer(ctx: JSContextPointer, data: JSValueConstPointer, out_len: number): number;
    /**
     * Defines a property with custom attributes
     *
     * @param ctx Context to use
     * @param this_val Object to define property on
     * @param prop_name Property name
     * @param prop_value Property value
     * @param get Getter function or undefined
     * @param set Setter function or undefined
     * @param configurable Whether property is configurable
     * @param enumerable Whether property is enumerable
     * @param has_value Whether property has a value
     * @returns LEPUS_BOOL - True if successful, false otherwise, -1 if exception
     */
    HAKO_DefineProp(ctx: JSContextPointer, this_val: JSValueConstPointer, prop_name: JSValueConstPointer, prop_value: JSValueConstPointer, get: JSValueConstPointer, set: JSValueConstPointer, configurable: LEPUS_BOOL, enumerable: LEPUS_BOOL, has_value: LEPUS_BOOL): LEPUS_BOOL;
    /**
     * Dumps a value to a JSON string
     *
     * @param ctx Context to use
     * @param obj Value to dump
     * @returns JSBorrowedChar* - JSON string representation
     */
    HAKO_Dump(ctx: JSContextPointer, obj: JSValueConstPointer): CString;
    /**
     * Gets the class ID of a value
     *
     * @param ctx Context to use
     * @param val Value to get class ID from
     * @returns LEPUSClassID - Class ID of the value (0 if not a class)
     */
    HAKO_GetClassID(ctx: JSContextPointer, val: JSValueConstPointer): number;
    /**
     * Gets the floating point value of a number
     *
     * @param ctx Context to use
     * @param value Value to convert
     * @returns double - Number value
     */
    HAKO_GetFloat64(ctx: JSContextPointer, value: JSValueConstPointer): number;
    /**
     * Gets the global object
     *
     * @param ctx Context to get global object from
     * @returns LEPUSValue* - Global object
     */
    HAKO_GetGlobalObject(ctx: JSContextPointer): JSValuePointer;
    /**
     * Gets the length of an object (array length or string length)
     *
     * @param ctx Context to use
     * @param out_len Pointer to store length
     * @param value Object to get length from
     * @returns int - 0 on success, negative on error
     */
    HAKO_GetLength(ctx: JSContextPointer, out_len: number, value: JSValueConstPointer): number;
    /**
     * Gets all own property names of an object
     *
     * @param ctx Context to use
     * @param out_ptrs Pointer to array to store property names
     * @param out_len Pointer to store length of property names array
     * @param obj Object to get property names from
     * @param flags Property name flags
     * @returns LEPUSValue* - Exception if error occurred, NULL otherwise
     */
    HAKO_GetOwnPropertyNames(ctx: JSContextPointer, out_ptrs: number, out_len: number, obj: JSValueConstPointer, flags: number): JSValuePointer;
    /**
     * Gets a property value by name
     *
     * @param ctx Context to use
     * @param this_val Object to get property from
     * @param prop_name Property name
     * @returns LEPUSValue* - Property value
     */
    HAKO_GetProp(ctx: JSContextPointer, this_val: JSValueConstPointer, prop_name: JSValueConstPointer): JSValuePointer;
    /**
     * Gets a property value by numeric index
     *
     * @param ctx Context to use
     * @param this_val Object to get property from
     * @param prop_name Property index
     * @returns LEPUSValue* - Property value
     */
    HAKO_GetPropNumber(ctx: JSContextPointer, this_val: JSValueConstPointer, prop_name: number): JSValuePointer;
    /**
     * Gets the description or key of a symbol
     *
     * @param ctx Context to use
     * @param value Symbol to get description from
     * @returns JSBorrowedChar* - Symbol description or key
     */
    HAKO_GetSymbolDescriptionOrKey(ctx: JSContextPointer, value: JSValueConstPointer): CString;
    /**
     * Gets the type of a typed array
     *
     * @param ctx Context to use
     * @param value Typed array to get type of
     * @returns HAKO_TypedArrayType - Type id
     */
    HAKO_GetTypedArrayType(ctx: JSContextPointer, value: JSValueConstPointer): number;
    /**
     * Checks if a value is an array
     *
     * @param ctx Context to use
     * @param value Value to check
     * @returns LEPUS_BOOL - True if value is an array, false otherwise (-1 if error)
     */
    HAKO_IsArray(ctx: JSContextPointer, value: JSValueConstPointer): LEPUS_BOOL;
    /**
     * Checks if a value is an ArrayBuffer
     *
     * @param value Value to check
     * @returns LEPUS_BOOL - True if value is an ArrayBuffer, false otherwise (-1 if error)
     */
    HAKO_IsArrayBuffer(value: JSValueConstPointer): LEPUS_BOOL;
    /**
     * Checks if two values are equal according to the specified operation
     *
     * @param ctx Context to use
     * @param a First value
     * @param b Second value
     * @param op Equal operation type
     * @returns LEPUS_BOOL - True if values are equal, false otherwise
     */
    HAKO_IsEqual(ctx: JSContextPointer, a: JSValueConstPointer, b: JSValueConstPointer, op: number): LEPUS_BOOL;
    /**
     * Checks if a symbol is global
     *
     * @param ctx Context to use
     * @param value Symbol to check
     * @returns LEPUS_BOOL - True if symbol is global, false otherwise
     */
    HAKO_IsGlobalSymbol(ctx: JSContextPointer, value: JSValueConstPointer): LEPUS_BOOL;
    /**
     * Checks if a value is an instance of a class
     *
     * @param ctx Context to use
     * @param val Value to check
     * @param obj Class object to check against
     * @returns LEPUS_BOOL TRUE, FALSE or (-1) in case of exception
     */
    HAKO_IsInstanceOf(ctx: JSContextPointer, val: JSValueConstPointer, obj: JSValueConstPointer): LEPUS_BOOL;
    /**
     * Checks if a value is a typed array
     *
     * @param ctx Context to use
     * @param value Value to check
     * @returns LEPUS_BOOL - True if value is a typed array, false otherwise (-1 if error)
     */
    HAKO_IsTypedArray(ctx: JSContextPointer, value: JSValueConstPointer): LEPUS_BOOL;
    /**
     * Sets a property value
     *
     * @param ctx Context to use
     * @param this_val Object to set property on
     * @param prop_name Property name
     * @param prop_value Property value
     * @returns LEPUS_BOOL - True if successful, false otherwise, -1 if exception
     */
    HAKO_SetProp(ctx: JSContextPointer, this_val: JSValueConstPointer, prop_name: JSValueConstPointer, prop_value: JSValueConstPointer): LEPUS_BOOL;
    /**
     * Gets the C string representation of a value
     *
     * @param ctx Context to use
     * @param value Value to convert
     * @returns JSBorrowedChar* - String representation
     */
    HAKO_ToCString(ctx: JSContextPointer, value: JSValueConstPointer): CString;
    /**
     * Covnerts a value to JSON format
     *
     * @param ctx Context to use
     * @param val Value to stringify
     * @param indent Indentation level
     * @returns LEPUSValue* - JSON string representation
     */
    HAKO_ToJson(ctx: JSContextPointer, val: JSValueConstPointer, indent: number): JSValuePointer;
    /**
     * Gets the type of a value as a string
     *
     * @param ctx Context to use
     * @param value Value to get type of
     * @returns OwnedHeapChar* - Type name
     */
    HAKO_Typeof(ctx: JSContextPointer, value: JSValueConstPointer): OwnedHeapChar;

}