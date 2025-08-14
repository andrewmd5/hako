#ifndef HAKO_H
#define HAKO_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "build.h"
#include "quickjs.h"

typedef int LEPUSModuleInitFunc(LEPUSContext* ctx, LEPUSModuleDef* m);

#define BorrowedHeapChar const char
#define OwnedHeapChar char
#define JSBorrowedChar const char
#define JSVoid void
#define CString const char

#define EvalFlags int
#define EvalDetectModule int

#define HAKO_GPN_NUMBER_MASK (1 << 6)
#define HAKO_STANDARD_COMPLIANT_NUMBER (1 << 7)
#define LEPUS_ATOM_TAG_INT (1U << 31)

typedef enum HAKO_Intrinsic {
  HAKO_Intrinsic_BaseObjects = 1 << 0,
  HAKO_Intrinsic_Date = 1 << 1,
  HAKO_Intrinsic_Eval = 1 << 2,
  HAKO_Intrinsic_StringNormalize = 1 << 3,
  HAKO_Intrinsic_RegExp = 1 << 4,
  HAKO_Intrinsic_RegExpCompiler = 1 << 5,
  HAKO_Intrinsic_JSON = 1 << 6,
  HAKO_Intrinsic_Proxy = 1 << 7,
  HAKO_Intrinsic_MapSet = 1 << 8,
  HAKO_Intrinsic_TypedArrays = 1 << 9,
  HAKO_Intrinsic_Promise = 1 << 10,
  HAKO_Intrinsic_BigInt = 1 << 11,
  HAKO_Intrinsic_BigFloat = 1 << 12,
  HAKO_Intrinsic_BigDecimal = 1 << 13,
  HAKO_Intrinsic_OperatorOverloading = 1 << 14,
  HAKO_Intrinsic_BignumExt = 1 << 15,
  HAKO_Intrinsic_Performance = 1 << 16,
  HAKO_Intrinsic_Crypto = 1 << 17,
} HAKO_Intrinsic;

typedef enum {
  HAKO_TYPED_UINT8_ARRAY = 1,
  HAKO_TYPED_UINT8C_ARRAY = 2,
  HAKO_TYPED_INT8_ARRAY = 3,
  HAKO_TYPED_UINT16_ARRAY = 4,
  HAKO_TYPED_INT16_ARRAY = 5,
  HAKO_TYPED_UINT32_ARRAY = 6,
  HAKO_TYPED_INT32_ARRAY = 7,
  HAKO_TYPED_BIG_INT64_ARRAY = 8,
  HAKO_TYPED_BIG_UINT64_ARRAY = 9,
  HAKO_TYPED_FLOAT16_ARRAY = 10,
  HAKO_TYPED_FLOAT32_ARRAY = 11,
  HAKO_TYPED_FLOAT64_ARRAY = 12
} HAKO_TypedArrayType;

typedef enum IsEqualOp {
  HAKO_EqualOp_StrictEq = 0,
  HAKO_EqualOp_SameValue = 1,
  HAKO_EqualOp_SameValueZero = 2
} IsEqualOp;

typedef enum {
  HAKO_TYPE_UNDEFINED = 0,
  HAKO_TYPE_OBJECT = 1,
  HAKO_TYPE_STRING = 2,
  HAKO_TYPE_SYMBOL = 3,
  HAKO_TYPE_BOOLEAN = 4,
  HAKO_TYPE_NUMBER = 5,
  HAKO_TYPE_BIGINT = 6,
  HAKO_TYPE_FUNCTION = 7
} HAKOTypeOf;

/**
 * @brief Creates a new Hako runtime
 * @category Runtime Management
 *
 * @return LEPUSRuntime* - Pointer to the newly created runtime
 * @tsreturn JSRuntimePointer
 */
LEPUSRuntime* HAKO_NewRuntime();

/**
 * @brief Frees a Hako runtime and associated resources
 * @category Runtime Management
 *
 * @param rt Runtime to free
 * @tsparam rt JSRuntimePointer
 */
void HAKO_FreeRuntime(LEPUSRuntime* rt);

/**
 * @brief Configure which debug info is stripped from the compiled code
 * @category Runtime Management
 *
 * @param rt Runtime to configure
 * @param flags Flags to configure stripping behavior
 * @tsparam rt JSRuntimePointer
 * @tsparam flags number
 */
void HAKO_SetStripInfo(LEPUSRuntime* rt, int flags);
/**
 * @brief Get the current debug info stripping configuration
 * @category Runtime Management
 *
 * @param rt Runtime to query
 * @return int - Current stripping flags
 * @tsparam rt JSRuntimePointer
 * @tsreturn number
 */
int HAKO_GetStripInfo(LEPUSRuntime* rt);

/**
 * @brief Sets memory limit for the runtime
 * @category Runtime Management
 *
 * @param rt Runtime to set the limit for
 * @param limit Memory limit in bytes, or -1 to disable limit
 * @tsparam rt JSRuntimePointer
 * @tsparam limit number
 */
void HAKO_RuntimeSetMemoryLimit(LEPUSRuntime* rt, size_t limit);

/**
 * @brief Computes memory usage statistics for the runtime
 * @category Memory
 *
 * @param rt Runtime to compute statistics for
 * @param ctx Context to use for creating the result object
 * @return LEPUSValue* - Object containing memory usage statistics
 * @tsparam rt JSRuntimePointer
 * @tsparam ctx JSContextPointer
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_RuntimeComputeMemoryUsage(LEPUSRuntime* rt, LEPUSContext* ctx);

/**
 * @brief Dumps memory usage statistics as a string
 * @category Memory
 *
 * @param rt Runtime to dump statistics for
 * @return OwnedHeapChar* - String containing memory usage information
 * @tsparam rt JSRuntimePointer
 * @tsreturn CString
 */
OwnedHeapChar* HAKO_RuntimeDumpMemoryUsage(LEPUSRuntime* rt);

/**
 * @brief Checks if there are pending promise jobs in the runtime
 * @category Promise
 *
 * @param rt Runtime to check
 * @return LEPUS_BOOL - True if jobs are pending, false otherwise
 * @tsparam rt JSRuntimePointer
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_IsJobPending(LEPUSRuntime* rt);

/**
 * @brief Executes pending promise jobs in the runtime
 * @category Promise
 *
 * @param rt Runtime to execute jobs in
 * @param maxJobsToExecute Maximum number of jobs to execute
 * @param lastJobContext Pointer to store the context of the last executed job
 * @return LEPUSValue* - Number of executed jobs or an exception
 * @tsparam rt JSRuntimePointer
 * @tsparam maxJobsToExecute number
 * @tsparam lastJobContext number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_ExecutePendingJob(LEPUSRuntime* rt, int maxJobsToExecute,
                                   LEPUSContext** lastJobContext);

/**
 * @brief Enables interrupt handler for the runtime
 * @category Interrupt Handling
 *
 * @param rt Runtime to enable interrupt handler for
 * @param opaque Pointer to user-defined data
 * @tsparam rt JSRuntimePointer
 * @tsparam opaque number
 */
void HAKO_RuntimeEnableInterruptHandler(LEPUSRuntime* rt, JSVoid* opaque);

/**
 * @brief Disables interrupt handler for the runtime
 * @category Interrupt Handling
 *
 * @param rt Runtime to disable interrupt handler for
 * @tsparam rt JSRuntimePointer
 */
void HAKO_RuntimeDisableInterruptHandler(LEPUSRuntime* rt);

/**
 * @brief Enables module loader for the runtime
 * @category Module Loading
 *
 * @param rt Runtime to enable module loader for
 * @param use_custom_normalize Whether to use custom module name normalization
 * @tsparam rt JSRuntimePointer
 * @tsparam use_custom_normalize number
 */
void HAKO_RuntimeEnableModuleLoader(LEPUSRuntime* rt,
                                    LEPUS_BOOL use_custom_normalize);

/**
 * @brief Disables module loader for the runtime
 * @category Module Loading
 *
 * @param rt Runtime to disable module loader for
 * @tsparam rt JSRuntimePointer
 */
void HAKO_RuntimeDisableModuleLoader(LEPUSRuntime* rt);

/**
 * @brief Throws a JavaScript reference error with a message
 * @category Error Handling
 *
 * @param ctx Context to throw the error in
 * @param message Error message
 * @tsparam ctx JSContextPointer
 * @tsparam message CString
 */
void HAKO_RuntimeJSThrow(LEPUSContext* ctx, CString* message);

/**
 * @brief Creates a new JavaScript context
 * @category Context Management
 *
 * @param rt Runtime to create the context in
 * @param intrinsics HAKO_Intrinsic flags to enable
 * @return LEPUSContext* - Newly created context
 * @tsparam rt JSRuntimePointer
 * @tsparam intrinsics number
 * @tsreturn JSContextPointer
 */
LEPUSContext* HAKO_NewContext(LEPUSRuntime* rt, HAKO_Intrinsic intrinsics);

/**
 * @brief sets opaque data for the context. you are responsible for freeing the
 * data.
 * @category Context Management
 *
 * @param ctx Context to set the data for
 * @param data Pointer to the data
 * @tsparam ctx JSContextPointer
 * @tsparam data number
 */
void HAKO_SetContextData(LEPUSContext* ctx, JSVoid* data);

/**
 * @brief Gets opaque data for the context
 * @category Context Management
 *
 * @param ctx Context to get the data from
 * @return JSVoid* - Pointer to the data
 * @tsparam ctx JSContextPointer
 * @tsreturn number
 */
JSVoid* HAKO_GetContextData(LEPUSContext* ctx);

/**
 * @brief If no_lepus_strict_mode is set to true, these conditions will handle,
 * differently: if the object is null or undefined, read properties will return
 * null if the object is null or undefined, write properties will not throw
 * exception.
 * @category Context Management
 *
 * @param ctx Context to set to no strict mode
 * @tsparam ctx JSContextPointer
 */
void HAKO_SetNoStrictMode(LEPUSContext* ctx);

/**
 * @brief Sets the virtual stack size for a context
 * @category Context Management
 *
 * @param ctx Context to set the stack size for
 * @param size Stack size in bytes
 * @tsparam ctx JSContextPointer
 * @tsparam size number
 */
void HAKO_SetVirtualStackSize(LEPUSContext* ctx, uint32_t size);

/**
 * @brief Frees a JavaScript context
 * @category Context Management
 *
 * @param ctx Context to free
 * @tsparam ctx JSContextPointer
 */
void HAKO_FreeContext(LEPUSContext* ctx);

/**
 * @brief Sets the maximum stack size for a context
 * @category Context Management
 *
 * @param ctx Context to configure
 * @param stack_size Maximum stack size in bytes
 * @tsparam ctx JSContextPointer
 * @tsparam stack_size number
 */
void HAKO_ContextSetMaxStackSize(LEPUSContext* ctx, size_t stack_size);

/**
 * @brief Gets a pointer to the undefined value
 * @category Constants
 *
 * @return LEPUSValueConst* - Pointer to the undefined value
 * @tsreturn JSValueConstPointer
 */
LEPUSValueConst* HAKO_GetUndefined();

/**
 * @brief Gets a pointer to the null value
 * @category Constants
 *
 * @return LEPUSValueConst* - Pointer to the null value
 * @tsreturn JSValueConstPointer
 */
LEPUSValueConst* HAKO_GetNull();

/**
 * @brief Gets a pointer to the false value
 * @category Constants
 *
 * @return LEPUSValueConst* - Pointer to the false value
 * @tsreturn JSValueConstPointer
 */
LEPUSValueConst* HAKO_GetFalse();

/**
 * @brief Gets a pointer to the true value
 * @category Constants
 *
 * @return LEPUSValueConst* - Pointer to the true value
 * @tsreturn JSValueConstPointer
 */
LEPUSValueConst* HAKO_GetTrue();

/**
 * @brief Duplicates a JavaScript value pointer
 * @category Value Management
 *
 * @param ctx Context to use
 * @param val Value to duplicate
 * @return LEPUSValue* - Pointer to the duplicated value
 * @tsparam ctx JSContextPointer
 * @tsparam val JSValueConstPointer
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_DupValuePointer(LEPUSContext* ctx, LEPUSValueConst* val);

/**
 * @brief Frees a JavaScript value pointer
 * @category Value Management
 *
 * @param ctx Context the value belongs to
 * @param value Value pointer to free
 * @tsparam ctx JSContextPointer
 * @tsparam value JSValuePointer
 */
void HAKO_FreeValuePointer(LEPUSContext* ctx, LEPUSValue* value);

/**
 * @brief Frees a JavaScript value pointer using a runtime
 * @category Value Management
 *
 * @param rt Runtime the value belongs to
 * @param value Value pointer to free
 * @tsparam rt JSRuntimePointer
 * @tsparam value JSValuePointer
 */
void HAKO_FreeValuePointerRuntime(LEPUSRuntime* rt, LEPUSValue* value);

/**
 * @brief Allocates memory using the context's allocator
 * @category Value Management
 *
 * @param ctx Context to allocate memory in
 * @param size Size of memory to allocate in bytes
 * @return void* - Pointer to the allocated memory
 * @tsparam ctx JSContextPointer
 * @tsparam size number
 * @tsreturn number
 */
void* HAKO_Malloc(LEPUSContext* ctx, size_t size);

/**
 * @brief Allocates memory using the runtime allocator
 * @category Value Management
 *
 * @param rt Runtime to allocate memory in
 * @param size Size of memory to allocate in bytes
 * @return void* - Pointer to the allocated memory
 * @tsparam rt JSRuntimePointer
 * @tsparam size number
 * @tsreturn number
 */
void* HAKO_RuntimeMalloc(LEPUSRuntime* rt, size_t size);

/**
 * @brief Frees memory that was allocated by a lepus allocator function
 * @category Value Management
 *
 * @param ctx Context that allocated the pointer
 * @param ptr Pointer to free
 * @tsparam ctx JSContextPointer
 * @tsparam ptr number
 */
void HAKO_Free(LEPUSContext* ctx, JSVoid* ptr);

/**
 * @brief Frees memory that was allocated by a lepus allocator function
 * @category Value Management
 *
 * @param rt Runtime that allocated the pointer
 * @param ptr Pointer to free
 * @tsparam rt JSRuntimePointer
 * @tsparam ptr number
 */
void HAKO_RuntimeFree(LEPUSRuntime* rt, JSVoid* ptr);

/**
 * @brief Frees a C string managed by a context
 * @category Value Management
 *
 * @param ctx Context that allocated the string
 * @param str String to free
 * @tsparam ctx JSContextPointer
 * @tsparam str CString
 */
void HAKO_FreeCString(LEPUSContext* ctx, JSBorrowedChar* str);

/**
 * @brief Throws a JavaScript error
 * @category Error Handling
 *
 * @param ctx Context to throw in
 * @param error Error to throw
 * @return LEPUSValue* - LEPUS_EXCEPTION
 * @tsparam ctx JSContextPointer
 * @tsparam error JSValueConstPointer
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_Throw(LEPUSContext* ctx, LEPUSValueConst* error);

/**
 * @brief Creates a new Error object
 * @category Value Creation
 *
 * @param ctx Context to create in
 * @return LEPUSValue* - New Error object
 * @tsparam ctx JSContextPointer
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewError(LEPUSContext* ctx);

/**
 * @brief Resolves the the last exception from a context, and returns its Error.
 * Cannot be called twice.
 * @category Error Handling
 *
 * @param ctx Context to resolve in
 * @param maybe_exception Value that might be an exception
 * @return LEPUSValue* - Error object or NULL if not an exception
 * @tsparam ctx JSContextPointer
 * @tsparam maybe_exception JSValuePointer
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_GetLastError(LEPUSContext* ctx, LEPUSValue* maybe_exception);

/**
 * @brief Creates a new empty object
 * @category Value Creation
 *
 * @param ctx Context to create in
 * @return LEPUSValue* - New object
 * @tsparam ctx JSContextPointer
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewObject(LEPUSContext* ctx);

/**
 * @brief Creates a new object with specified prototype
 * @category Value Creation
 *
 * @param ctx Context to create in
 * @param proto Prototype object
 * @return LEPUSValue* - New object
 * @tsparam ctx JSContextPointer
 * @tsparam proto JSValueConstPointer
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewObjectProto(LEPUSContext* ctx, LEPUSValueConst* proto);

/**
 * @brief Creates a new array
 * @category Value Creation
 *
 * @param ctx Context to create in
 * @return LEPUSValue* - New array
 * @tsparam ctx JSContextPointer
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewArray(LEPUSContext* ctx);

/**
 * @brief Creates a new array buffer using existing memory
 * @category Value Creation
 *
 * @param ctx Context to create in
 * @param buffer Buffer to use
 * @param length Buffer length in bytes
 * @return LEPUSValue* - New ArrayBuffer
 * @tsparam ctx JSContextPointer
 * @tsparam buffer number
 * @tsparam length number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewArrayBuffer(LEPUSContext* ctx, JSVoid* buffer,
                                size_t length);

/**
 * @brief Gets a property value by name
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param this_val Object to get property from
 * @param prop_name Property name
 * @return LEPUSValue* - Property value
 * @tsparam ctx JSContextPointer
 * @tsparam this_val JSValueConstPointer
 * @tsparam prop_name JSValueConstPointer
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_GetProp(LEPUSContext* ctx, LEPUSValueConst* this_val,
                         LEPUSValueConst* prop_name);

/**
 * @brief Gets a property value by numeric index
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param this_val Object to get property from
 * @param prop_name Property index
 * @return LEPUSValue* - Property value
 * @tsparam ctx JSContextPointer
 * @tsparam this_val JSValueConstPointer
 * @tsparam prop_name number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_GetPropNumber(LEPUSContext* ctx, LEPUSValueConst* this_val,
                               int prop_name);

/**
 * @brief Sets a property value
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param this_val Object to set property on
 * @param prop_name Property name
 * @param prop_value Property value
 * @return LEPUS_BOOL - True if successful, false otherwise, -1 if exception
 * @tsparam ctx JSContextPointer
 * @tsparam this_val JSValueConstPointer
 * @tsparam prop_name JSValueConstPointer
 * @tsparam prop_value JSValueConstPointer
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_SetProp(LEPUSContext* ctx, LEPUSValueConst* this_val,
                        LEPUSValueConst* prop_name,
                        LEPUSValueConst* prop_value);

/**
 * @brief Defines a property with custom attributes
 * @category Value Operations
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
 * @return LEPUS_BOOL - True if successful, false otherwise, -1 if exception
 * @tsparam ctx JSContextPointer
 * @tsparam this_val JSValueConstPointer
 * @tsparam prop_name JSValueConstPointer
 * @tsparam prop_value JSValueConstPointer
 * @tsparam get JSValueConstPointer
 * @tsparam set JSValueConstPointer
 * @tsparam configurable LEPUS_BOOL
 * @tsparam enumerable LEPUS_BOOL
 * @tsparam has_value LEPUS_BOOL
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_DefineProp(LEPUSContext* ctx, LEPUSValueConst* this_val,
                           LEPUSValueConst* prop_name,
                           LEPUSValueConst* prop_value, LEPUSValueConst* get,
                           LEPUSValueConst* set, LEPUS_BOOL configurable,
                           LEPUS_BOOL enumerable, LEPUS_BOOL has_value);

/**
 * @brief Gets all own property names of an object
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param out_ptrs Pointer to array to store property names
 * @param out_len Pointer to store length of property names array
 * @param obj Object to get property names from
 * @param flags Property name flags
 * @return LEPUSValue* - Exception if error occurred, NULL otherwise
 * @tsparam ctx JSContextPointer
 * @tsparam out_ptrs number
 * @tsparam out_len number
 * @tsparam obj JSValueConstPointer
 * @tsparam flags number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_GetOwnPropertyNames(LEPUSContext* ctx, LEPUSValue*** out_ptrs,
                                     uint32_t* out_len, LEPUSValueConst* obj,
                                     int flags);

/**
 * @brief Gets the global object
 * @category Value Operations
 *
 * @param ctx Context to get global object from
 * @return LEPUSValue* - Global object
 * @tsparam ctx JSContextPointer
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_GetGlobalObject(LEPUSContext* ctx);

/**
 * @brief Gets the length of an object (array length or string length)
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param out_len Pointer to store length
 * @param value Object to get length from
 * @return int - 0 on success, negative on error
 * @tsparam ctx JSContextPointer
 * @tsparam out_len number
 * @tsparam value JSValueConstPointer
 * @tsreturn number
 */
int HAKO_GetLength(LEPUSContext* ctx, uint32_t* out_len,
                   LEPUSValueConst* value);

/**
 * @brief Creates a new floating point number
 * @category Value Creation
 *
 * @param ctx Context to create in
 * @param num Number value
 * @return LEPUSValue* - New number
 * @tsparam ctx JSContextPointer
 * @tsparam num number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewFloat64(LEPUSContext* ctx, double num);

/**
 * @brief Creates a new BigInt number
 * @category Value Creation
 *
 * @param ctx Context to create in
 * @param low Low 32 bits of the number
 * @param high High 32 bits of the number
 * @return LEPUSValue* - New BigInt
 * @tsparam ctx JSContextPointer
 * @tsparam low number
 * @tsparam high number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewBigInt(LEPUSContext* ctx, int32_t low, int32_t high);
/**
 * @brief Creates a new BigUInt number
 * @category Value Creation
 *
 * @param ctx Context to create in
 * @param low Low 32 bits of the number
 * @param high High 32 bits of the number
 * @return LEPUSValue* - New BigUInt
 * @tsparam ctx JSContextPointer
 * @tsparam low number
 * @tsparam high number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewBigUInt(LEPUSContext* ctx, uint32_t low, uint32_t high);

/**
 * @brief Sets the garbage collection threshold
 * @category Memory Management
 *
 * @param ctx Context to set the threshold for
 * @param threshold Threshold in bytes
 * @tsparam ctx JSContextPointer
 * @tsparam threshold number
 */
void HAKO_SetGCThreshold(LEPUSContext* ctx, int64_t threshold);

/**
 * @brief Checks if the context is in garbage collection mode
 * @category Memory Management
 *
 * @param ctx Context to check
 * @return LEPUS_BOOL - True if in GC mode, false otherwise
 * @tsparam ctx JSContextPointer
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_IsGCMode(LEPUSContext* ctx);

/**
 * @brief Gets the floating point value of a number
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param value Value to convert
 * @return double - Number value
 * @tsparam ctx JSContextPointer
 * @tsparam value JSValueConstPointer
 * @tsreturn number
 */
double HAKO_GetFloat64(LEPUSContext* ctx, LEPUSValueConst* value);

/**
 * @brief Creates a new string
 * @category Value Creation
 *
 * @param ctx Context to create in
 * @param string String content
 * @return LEPUSValue* - New string
 * @tsparam ctx JSContextPointer
 * @tsparam string CString
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewString(LEPUSContext* ctx, BorrowedHeapChar* string);

/**
 * @brief Gets the C string representation of a value
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param value Value to convert
 * @return JSBorrowedChar* - String representation
 * @tsparam ctx JSContextPointer
 * @tsparam value JSValueConstPointer
 * @tsreturn CString
 */
JSBorrowedChar* HAKO_ToCString(LEPUSContext* ctx, LEPUSValueConst* value);

/**
 * @brief Creates a new symbol
 * @category Value Creation
 *
 * @param ctx Context to create in
 * @param description Symbol description
 * @param isGlobal Whether to create a global symbol
 * @return LEPUSValue* - New symbol
 * @tsparam ctx JSContextPointer
 * @tsparam description CString
 * @tsparam isGlobal number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewSymbol(LEPUSContext* ctx, BorrowedHeapChar* description,
                           int isGlobal);

/**
 * @brief Gets the description or key of a symbol
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param value Symbol to get description from
 * @return JSBorrowedChar* - Symbol description or key
 * @tsparam ctx JSContextPointer
 * @tsparam value JSValueConstPointer
 * @tsreturn CString
 */
JSBorrowedChar* HAKO_GetSymbolDescriptionOrKey(LEPUSContext* ctx,
                                               LEPUSValueConst* value);

/**
 * @brief Checks if a symbol is global
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param value Symbol to check
 * @return LEPUS_BOOL - True if symbol is global, false otherwise
 * @tsparam ctx JSContextPointer
 * @tsparam value JSValueConstPointer
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_IsGlobalSymbol(LEPUSContext* ctx, LEPUSValueConst* value);

/**
 * @brief Gets the type of a value
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param value Value to get type of
 * @return HAKOTypeOf - Type id
 * @tsparam ctx JSContextPointer
 * @tsparam value JSValueConstPointer
 * @tsreturn HAKOTypeOf
 */
HAKOTypeOf HAKO_TypeOf(LEPUSContext* ctx, LEPUSValueConst* value);

/**
 * @brief Checks if a value is an array
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param value Value to check
 * @return LEPUS_BOOL - True if value is an array, false otherwise (-1 if error)
 * @tsparam ctx JSContextPointer
 * @tsparam value JSValueConstPointer
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_IsArray(LEPUSContext* ctx, LEPUSValueConst* value);

/**
 * @brief Checks if a value is a typed array
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param value Value to check
 * @return LEPUS_BOOL - True if value is a typed array, false otherwise (-1 if
 * error)
 * @tsparam ctx JSContextPointer
 * @tsparam value JSValueConstPointer
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_IsTypedArray(LEPUSContext* ctx, LEPUSValueConst* value);

/**
 * @brief Gets the type of a typed array
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param value Typed array to get type of
 * @return HAKO_TypedArrayType - Type id
 * @tsparam ctx JSContextPointer
 * @tsparam value JSValueConstPointer
 * @tsreturn number
 */
HAKO_TypedArrayType HAKO_GetTypedArrayType(LEPUSContext* ctx,
                                           LEPUSValueConst* value);

/**
 * @brief Checks if a value is an ArrayBuffer
 * @category Value Operations
 *
 * @param value Value to check
 * @return LEPUS_BOOL - True if value is an ArrayBuffer, false otherwise (-1 if
 * error)
 * @tsparam value JSValueConstPointer
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_IsArrayBuffer(LEPUSValueConst* value);

/**
 * @brief Checks if two values are equal according to the specified operation
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param a First value
 * @param b Second value
 * @param op Equal operation type
 * @return LEPUS_BOOL - True if values are equal, false otherwise
 * @tsparam ctx JSContextPointer
 * @tsparam a JSValueConstPointer
 * @tsparam b JSValueConstPointer
 * @tsparam op number
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_IsEqual(LEPUSContext* ctx, LEPUSValueConst* a,
                        LEPUSValueConst* b, IsEqualOp op);

/**
 * @brief Copy the buffer from a guest ArrayBuffer
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param data ArrayBuffer to get buffer from
 * @param out_len Pointer to store length of the buffer
 * @return JSVoid* - Buffer pointer
 * @tsparam ctx JSContextPointer
 * @tsparam data JSValueConstPointer
 * @tsparam out_len number
 * @tsreturn number
 */
JSVoid* HAKO_CopyArrayBuffer(LEPUSContext* ctx, LEPUSValueConst* data,
                             size_t* out_len);

/**
 * @brief Copy the buffer pointer from a TypedArray
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param data TypedArray to get buffer from
 * @param out_len Pointer to store length of the buffer
 * @return JSVoid* - Buffer pointer
 * @tsparam ctx JSContextPointer
 * @tsparam data JSValueConstPointer
 * @tsparam out_len number
 * @tsreturn number
 */
JSVoid* HAKO_CopyTypedArrayBuffer(LEPUSContext* ctx, LEPUSValueConst* data,
                                  size_t* out_len);

/**
 * @brief Creates a new function with a host function ID
 * @category Value Creation
 *
 * @param ctx Context to create in
 * @param func_id Function ID to call on the host
 * @param name Function name
 * @return LEPUSValue* - New function
 * @tsparam ctx JSContextPointer
 * @tsparam func_id number
 * @tsparam name CString
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewFunction(LEPUSContext* ctx, uint32_t func_id,
                             CString* name);

/**
 * @brief Calls a function
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param func_obj Function to call
 * @param this_obj This value
 * @param argc Number of arguments
 * @param argv_ptrs Array of argument pointers
 * @return LEPUSValue* - Function result
 * @tsparam ctx JSContextPointer
 * @tsparam func_obj JSValueConstPointer
 * @tsparam this_obj JSValueConstPointer
 * @tsparam argc number
 * @tsparam argv_ptrs number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_Call(LEPUSContext* ctx, LEPUSValueConst* func_obj,
                      LEPUSValueConst* this_obj, int argc,
                      LEPUSValueConst** argv_ptrs);

/**
 * @brief Gets a JavaScript value from an argv array
 * @category Value Operations
 *
 * @param argv Array of values
 * @param index Index to get
 * @return LEPUSValueConst* - Value at index
 * @tsparam argv number
 * @tsparam index number
 * @tsreturn JSValueConstPointer
 */
LEPUSValueConst* HAKO_ArgvGetJSValueConstPointer(LEPUSValueConst* argv,
                                                 int index);

/**
 * @brief Evaluates JavaScript code
 * @category Eval
 *
 * @param ctx Context to evaluate in
 * @param js_code Code to evaluate
 * @param js_code_length Code length
 * @param filename Filename for error reporting
 * @param detect_module Whether to auto-detect module code
 * @param eval_flags Evaluation flags
 * @return LEPUSValue* - Evaluation result
 * @tsparam ctx JSContextPointer
 * @tsparam js_code CString
 * @tsparam js_code_length number
 * @tsparam filename CString
 * @tsparam detect_module LEPUS_BOOL
 * @tsparam eval_flags number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_Eval(LEPUSContext* ctx, BorrowedHeapChar* js_code,
                      size_t js_code_length, BorrowedHeapChar* filename,
                      LEPUS_BOOL detect_module, EvalFlags eval_flags);

/**
 * @brief Creates a new promise capability
 * @category Promise
 *
 * @param ctx Context to create in
 * @param resolve_funcs_out Array to store resolve and reject functions
 * @return LEPUSValue* - New promise
 * @tsparam ctx JSContextPointer
 * @tsparam resolve_funcs_out number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewPromiseCapability(LEPUSContext* ctx,
                                      LEPUSValue** resolve_funcs_out);

/**
 * @brief Checks if a value is a promise
 * @category Promise
 *
 * @param ctx Context to use
 * @param promise Value to check
 * @return LEPUS_BOOL - True if value is a promise, false otherwise
 * @tsparam ctx JSContextPointer
 * @tsparam promise JSValueConstPointer
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_IsPromise(LEPUSContext* ctx, LEPUSValueConst* promise);

/**
 * @brief Gets the state of a promise
 * @category Promise
 *
 * @param ctx Context to use
 * @param promise Promise to get state from
 * @return LEPUSPromiseStateEnum - Promise state
 * @tsparam ctx JSContextPointer
 * @tsparam promise JSValueConstPointer
 * @tsreturn number
 */
LEPUSPromiseStateEnum HAKO_PromiseState(LEPUSContext* ctx,
                                        LEPUSValueConst* promise);

/**
 * @brief Gets the result value of a promise
 * @category Promise
 *
 * @param ctx Context to use
 * @param promise Promise to get result from
 * @return LEPUSValue* - Promise result
 * @tsparam ctx JSContextPointer
 * @tsparam promise JSValueConstPointer
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_PromiseResult(LEPUSContext* ctx, LEPUSValueConst* promise);

/**
 * @brief Gets the namespace object of a module
 * @category Module Loading
 *
 * @param ctx Context to use
 * @param module_func_obj Module function object
 * @return LEPUSValue* - Module namespace
 * @tsparam ctx JSContextPointer
 * @tsparam module_func_obj JSValueConstPointer
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_GetModuleNamespace(LEPUSContext* ctx,
                                    LEPUSValueConst* module_func_obj);

/**
 * @brief Dumps a value to a JSON string
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param obj Value to dump
 * @return JSBorrowedChar* - JSON string representation
 * @tsparam ctx JSContextPointer
 * @tsparam obj JSValueConstPointer
 * @tsreturn CString
 */
JSBorrowedChar* HAKO_Dump(LEPUSContext* ctx, LEPUSValueConst* obj);

/**
 * @brief Checks if the build is a debug build
 * @category Debug & Info
 *
 * @return LEPUS_BOOL - True if debug build, false otherwise
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_BuildIsDebug();

/**
 * @brief Checks if the build has leak sanitizer enabled
 * @category Debug & Info
 *
 * @return LEPUS_BOOL - True if leak sanitizer is enabled, false otherwise
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_BuildIsSanitizeLeak();

/**
 * @brief Performs a recoverable leak check
 * @category Debug & Info
 *
 * @return int - Result of leak check
 * @tsreturn number
 */
int HAKO_RecoverableLeakCheck();

/**
 * @brief Gets the version string
 * @category Debug & Info
 *
 * @return CString* - Version string
 * @tsreturn CString
 */
CString* HAKO_GetVersion();

/**
 * @brief Gets the PrimJS version number
 * @category Debug & Info
 *
 * @return uint64_t - PrimJS version
 * @tsreturn bigint
 */
uint64_t HAKO_GetPrimjsVersion();

/**
 * @brief Encodes a value to binary JSON format
 * @category Binary JSON
 *
 * @param ctx Context to use
 * @param val Value to encode
 * @param out_length Pointer to store the length of the encoded data
 * @return JSVoid* - Raw buffer containing encoded data (must be freed with
 * HAKO_Free)
 * @tsparam ctx JSContextPointer
 * @tsparam val JSValueConstPointer
 * @tsparam out_length number
 * @tsreturn number
 */
JSVoid* HAKO_BJSON_Encode(LEPUSContext* ctx, LEPUSValueConst* val,
                          size_t* out_length);

/**
 * @brief Decodes a value from binary JSON format
 * @category Binary JSON
 *
 * @param ctx Context to use
 * @param buffer Raw buffer containing encoded data
 * @param length Length of the buffer
 * @return LEPUSValue* - Decoded value
 * @tsparam ctx JSContextPointer
 * @tsparam buffer number
 * @tsparam length number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_BJSON_Decode(LEPUSContext* ctx, JSVoid* buffer, size_t length);

/**
 * @brief Converts a value to JSON format
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param val Value to stringify
 * @param indent Indentation level
 * @return LEPUSValue* - JSON string representation
 * @tsparam ctx JSContextPointer
 * @tsparam val JSValueConstPointer
 * @tsparam indent number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_ToJson(LEPUSContext* ctx, LEPUSValueConst* val, int indent);


/**
 * @brief Parses a string to a JSON object
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param json string to parse
 * @param buf_len Length of the buffer
 * @param filename Name of the file
 * @return LEPUSValue* - JSON object
 * @tsparam ctx JSContextPointer
 * @tsparam json CString
 * @tsparam buf_len number
 * @tsparam filename CString
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_ParseJson(LEPUSContext* ctx, CString* json, size_t buf_len, CString* filename);

/**
 * @brief Checks if a value is an Error
 * @category Error Handling
 *
 * @param ctx Context to use
 * @param val Value to check
 * @return LEPUS_BOOL - 1 if value is an error, 0 otherwise
 * @tsparam ctx JSContextPointer
 * @tsparam val JSValueConstPointer
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_IsError(LEPUSContext* ctx, LEPUSValueConst* val);

/**
 * @brief Checks if a value is an exception
 * @category Error Handling
 *
 * @param val Value to check
 * @return LEPUS_BOOL - 1 if value is an exception, 0 otherwise
 * @tsparam val JSValueConstPointer
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_IsException(LEPUSValueConst* val);

/**
 * @brief Creates a new date object
 * @category Value Creation
 *
 * @param ctx Context to create in
 * @param time Time value
 * @return LEPUSValue* - New date object
 * @tsparam ctx JSContextPointer
 * @tsparam time number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewDate(LEPUSContext* ctx, double time);

/**
 * @brief Gets the class ID of a value
 * @category Value Operations
 *
 * @param val Value to get class ID from
 * @return LEPUSClassID - Class ID of the value (0 if not a class)
 * @tsparam val JSValueConstPointer
 * @tsreturn number
 */
LEPUSClassID HAKO_GetClassID(LEPUSValueConst* val);

/**
 * @brief Checks if a value is an instance of a class
 * @category Value Operations
 *
 * @param ctx Context to use
 * @param val Value to check
 * @param obj Class object to check against
 * @return LEPUS_BOOL TRUE, FALSE or (-1) in case of exception
 * @tsparam ctx JSContextPointer
 * @tsparam val JSValueConstPointer
 * @tsparam obj JSValueConstPointer
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_IsInstanceOf(LEPUSContext* ctx, LEPUSValueConst* val,
                             LEPUSValueConst* obj);

/**
 * @brief Gets the build information
 * @category Debug & Info
 *
 * @return HakoBuildInfo* - Pointer to build information
 * @tsreturn number
 */
HakoBuildInfo* HAKO_BuildInfo();

/**
 * @brief Enables profiling of function calls
 * @category Debug & Info
 *
 * @param rt Runtime to enable profiling for
 * @param sampling Sampling rate - If sampling == 0, it's interpreted as "no
 * sampling" which means we log 1/1 calls.
 * @param opaque Opaque data to pass to the callback
 * @tsparam rt JSRuntimePointer
 * @tsparam sampling number
 * @tsparam opaque number
 * @tsreturn void
 */
void HAKO_EnableProfileCalls(LEPUSRuntime* rt, uint32_t sampling,
                             JSVoid* opaque);

/**
 * @brief Compiles JavaScript source code to portable bytecode
 * Automatically detects ES6 modules vs regular scripts and compiles accordingly
 * @category Bytecode
 *
 * @param ctx JavaScript context to compile in
 * @param js_code JavaScript source code to compile
 * @param js_code_length Length of the source code in bytes
 * @param filename Filename for error reporting and debugging info
 * @param detect_module Whether to auto-detect module code (.mjs extension or
 * import/export statements)
 * @param flags Compilation flags (LEPUS_EVAL_TYPE_MODULE, etc.)
 * @param out_bytecode_length Output parameter to receive bytecode buffer size
 * @return JSVoid* - Allocated bytecode buffer (caller must free), NULL on
 * compilation error
 * @tsparam ctx JSContextPointer
 * @tsparam js_code CString
 * @tsparam js_code_length number
 * @tsparam filename CString
 * @tsparam detect_module LEPUS_BOOL
 * @tsparam flags number
 * @tsparam out_bytecode_length number
 * @tsreturn number
 */
JSVoid* HAKO_CompileToByteCode(LEPUSContext* ctx, BorrowedHeapChar* js_code,
                               size_t js_code_length,
                               BorrowedHeapChar* filename,
                               LEPUS_BOOL detect_module, EvalFlags flags,
                               size_t* out_bytecode_length);

/**
 * @brief Evaluates precompiled JavaScript bytecode
 * Supports both module and script bytecode with appropriate result handling
 * @category Bytecode
 *
 * @param ctx JavaScript context to evaluate in
 * @param bytecode_buffer Bytecode buffer from HAKO_CompileToByteCode
 * @param bytecode_length Size of the bytecode buffer in bytes
 * @param load_only Whether to just load the bytecode without executing it
 * @return LEPUSValue* - Evaluation result: script return value, module
 * namespace, or exception
 * @tsparam ctx JSContextPointer
 * @tsparam bytecode_buffer number
 * @tsparam bytecode_length number
 * @tsparam load_only number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_EvalByteCode(LEPUSContext* ctx, JSVoid* bytecode_buffer,
                              size_t bytecode_length, LEPUS_BOOL load_only);

/**
 * @brief Creates a new C module
 * @category Module Creation
 *
 * @param ctx Context to create module in
 * @param name_str Module name
 * @return LEPUSModuleDef* - New module definition
 * @tsparam ctx JSContextPointer
 * @tsparam name_str CString
 * @tsreturn number
 */
LEPUSModuleDef* HAKO_NewCModule(LEPUSContext* ctx, CString* name_str);

/**
 * @brief Adds an export to a C module
 * @category Module Creation
 *
 * @param ctx Context to use
 * @param m Module to add export to
 * @param export_name Name of the export
 * @return int - 0 on success, -1 on failure
 * @tsparam ctx JSContextPointer
 * @tsparam m LEPUSModuleDef
 * @tsparam export_name CString
 * @tsreturn number
 */
int HAKO_AddModuleExport(LEPUSContext* ctx, LEPUSModuleDef* m,
                         CString* export_name);

/**
 * @brief Sets the value of a module export
 * @category Module Creation
 *
 * @param ctx Context to use
 * @param m Module to set export on
 * @param export_name Name of the export
 * @param val Value to set
 * @return int - 0 on success, -1 on failure
 * @tsparam ctx JSContextPointer
 * @tsparam m LEPUSModuleDef
 * @tsparam export_name CString
 * @tsparam val JSValueConstPointer
 * @tsreturn number
 */
int HAKO_SetModuleExport(LEPUSContext* ctx, LEPUSModuleDef* m,
                         CString* export_name, LEPUSValueConst* val);
/**
 * @brief Gets the name of a module
 * @category Module Creation
 *
 * @param ctx Context to use
 * @param m Module to get name from
 * @return CString* - Module name string
 * @tsparam ctx JSContextPointer
 * @tsparam m LEPUSModuleDef
 * @tsreturn CString
 */
CString* HAKO_GetModuleName(LEPUSContext* ctx, LEPUSModuleDef* m);

/**
 * @brief Allocates a new class ID
 * @category Class Management
 *
 * @param pclass_id Pointer to store the allocated class ID
 * @return LEPUSClassID - The allocated class ID
 * @tsparam pclass_id number
 * @tsreturn number
 */
LEPUSClassID HAKO_NewClassID(LEPUSClassID* pclass_id);

/**
 * @brief Creates a new class with constructor and optional finalizer
 * @category Class Management
 *
 * @param ctx Context to create class in
 * @param class_id Class ID to use
 * @param class_name Name of the class
 * @param has_finalizer Whether this class needs a finalizer
 * @return LEPUSValue* - Constructor function for the class
 * @tsparam ctx JSContextPointer
 * @tsparam class_id number
 * @tsparam class_name CString
 * @tsparam has_finalizer LEPUS_BOOL
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewClass(LEPUSContext* ctx, LEPUSClassID class_id,
                          CString* class_name, LEPUS_BOOL has_finalizer);

/**
 * @brief Sets the prototype for a class
 * @category Class Management
 *
 * @param ctx Context to use
 * @param class_id Class ID
 * @param proto Prototype object
 * @tsparam ctx JSContextPointer
 * @tsparam class_id number
 * @tsparam proto JSValueConstPointer
 */
void HAKO_SetClassProto(LEPUSContext* ctx, LEPUSClassID class_id,
                        LEPUSValueConst* proto);

/**
 * @brief Links constructor and prototype
 * @category Class Management
 *
 * @param ctx Context to use
 * @param ctor Constructor function
 * @param proto Prototype object
 * @tsparam ctx JSContextPointer
 * @tsparam ctor JSValueConstPointer
 * @tsparam proto JSValueConstPointer
 */
void HAKO_SetConstructor(LEPUSContext* ctx, LEPUSValueConst* ctor,
                         LEPUSValueConst* proto);

/**
 * @brief Creates a new instance of a class
 * @category Class Management
 *
 * @param ctx Context to use
 * @param class_id Class ID
 * @return LEPUSValue* - New class instance
 * @tsparam ctx JSContextPointer
 * @tsparam class_id number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewObjectClass(LEPUSContext* ctx, LEPUSClassID class_id);

/**
 * @brief Sets opaque data on an object
 * @category Class Management
 *
 * @param obj Object to set data on
 * @param opaque Opaque data pointer
 * @tsparam obj JSValueConstPointer
 * @tsparam opaque number
 */
void HAKO_SetOpaque(LEPUSValueConst* obj, JSVoid* opaque);

/**
 * @brief Gets opaque data from an object
 * @category Class Management
 *
 * @param ctx Context to use
 * @param obj Object to get data from
 * @param class_id Expected class ID for type safety
 * @return JSVoid* - Opaque data pointer, NULL if wrong class or no data
 * @tsparam ctx JSContextPointer
 * @tsparam obj JSValueConstPointer
 * @tsparam class_id number
 * @tsreturn number
 */
JSVoid* HAKO_GetOpaque(LEPUSContext* ctx, LEPUSValueConst* obj,
                       LEPUSClassID class_id);

/**
 * @brief Creates a new object with a prototype and class ID
 * @category Class Management
 *
 * @param ctx Context to create in
 * @param proto Prototype object
 * @param class_id Class ID for the new object
 * @return LEPUSValue* - New object with specified prototype and class ID
 * @tsparam ctx JSContextPointer
 * @tsparam proto JSValueConstPointer
 * @tsparam class_id number
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_NewObjectProtoClass(LEPUSContext* ctx, LEPUSValueConst* proto,
                                     LEPUSClassID class_id);

/**
 * @brief Sets a private value associated with a module
 * @category Module Creation
 *
 * @param ctx Context to use
 * @param module Module to set private value on
 * @param value Value to associate with the module
 * @tsparam ctx JSContextPointer
 * @tsparam module LEPUSModuleDef
 * @tsparam value JSValuePointer
 */
void HAKO_SetModulePrivateValue(LEPUSContext* ctx, LEPUSModuleDef* module,
                                LEPUSValue* value);

/**
 * @brief Gets the private value associated with a module
 * @category Module Creation
 *
 * @param ctx Context to use
 * @param module Module to get private value from
 * @return LEPUSValue* - Private value associated with the module
 * @tsparam ctx JSContextPointer
 * @tsparam module LEPUSModuleDef
 * @tsreturn JSValuePointer
 */
LEPUSValue* HAKO_GetModulePrivateValue(LEPUSContext* ctx,
                                       LEPUSModuleDef* module);
/**
 * @brief Checks if a value is null
 * @category Value Operations
 * @param value Value to check
 * @return LEPUS_BOOL - True if value is null
 * @tsparam value JSValueConstPointer
 * @tsreturn LEPUS_BOOL
 */
LEPUS_BOOL HAKO_IsNull(LEPUSValueConst* value);

#ifdef HAKO_DEBUG_MODE
#define HAKO_LOG(msg) hako_log(msg)
#else
#define HAKO_LOG(msg) ((void)0)
#endif

#ifdef __cplusplus
}
#endif

#endif /* HAKO_H */
