#include <math.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#ifdef HAKO_SANITIZE_LEAK
#include <sanitizer/lsan_interface.h>
#endif
#include "cutils.h"
#include "hako.h"
#include "quickjs-libc.h"
#include "version.h"
#include "wasi_version.h"
#define PKG "quickjs-wasi: "
#define LOG_LEN 500
#define NUM_THREADS 10
#include <wasi/api.h>

/**
 * Define attribute for exporting functions to WebAssembly
 */
#if defined(__WASI__) || defined(__wasi__)
#define WASM_EXPORT(func) __attribute__((export_name(#func))) func
#else
#define WASM_EXPORT(func) func
#endif

typedef struct hako_RuntimeData
{
  bool debug_log;
} hako_RuntimeData;

__attribute__((import_module("hako"),
               import_name("call_function"))) extern LEPUSValue *
host_call_function(LEPUSContext *ctx, LEPUSValueConst *this_ptr, int argc,
                   LEPUSValueConst *argv, uint32_t magic_func_id);

__attribute__((import_module("hako"),
               import_name("interrupt_handler"))) extern int
host_interrupt_handler(LEPUSRuntime *rt, LEPUSContext *ctx, void *opaque);

__attribute__((import_module("hako"),
               import_name("load_module_source"))) extern char *
host_load_module_source(LEPUSRuntime *rt, LEPUSContext *ctx,
                        CString *module_name);

__attribute__((import_module("hako"),
               import_name("normalize_module"))) extern char *
host_normalize_module(LEPUSRuntime *rt, LEPUSContext *ctx,
                      CString *module_base_name, CString *module_name);

__attribute__((import_module("hako"),
               import_name("profile_function_start"))) extern void
host_profile_function_start(LEPUSContext *ctx, CString *event, JSVoid *opaque);

__attribute__((import_module("hako"),
               import_name("profile_function_end"))) extern void
host_profile_function_end(LEPUSContext *ctx, CString *event, JSVoid *opaque);

static const char *HAKO_BAD_FREE_MSG =
    "+---------------------------------------------------------+\n"
    "|                    FATAL ERROR #1                       |\n"
    "+---------------------------------------------------------+\n"
    "| Attempted to free constant JavaScript primitive:        |\n"
    "| Address: %p                                             |\n"
    "|                                                         |\n"
    "| Cannot free undefined/null/true/false as these are      |\n"
    "| static values. Doing so would cause undefined behavior  |\n"
    "| and probable memory corruption.                         |\n"
    "|                                                         |\n"
    "| Fix: Check value ownership before attempting to free.   |\n"
    "+---------------------------------------------------------+\n";

static HakoBuildInfo build_info = {.version = HAKO_VERSION,
                                   .flags = HAKO_BUILD_FLAGS_VALUE,
                                   .build_date = __DATE__ " " __TIME__,
                                   .wasi_sdk_version = WASI_VERSION,
                                   .wasi_libc = WASI_WASI_LIBC,
                                   .llvm = WASI_LLVM,
                                   .llvm_version = WASI_LLVM_VERSION,
                                   .config = WASI_CONFIG};

hako_RuntimeData *hako_get_runtime_data(LEPUSRuntime *rt)
{
  hako_RuntimeData *data = malloc(sizeof(hako_RuntimeData));
  data->debug_log = false;
  return data;
}

hako_RuntimeData *hako_get_context_rt_data(LEPUSContext *ctx)
{
  return hako_get_runtime_data(LEPUS_GetRuntime(ctx));
}

void hako_log(char *msg)
{
  fputs(PKG, stderr);
  fputs(msg, stderr);
  fputs("\n", stderr);
}

void hako_dump(LEPUSContext *ctx, LEPUSValueConst value)
{
  CString *str = LEPUS_ToCString(ctx, value);
  if (!str)
  {
    return;
  }
  fputs(str, stderr);
  LEPUS_FreeCString(ctx, str);
  putchar('\n');
}



#define MAX_EVENT_BUFFER_SIZE 1024
static char event_buffer[MAX_EVENT_BUFFER_SIZE];

static int hako_atom_to_str(LEPUSContext *ctx, JSAtom atom, const char **out_str, const char *default_value)
{
  // Use provided default_value if available, otherwise use "<anonymous>"
  const char *anonymous_str = default_value ? default_value : "<anonymous>";
  if (atom == 0 /*JS_ATOM_NULL*/)
  {
    *out_str = anonymous_str;
    return 0; // Static string, no need to free
  }
  const char *atom_str = LEPUS_AtomToCString(ctx, atom);
  if (atom_str[0])
  {
    *out_str = atom_str;
    return 1; // Dynamic string, needs to be freed
  }
  *out_str = anonymous_str;
  return 0; // Static string, no need to free
}

static void hako_profile_function_start(LEPUSContext *ctx, JSAtom func, JSAtom filename, void *opaque)
{
  __wasi_errno_t err;
  __wasi_timestamp_t current_time;
  // Get the current time using WASI
  err = __wasi_clock_time_get(__WASI_CLOCKID_MONOTONIC, 0, &current_time);

  const char *func_str;
  int need_free_func = hako_atom_to_str(ctx, func, &func_str, NULL);

  const char *filename_str;
  int need_free_filename = hako_atom_to_str(ctx, filename, &filename_str, "file://hako.c");

  // Use the shared buffer for formatting the event
  int written = snprintf(event_buffer, MAX_EVENT_BUFFER_SIZE,
                         "{\"name\": \"%s\",\"cat\": \"js\",\"ph\": \"B\",\"ts\": %llu,\"pid\": 1,\"tid\": 1,\"args\": {\"file\": \"%s\"}}",
                         func_str, current_time / 1000, filename_str);

  host_profile_function_start(ctx, event_buffer, opaque);

  // Clean up dynamic strings
  if (need_free_func)
  {
    LEPUS_FreeCString(ctx, func_str);
  }
  if (need_free_filename)
  {
    LEPUS_FreeCString(ctx, filename_str);
  }
}

static void hako_profile_function_end(LEPUSContext *ctx, JSAtom func, JSAtom filename, void *opaque)
{
  
  __wasi_errno_t err;
  __wasi_timestamp_t current_time;
  // Get the current time using WASI
  err = __wasi_clock_time_get(__WASI_CLOCKID_MONOTONIC, 0, &current_time);

  const char *func_str;
  int need_free_func = hako_atom_to_str(ctx, func, &func_str, NULL);

  const char *filename_str;
  int need_free_filename = hako_atom_to_str(ctx, filename, &filename_str, "file://hako.c");

  // Use the shared buffer for formatting the event
  int written = snprintf(event_buffer, MAX_EVENT_BUFFER_SIZE,
                         "{\"name\": \"%s\",\"cat\": \"js\",\"ph\": \"E\",\"ts\": %llu,\"pid\": 1,\"tid\": 1,\"args\": {\"file\": \"%s\"}}",
                         func_str, current_time / 1000, filename_str);

  host_profile_function_end(ctx, event_buffer, opaque);

  // Clean up dynamic strings
  if (need_free_func)
  {
    LEPUS_FreeCString(ctx, func_str);
  }
  if (need_free_filename)
  {
    LEPUS_FreeCString(ctx, filename_str);
  }
}

static struct LEPUSModuleDef *hako_compile_module(LEPUSContext *ctx, CString *module_name,
                                                  BorrowedHeapChar *module_body)
{
  // Use explicit flags for module compilation
  int eval_flags = LEPUS_EVAL_TYPE_MODULE | LEPUS_EVAL_FLAG_COMPILE_ONLY |
                   LEPUS_EVAL_FLAG_STRICT;

  LEPUSValue func_val = LEPUS_Eval(ctx, module_body, strlen(module_body),
                                   module_name, eval_flags);

  if (LEPUS_IsException(func_val))
  {
    return NULL;
  }

  // Ensure the result is a module
  if (!LEPUS_VALUE_IS_MODULE(func_val))
  {
    LEPUS_ThrowTypeError(ctx, "Module '%s' code compiled to non-module object",
                         module_name);
    LEPUS_FreeValue(ctx, func_val);
    return NULL;
  }

  struct LEPUSModuleDef *module = LEPUS_VALUE_GET_PTR(func_val);
  LEPUS_FreeValue(ctx, func_val);

  return module;
}

static LEPUSModuleDef *hako_load_module(LEPUSContext *ctx, CString *module_name,
                                        void *_unused)
{
  LEPUSRuntime *rt = LEPUS_GetRuntime(ctx);
  char *module_source = host_load_module_source(rt, ctx, module_name);
  if (module_source == NULL)
  {
    LEPUS_ThrowTypeError(
        ctx,
        "Module not found: '%s'. Please check that the module name is correct "
        "and the module is available in your environment.",
        module_name);
    return NULL;
  }

  LEPUSModuleDef *module = hako_compile_module(ctx, module_name, module_source);
  free(module_source);
  return module;
}

static char *hako_normalize_module(LEPUSContext *ctx, CString *module_base_name,
                                   CString *module_name, void *_unused)
{
  LEPUSRuntime *rt = LEPUS_GetRuntime(ctx);
  char *normalized_module_name =
      host_normalize_module(rt, ctx, module_base_name, module_name);
  char *js_module_name = lepus_strdup(ctx, normalized_module_name, 1);
  free(normalized_module_name);
  return js_module_name;
}

static LEPUSValue *jsvalue_to_heap(LEPUSValueConst value)
{
  LEPUSValue *result = malloc(sizeof(LEPUSValue));
  if (result)
  {
    *result = value;
  }
  return result;
}

LEPUSValue *WASM_EXPORT(HAKO_Throw)(LEPUSContext *ctx, LEPUSValueConst *error)
{
  LEPUSValue copy = LEPUS_DupValue(ctx, *error);
  return jsvalue_to_heap(LEPUS_Throw(ctx, copy));
}

LEPUSValue *WASM_EXPORT(HAKO_NewError)(LEPUSContext *ctx)
{
  return jsvalue_to_heap(LEPUS_NewError(ctx));
}

/**
 * Limits.
 */

/**
 * Memory limit. Set to -1 to disable.
 */
void WASM_EXPORT(HAKO_RuntimeSetMemoryLimit)(LEPUSRuntime *rt, size_t limit)
{
  LEPUS_SetMemoryLimit(rt, limit);
}

/**
 * Memory diagnostics
 */

LEPUSValue *WASM_EXPORT(HAKO_RuntimeComputeMemoryUsage)(LEPUSRuntime *rt,
                                                        LEPUSContext *ctx)
{
#if LYNX_SIMPLIFY
  LEPUSMemoryUsage s;
  LEPUS_ComputeMemoryUsage(rt, &s);

  LEPUSValue result = LEPUS_NewObject(ctx);

  LEPUS_SetPropertyStr(ctx, result, "malloc_limit",
                       LEPUS_NewInt64(ctx, s.malloc_limit));
  LEPUS_SetPropertyStr(ctx, result, "memory_used_size",
                       LEPUS_NewInt64(ctx, s.memory_used_size));
  LEPUS_SetPropertyStr(ctx, result, "malloc_count",
                       LEPUS_NewInt64(ctx, s.malloc_count));
  LEPUS_SetPropertyStr(ctx, result, "memory_used_count",
                       LEPUS_NewInt64(ctx, s.memory_used_count));
  LEPUS_SetPropertyStr(ctx, result, "atom_count",
                       LEPUS_NewInt64(ctx, s.atom_count));
  LEPUS_SetPropertyStr(ctx, result, "atom_size",
                       LEPUS_NewInt64(ctx, s.atom_size));
  LEPUS_SetPropertyStr(ctx, result, "str_count",
                       LEPUS_NewInt64(ctx, s.str_count));
  LEPUS_SetPropertyStr(ctx, result, "str_size",
                       LEPUS_NewInt64(ctx, s.str_size));
  LEPUS_SetPropertyStr(ctx, result, "obj_count",
                       LEPUS_NewInt64(ctx, s.obj_count));
  LEPUS_SetPropertyStr(ctx, result, "obj_size",
                       LEPUS_NewInt64(ctx, s.obj_size));
  LEPUS_SetPropertyStr(ctx, result, "prop_count",
                       LEPUS_NewInt64(ctx, s.prop_count));
  LEPUS_SetPropertyStr(ctx, result, "prop_size",
                       LEPUS_NewInt64(ctx, s.prop_size));
  LEPUS_SetPropertyStr(ctx, result, "shape_count",
                       LEPUS_NewInt64(ctx, s.shape_count));
  LEPUS_SetPropertyStr(ctx, result, "shape_size",
                       LEPUS_NewInt64(ctx, s.shape_size));
  LEPUS_SetPropertyStr(ctx, result, "lepus_func_count",
                       LEPUS_NewInt64(ctx, s.lepus_func_count));
  LEPUS_SetPropertyStr(ctx, result, "lepus_func_size",
                       LEPUS_NewInt64(ctx, s.lepus_func_size));
  LEPUS_SetPropertyStr(ctx, result, "lepus_func_code_size",
                       LEPUS_NewInt64(ctx, s.lepus_func_code_size));
  LEPUS_SetPropertyStr(ctx, result, "lepus_func_pc2line_count",
                       LEPUS_NewInt64(ctx, s.lepus_func_pc2line_count));
  LEPUS_SetPropertyStr(ctx, result, "lepus_func_pc2line_size",
                       LEPUS_NewInt64(ctx, s.lepus_func_pc2line_size));
  LEPUS_SetPropertyStr(ctx, result, "c_func_count",
                       LEPUS_NewInt64(ctx, s.c_func_count));
  LEPUS_SetPropertyStr(ctx, result, "array_count",
                       LEPUS_NewInt64(ctx, s.array_count));
  LEPUS_SetPropertyStr(ctx, result, "fast_array_count",
                       LEPUS_NewInt64(ctx, s.fast_array_count));
  LEPUS_SetPropertyStr(ctx, result, "fast_array_elements",
                       LEPUS_NewInt64(ctx, s.fast_array_elements));
  LEPUS_SetPropertyStr(ctx, result, "binary_object_count",
                       LEPUS_NewInt64(ctx, s.binary_object_count));
  LEPUS_SetPropertyStr(ctx, result, "binary_object_size",
                       LEPUS_NewInt64(ctx, s.binary_object_size));

  return jsvalue_to_heap(result);
#else
  LEPUSValue result = LEPUS_NewObject(ctx);
  return jsvalue_to_heap(result);
#endif
}

OwnedHeapChar *WASM_EXPORT(HAKO_RuntimeDumpMemoryUsage)(LEPUSRuntime *rt)
{
#if LYNX_SIMPLIFY
  char *result = malloc(sizeof(char) * 1024);
  FILE *memfile = fmemopen(result, 1024, "w");
  LEPUSMemoryUsage s;
  LEPUS_ComputeMemoryUsage(rt, &s);
  LEPUS_DumpMemoryUsage(memfile, &s, rt);
  fclose(memfile);
  return result;
#else
  char *result = malloc(sizeof(char) * 1024);
  snprintf(result, 1024,
           "Memory usage unavailable - LYNX_SIMPLIFY not defined");
  return result;
#endif
}

int WASM_EXPORT(HAKO_RecoverableLeakCheck)()
{
#ifdef HAKO_SANITIZE_LEAK
  return __lsan_do_recoverable_leak_check();
#else
  return 0;
#endif
}

LEPUS_BOOL WASM_EXPORT(HAKO_BuildIsSanitizeLeak)()
{
#ifdef HAKO_SANITIZE_LEAK
  return 1;
#else
  return 0;
#endif
}

void WASM_EXPORT(HAKO_RuntimeJSThrow)(LEPUSContext *ctx, CString *message)
{
  LEPUS_ThrowReferenceError(ctx, "%s", message);
}

void WASM_EXPORT(HAKO_ContextSetMaxStackSize)(LEPUSContext *ctx,
                                              size_t stack_size)
{
  LEPUS_SetMaxStackSize(ctx, stack_size);
}

/**
 * Constant pointers. Because we always use LEPUSValue* from the host Javascript
 * environment, we need helper functions to return pointers to these constants.
 */

LEPUSValueConst HAKO_Undefined = LEPUS_UNDEFINED;
LEPUSValueConst *WASM_EXPORT(HAKO_GetUndefined)() { return &HAKO_Undefined; }

LEPUSValueConst HAKO_Null = LEPUS_NULL;
LEPUSValueConst *WASM_EXPORT(HAKO_GetNull)() { return &HAKO_Null; }

LEPUSValueConst HAKO_False = LEPUS_FALSE;
LEPUSValueConst *WASM_EXPORT(HAKO_GetFalse)() { return &HAKO_False; }

LEPUSValueConst HAKO_True = LEPUS_TRUE;
LEPUSValueConst *WASM_EXPORT(HAKO_GetTrue)() { return &HAKO_True; }

/**
 * Standard FFI functions
 */

void WASM_EXPORT(HAKO_EnableProfileCalls)(LEPUSRuntime *rt, uint32_t sampling, JSVoid *opaque)
{
#ifdef ENABLE_HAKO_PROFILER
  JS_EnableProfileCalls(rt, hako_profile_function_start, hako_profile_function_end, sampling, opaque);
#endif
}

LEPUSRuntime *WASM_EXPORT(HAKO_NewRuntime)()
{
  LEPUSRuntime *rt = LEPUS_NewRuntimeWithMode(0);
  if (rt == NULL)
  {
    return NULL;
  }

#ifdef ENABLE_COMPATIBLE_MM
#ifdef ENABLE_LEPUSNG
  LEPUS_SetRuntimeInfo(rt, "Lynx_LepusNG");
#else
  LEPUS_SetRuntimeInfo(rt, "Lynx_JS");
#endif
#else
#ifdef ENABLE_LEPUSNG
  LEPUS_SetRuntimeInfo(rt, "Lynx_LepusNG_RC");
#else
  LEPUS_SetRuntimeInfo(rt, "Lynx_JS_RC");
#endif

#endif
  return rt;
}

void WASM_EXPORT(HAKO_FreeRuntime)(LEPUSRuntime *rt)
{
  LEPUS_FreeRuntime(rt);
}

void WASM_EXPORT(HAKO_SetStripInfo)(LEPUSRuntime *rt, int flags)
{
  LEPUS_SetStripInfo(rt, flags);
}

int WASM_EXPORT(HAKO_GetStripInfo)(LEPUSRuntime *rt)
{
  return LEPUS_GetStripInfo(rt);
}

LEPUSContext *WASM_EXPORT(HAKO_NewContext)(LEPUSRuntime *rt,
                                           HAKO_Intrinsic intrinsics)
{
  if (intrinsics == 0)
  {
    return LEPUS_NewContext(rt);
  }

  LEPUSContext *ctx = LEPUS_NewContextRaw(rt);
  if (ctx == NULL)
  {
    return NULL;
  }

  if (intrinsics & HAKO_Intrinsic_BaseObjects)
  {
    LEPUS_AddIntrinsicBaseObjects(ctx);
  }
  if (intrinsics & HAKO_Intrinsic_Date)
  {
    LEPUS_AddIntrinsicDate(ctx);
  }
  if (intrinsics & HAKO_Intrinsic_Eval)
  {
    LEPUS_AddIntrinsicEval(ctx);
  }
  if (intrinsics & HAKO_Intrinsic_StringNormalize)
  {
    LEPUS_AddIntrinsicStringNormalize(ctx);
  }
  if (intrinsics & HAKO_Intrinsic_RegExp)
  {
    LEPUS_AddIntrinsicRegExp(ctx);
  }
  if (intrinsics & HAKO_Intrinsic_RegExpCompiler)
  {
    LEPUS_AddIntrinsicRegExpCompiler(ctx);
  }
  if (intrinsics & HAKO_Intrinsic_JSON)
  {
    LEPUS_AddIntrinsicJSON(ctx);
  }
  if (intrinsics & HAKO_Intrinsic_Proxy)
  {
    LEPUS_AddIntrinsicProxy(ctx);
  }
  if (intrinsics & HAKO_Intrinsic_MapSet)
  {
    LEPUS_AddIntrinsicMapSet(ctx);
  }
  if (intrinsics & HAKO_Intrinsic_TypedArrays)
  {
    LEPUS_AddIntrinsicTypedArrays(ctx);
  }
  if (intrinsics & HAKO_Intrinsic_Promise)
  {
    LEPUS_AddIntrinsicPromise(ctx);
  }
  if (intrinsics & HAKO_Intrinsic_Performance)
  {
    LEPUS_AddIntrinsicPerformance(ctx);
  }

  return ctx;
}

void WASM_EXPORT(HAKO_SetContextData)(LEPUSContext *ctx, JSVoid *data)
{
    LEPUS_SetContextOpaque(ctx, data);
}

JSVoid *WASM_EXPORT(HAKO_GetContextData)(LEPUSContext *ctx)
{
  return LEPUS_GetContextOpaque(ctx);
}

void WASM_EXPORT(HAKO_SetNoStrictMode)(LEPUSContext *ctx)
{
  LEPUS_SetNoStrictMode(ctx);
}

void WASM_EXPORT(HAKO_SetVirtualStackSize)(LEPUSContext *ctx, uint32_t size)
{
  LEPUS_SetVirtualStackSize(ctx, size);
}

void WASM_EXPORT(HAKO_FreeContext)(LEPUSContext *ctx)
{
  LEPUS_FreeContext(ctx);
}

void WASM_EXPORT(HAKO_FreeValuePointer)(LEPUSContext *ctx,
                                        LEPUSValue *value)
{
  if (value == &HAKO_Undefined || value == &HAKO_Null || value == &HAKO_True ||
      value == &HAKO_False)
  {
    fprintf(stderr, HAKO_BAD_FREE_MSG, (void *)value);
    __builtin_trap();
  }
  LEPUS_FreeValue(ctx, *value);
  free(value);
}

void WASM_EXPORT(HAKO_FreeValuePointerRuntime)(LEPUSRuntime *rt,
                                               LEPUSValue *value)
{
  if (value == &HAKO_Undefined || value == &HAKO_Null || value == &HAKO_True ||
      value == &HAKO_False)
  {
    fprintf(stderr, HAKO_BAD_FREE_MSG, (void *)value);
    __builtin_trap();
  }
  LEPUS_FreeValueRT(rt, *value);
  free(value);
}

void WASM_EXPORT(HAKO_FreeVoidPointer)(LEPUSContext *ctx, JSVoid *ptr)
{
  lepus_free(ctx, ptr);
}

void WASM_EXPORT(HAKO_FreeCString)(LEPUSContext *ctx, JSBorrowedChar *str)
{
  LEPUS_FreeCString(ctx, str);
}

LEPUSValue *WASM_EXPORT(HAKO_DupValuePointer)(LEPUSContext *ctx,
                                              LEPUSValueConst *val)
{
  return jsvalue_to_heap(LEPUS_DupValue(ctx, *val));
}

LEPUSValue *WASM_EXPORT(HAKO_NewObject)(LEPUSContext *ctx)
{
  return jsvalue_to_heap(LEPUS_NewObject(ctx));
}

LEPUSValue *WASM_EXPORT(HAKO_NewObjectProto)(LEPUSContext *ctx,
                                             LEPUSValueConst *proto)
{
  return jsvalue_to_heap(LEPUS_NewObjectProto(ctx, *proto));
}

LEPUSValue *WASM_EXPORT(HAKO_NewArray)(LEPUSContext *ctx)
{
  return jsvalue_to_heap(LEPUS_NewArray(ctx));
}

void hako_free_buffer(LEPUSRuntime *unused_rt, void *unused_opaque,
                      void *ptr)
{
  free(ptr);
}

LEPUSValue *WASM_EXPORT(HAKO_NewArrayBuffer)(LEPUSContext *ctx, JSVoid *buffer,
                                             size_t length)
{
  return jsvalue_to_heap(LEPUS_NewArrayBuffer(ctx, (uint8_t *)buffer, length,
                                              hako_free_buffer, NULL, false));
}

LEPUSValue *WASM_EXPORT(HAKO_NewFloat64)(LEPUSContext *ctx, double num)
{
  return jsvalue_to_heap(LEPUS_NewFloat64(ctx, num));
}

double WASM_EXPORT(HAKO_GetFloat64)(LEPUSContext *ctx, LEPUSValueConst *value)
{
  double result = NAN;
  LEPUS_ToFloat64(ctx, &result, *value);
  return result;
}

LEPUSValue *WASM_EXPORT(HAKO_NewString)(LEPUSContext *ctx,
                                        BorrowedHeapChar *string)
{
  return jsvalue_to_heap(LEPUS_NewString(ctx, string));
}

JSBorrowedChar *WASM_EXPORT(HAKO_ToCString)(LEPUSContext *ctx,
                                            LEPUSValueConst *value)
{
  return LEPUS_ToCString(ctx, *value);
}

JSVoid *WASM_EXPORT(HAKO_CopyArrayBuffer)(LEPUSContext *ctx,
                                          LEPUSValueConst *data,
                                          size_t *out_length)
{
  size_t length;
  uint8_t *buffer = LEPUS_GetArrayBuffer(ctx, &length, *data);
  if (!buffer)
    return 0;
  uint8_t *result = malloc(length);
  if (!result)
    return result;
  memcpy(result, buffer, length);
  if (out_length)
    *out_length = length;

  return result;
}

LEPUSValue hako_get_symbol_key(LEPUSContext *ctx, LEPUSValueConst *value)
{
  LEPUSValue global = LEPUS_GetGlobalObject(ctx);
  LEPUSValue Symbol = LEPUS_GetPropertyStr(ctx, global, "Symbol");
  LEPUS_FreeValue(ctx, global);

  LEPUSValue Symbol_keyFor = LEPUS_GetPropertyStr(ctx, Symbol, "keyFor");
  LEPUSValue key = LEPUS_Call(ctx, Symbol_keyFor, Symbol, 1, value);
  LEPUS_FreeValue(ctx, Symbol_keyFor);
  LEPUS_FreeValue(ctx, Symbol);
  return key;
}

LEPUSValue hako_resolve_func_data(LEPUSContext *ctx, LEPUSValueConst this_val,
                                  int argc, LEPUSValueConst *argv, int magic,
                                  LEPUSValue *func_data)
{
  return LEPUS_DupValue(ctx, func_data[0]);
}

LEPUSValue *WASM_EXPORT(HAKO_Eval)(LEPUSContext *ctx, BorrowedHeapChar *js_code,
                                   size_t js_code_length, BorrowedHeapChar *filename,
                                   EvalDetectModule detectModule,
                                   EvalFlags evalFlags)
{
  // Only detect module if detection is enabled and module type isn't already
  // specified
  if (detectModule && (evalFlags & LEPUS_EVAL_TYPE_MODULE) == 0)
  {
    bool isModule = LEPUS_DetectModule(js_code, js_code_length);
    if (isModule)
    {
      evalFlags |= LEPUS_EVAL_TYPE_MODULE;
    }
  }

  LEPUSModuleDef *module = NULL;
  LEPUSValue eval_result;
  bool is_module = (evalFlags & LEPUS_EVAL_TYPE_MODULE) != 0;

  // Compile and evaluate module code specially
  if (is_module && (evalFlags & LEPUS_EVAL_FLAG_COMPILE_ONLY) == 0)
  {
    LEPUSValue func_obj = LEPUS_Eval(ctx, js_code, js_code_length, filename,
                                     evalFlags | LEPUS_EVAL_FLAG_COMPILE_ONLY);
    if (LEPUS_IsException(func_obj))
    {
      return jsvalue_to_heap(func_obj);
    }

    if (!LEPUS_VALUE_IS_MODULE(func_obj))
    {
      LEPUS_FreeValue(ctx, func_obj);
      return jsvalue_to_heap(LEPUS_ThrowTypeError(
          ctx, "Module code compiled to non-module object"));
    }

    module = LEPUS_VALUE_GET_PTR(func_obj);
    if (module == NULL)
    {
      LEPUS_FreeValue(ctx, func_obj);
      return jsvalue_to_heap(
          LEPUS_ThrowTypeError(ctx, "Module compiled to null"));
    }

    eval_result = LEPUS_EvalFunction(ctx, func_obj, LEPUS_UNDEFINED);
  }
  else
  {
    // Regular evaluation for non-module code or compile-only
    eval_result = LEPUS_Eval(ctx, js_code, js_code_length, filename, evalFlags);
  }

  // If we got an exception or not a promise, return it directly
  if (LEPUS_IsException(eval_result) || !LEPUS_IsPromise(eval_result))
  {
    // For non-promise modules, return the module namespace
    if (is_module && !LEPUS_IsPromise(eval_result) &&
        !LEPUS_IsException(eval_result))
    {
      LEPUSValue module_namespace = LEPUS_GetModuleNamespace(ctx, module);
      LEPUS_FreeValue(ctx, eval_result);
      return jsvalue_to_heap(module_namespace);
    }

    // For everything else, return the eval result directly
    return jsvalue_to_heap(eval_result);
  }

  // At this point, we know we're dealing with a promise
  LEPUSPromiseStateEnum state = LEPUS_PromiseState(ctx, eval_result);

  // Handle promise based on its state
  if (state == LEPUS_PROMISE_FULFILLED || state == -1)
  {
    // For fulfilled promises with modules, return the namespace
    if (is_module)
    {
      LEPUSValue module_namespace = LEPUS_GetModuleNamespace(ctx, module);
      LEPUS_FreeValue(ctx, eval_result);
      return jsvalue_to_heap(module_namespace);
    }
    else
    {
      // For non-modules, get the promise result
      LEPUSValue result = LEPUS_PromiseResult(ctx, eval_result);
      LEPUS_FreeValue(ctx, eval_result);
      return jsvalue_to_heap(result);
    }
  }
  else if (state == LEPUS_PROMISE_REJECTED)
  {
    // For rejected promises, throw the rejection reason
    LEPUSValue reason = LEPUS_PromiseResult(ctx, eval_result);
    LEPUS_Throw(ctx, reason);
    LEPUS_FreeValue(ctx, reason);
    LEPUS_FreeValue(ctx, eval_result);
    return jsvalue_to_heap(LEPUS_EXCEPTION);
  }
  else if (state == LEPUS_PROMISE_PENDING)
  {
    // For pending promises, handle differently based on whether it's a module
    if (is_module)
    {
      LEPUSValue module_namespace = LEPUS_GetModuleNamespace(ctx, module);
      if (LEPUS_IsException(module_namespace))
      {
        LEPUS_FreeValue(ctx, eval_result);
        return jsvalue_to_heap(module_namespace);
      }

      LEPUSValue then_resolve_module_namespace = LEPUS_NewCFunctionData(
          ctx, &hako_resolve_func_data, 0, 0, 1, &module_namespace);
      LEPUS_FreeValue(ctx, module_namespace);
      if (LEPUS_IsException(then_resolve_module_namespace))
      {
        LEPUS_FreeValue(ctx, eval_result);
        return jsvalue_to_heap(then_resolve_module_namespace);
      }

      LEPUSAtom then_atom = LEPUS_NewAtom(ctx, "then");
      LEPUSValueConst then_args[1] = {then_resolve_module_namespace};
      LEPUSValue new_promise =
          LEPUS_Invoke(ctx, eval_result, then_atom, 1, then_args);
      LEPUS_FreeAtom(ctx, then_atom);
      LEPUS_FreeValue(ctx, then_resolve_module_namespace);
      LEPUS_FreeValue(ctx, eval_result);
      return jsvalue_to_heap(new_promise);
    }
    else
    {
      // For non-modules, return the promise directly
      return jsvalue_to_heap(eval_result);
    }
  }
  else
  {
    // Unknown promise state, return as is
    return jsvalue_to_heap(eval_result);
  }
}

LEPUSValue *WASM_EXPORT(HAKO_NewSymbol)(LEPUSContext *ctx,
                                        BorrowedHeapChar *description,
                                        int isGlobal)
{
  LEPUSValue global = LEPUS_GetGlobalObject(ctx);
  LEPUSValue Symbol = LEPUS_GetPropertyStr(ctx, global, "Symbol");
  LEPUS_FreeValue(ctx, global);
  LEPUSValue descriptionValue = LEPUS_NewString(ctx, description);
  LEPUSValue symbol;

  if (isGlobal != 0)
  {
    LEPUSValue Symbol_for = LEPUS_GetPropertyStr(ctx, Symbol, "for");
    symbol = LEPUS_Call(ctx, Symbol_for, Symbol, 1, &descriptionValue);
    LEPUS_FreeValue(ctx, descriptionValue);
    LEPUS_FreeValue(ctx, Symbol_for);
    LEPUS_FreeValue(ctx, Symbol);
    return jsvalue_to_heap(symbol);
  }

  symbol = LEPUS_Call(ctx, Symbol, LEPUS_UNDEFINED, 1, &descriptionValue);
  LEPUS_FreeValue(ctx, descriptionValue);
  LEPUS_FreeValue(ctx, Symbol);

  return jsvalue_to_heap(symbol);
}

JSBorrowedChar *
WASM_EXPORT(HAKO_GetSymbolDescriptionOrKey)(LEPUSContext *ctx,
                                            LEPUSValueConst *value)
{
  JSBorrowedChar *result;

  LEPUSValue key = hako_get_symbol_key(ctx, value);
  if (!LEPUS_IsUndefined(key))
  {
    result = LEPUS_ToCString(ctx, key);
    LEPUS_FreeValue(ctx, key);
    return result;
  }

  LEPUSValue description = LEPUS_GetPropertyStr(ctx, *value, "description");
  result = LEPUS_ToCString(ctx, description);
  LEPUS_FreeValue(ctx, description);
  return result;
}

LEPUS_BOOL WASM_EXPORT(HAKO_IsGlobalSymbol)(LEPUSContext *ctx,
                                            LEPUSValueConst *value)
{
  LEPUSValue key = hako_get_symbol_key(ctx, value);
  int undefined = LEPUS_IsUndefined(key);
  LEPUS_FreeValue(ctx, key);

  if (undefined)
  {
    return 0;
  }
  else
  {
    return 1;
  }
}

LEPUS_BOOL WASM_EXPORT(HAKO_IsJobPending)(LEPUSRuntime *rt)
{
  return LEPUS_IsJobPending(rt);
}

LEPUSValue *WASM_EXPORT(HAKO_ExecutePendingJob)(LEPUSRuntime *rt,
                                                int maxJobsToExecute,
                                                LEPUSContext **lastJobContext)
{
  LEPUSContext *pctx;
  int status = 1;
  int executed = 0;
  while (executed != maxJobsToExecute && status == 1)
  {
    status = LEPUS_ExecutePendingJob(rt, &pctx);
    if (status == -1)
    {
      *lastJobContext = pctx;
      return jsvalue_to_heap(LEPUS_GetException(pctx));
    }
    else if (status == 1)
    {
      *lastJobContext = pctx;
      executed++;
    }
  }
  return jsvalue_to_heap(LEPUS_NewFloat64(pctx, executed));
}

LEPUSValue *WASM_EXPORT(HAKO_GetProp)(LEPUSContext *ctx,
                                      LEPUSValueConst *this_val,
                                      LEPUSValueConst *prop_name)
{
  LEPUSAtom prop_atom = LEPUS_ValueToAtom(ctx, *prop_name);
  LEPUSValue prop_val = LEPUS_GetProperty(ctx, *this_val, prop_atom);
  LEPUS_FreeAtom(ctx, prop_atom);
  if (LEPUS_IsException(prop_val))
  {
    return NULL;
  }
  return jsvalue_to_heap(prop_val);
}

LEPUSValue *WASM_EXPORT(HAKO_GetPropNumber)(LEPUSContext *ctx,
                                            LEPUSValueConst *this_val,
                                            int prop_name)
{
  LEPUSValue prop_val =
      LEPUS_GetPropertyUint32(ctx, *this_val, (uint32_t)prop_name);
  if (LEPUS_IsException(prop_val))
  {
    return NULL;
  }
  return jsvalue_to_heap(prop_val);
}

LEPUS_BOOL WASM_EXPORT(HAKO_SetProp)(LEPUSContext *ctx,
                                     LEPUSValueConst *this_val,
                                     LEPUSValueConst *prop_name,
                                     LEPUSValueConst *prop_value)
{
  LEPUSAtom prop_atom = LEPUS_ValueToAtom(ctx, *prop_name);
  LEPUSValue extra_prop_value = LEPUS_DupValue(ctx, *prop_value);
  int result = LEPUS_SetProperty(ctx, *this_val, prop_atom, extra_prop_value);
  LEPUS_FreeAtom(ctx, prop_atom);
  return result;
}

LEPUS_BOOL WASM_EXPORT(HAKO_DefineProp)(
    LEPUSContext *ctx, LEPUSValueConst *this_val, LEPUSValueConst *prop_name,
    LEPUSValueConst *prop_value, LEPUSValueConst *get, LEPUSValueConst *set,
    LEPUS_BOOL configurable, LEPUS_BOOL enumerable, LEPUS_BOOL has_value)
{
  LEPUSAtom prop_atom = LEPUS_ValueToAtom(ctx, *prop_name);

  int flags = 0;
  if (configurable)
  {
    flags = flags | LEPUS_PROP_CONFIGURABLE;
    if (has_value)
    {
      flags = flags | LEPUS_PROP_HAS_CONFIGURABLE;
    }
  }
  if (enumerable)
  {
    flags = flags | LEPUS_PROP_ENUMERABLE;
    if (has_value)
    {
      flags = flags | LEPUS_PROP_HAS_ENUMERABLE;
    }
  }
  if (!LEPUS_IsUndefined(*get))
  {
    flags = flags | LEPUS_PROP_HAS_GET;
  }
  if (!LEPUS_IsUndefined(*set))
  {
    flags = flags | LEPUS_PROP_HAS_SET;
  }
  if (has_value)
  {
    flags = flags | LEPUS_PROP_HAS_VALUE;
  }

  int result = LEPUS_DefineProperty(ctx, *this_val, prop_atom, *prop_value,
                                    *get, *set, flags);
  LEPUS_FreeAtom(ctx, prop_atom);
  return result;
}

static inline bool __JS_AtomIsTaggedInt(LEPUSAtom v)
{
  return (v & LEPUS_ATOM_TAG_INT) != 0;
}

static inline uint32_t __JS_AtomToUInt32(LEPUSAtom atom)
{
  return atom & ~LEPUS_ATOM_TAG_INT;
}

LEPUSValue *WASM_EXPORT(HAKO_GetOwnPropertyNames)(LEPUSContext *ctx,
                                                  LEPUSValue ***out_ptrs,
                                                  uint32_t *out_len,
                                                  LEPUSValueConst *obj,
                                                  int flags)
{
  if (out_ptrs == NULL || out_len == NULL)
  {
    return jsvalue_to_heap(LEPUS_ThrowTypeError(ctx, "Invalid arguments"));
  }
  if (LEPUS_IsObject(*obj) == false)
  {
    return jsvalue_to_heap(LEPUS_ThrowTypeError(ctx, "not an object"));
  }

  LEPUSPropertyEnum *tab = NULL;
  uint32_t total_props = 0;
  uint32_t out_props = 0;

  bool hako_standard_compliant_number =
      (flags & HAKO_STANDARD_COMPLIANT_NUMBER) != 0;
  bool hako_include_string = (flags & LEPUS_GPN_STRING_MASK) != 0;
  bool hako_include_number =
      hako_standard_compliant_number ? 0 : (flags & HAKO_GPN_NUMBER_MASK) != 0;
  if (hako_include_number)
  {
    flags = flags | LEPUS_GPN_STRING_MASK;
  }

  int status = 0;
  status = LEPUS_GetOwnPropertyNames(ctx, &tab, &total_props, *obj, flags);
  if (status < 0)
  {
    if (tab != NULL)
    {
      lepus_free(ctx, tab);
    }
    return jsvalue_to_heap(LEPUS_GetException(ctx));
  }
  *out_ptrs = malloc(sizeof(LEPUSValue) * *out_len);
  for (int i = 0; i < total_props; i++)
  {
    LEPUSAtom atom = tab[i].atom;

    if (__JS_AtomIsTaggedInt(atom))
    {
      if (hako_include_number)
      {
        uint32_t v = __JS_AtomToUInt32(atom);
        (*out_ptrs)[out_props++] = jsvalue_to_heap(LEPUS_NewInt32(ctx, v));
      }
      else if (hako_include_string && hako_standard_compliant_number)
      {
        (*out_ptrs)[out_props++] =
            jsvalue_to_heap(LEPUS_AtomToValue(ctx, tab[i].atom));
      }
      LEPUS_FreeAtom(ctx, atom);
      continue;
    }

    LEPUSValue atom_value = LEPUS_AtomToValue(ctx, atom);
    LEPUS_FreeAtom(ctx, atom);

    if (LEPUS_IsString(atom_value))
    {
      if (hako_include_string)
      {
        (*out_ptrs)[out_props++] = jsvalue_to_heap(atom_value);
      }
      else
      {
        LEPUS_FreeValue(ctx, atom_value);
      }
    }
    else
    {
      (*out_ptrs)[out_props++] = jsvalue_to_heap(atom_value);
    }
  }
  lepus_free(ctx, tab);
  *out_len = out_props;
  return NULL;
}

LEPUSValue *WASM_EXPORT(HAKO_Call)(LEPUSContext *ctx, LEPUSValueConst *func_obj,
                                   LEPUSValueConst *this_obj, int argc,
                                   LEPUSValueConst **argv_ptrs)
{
  LEPUSValueConst argv[argc];
  int i;
  for (i = 0; i < argc; i++)
  {
    argv[i] = *(argv_ptrs[i]);
  }

  return jsvalue_to_heap(LEPUS_Call(ctx, *func_obj, *this_obj, argc, argv));
}

LEPUSValue *WASM_EXPORT(HAKO_GetLastError)(LEPUSContext *ctx,
                                           LEPUSValue *maybe_exception)
{
  // If maybe_exception is provided
  if (maybe_exception != NULL)
  {
    // Only if it's an exception, return the result of GetException
    if (LEPUS_IsException(*maybe_exception))
    {
      return jsvalue_to_heap(LEPUS_GetException(ctx));
    }
    // If it's provided but not an exception, just return NULL
    return NULL;
  }

  // If maybe_exception is NULL, check if there's an exception in context
  LEPUSValue exception = LEPUS_GetException(ctx);
  if (!LEPUS_IsNull(exception))
  {
    return jsvalue_to_heap(exception);
  }
  return NULL;
}

/**
 * Enhanced dump function with JSON serialization and property enumeration
 */
JSBorrowedChar *WASM_EXPORT(HAKO_Dump)(LEPUSContext *ctx,
                                       LEPUSValueConst *obj)
{
  LEPUSValue error_obj = LEPUS_UNDEFINED;
  LEPUSValue json_value = LEPUS_UNDEFINED;
  JSBorrowedChar *result = NULL;

  // Special handling for Error objects
  if (LEPUS_IsError(ctx, *obj))
  {
    // Create a plain object to hold error properties
    error_obj = LEPUS_NewObject(ctx);
    LEPUSValue current_error = LEPUS_DupValue(ctx, *obj);
    LEPUSValue current_obj = error_obj;
    LEPUSValue next_obj;
    int depth = 0;

    while (depth < 3)
    {
      // Get message property
      LEPUSValue message = LEPUS_GetPropertyStr(ctx, current_error, "message");
      if (!LEPUS_IsException(message) && !LEPUS_IsUndefined(message))
      {
        // Set directly - LEPUS_SetPropertyStr will handle reference counting
        LEPUS_SetPropertyStr(ctx, current_obj, "message", message);
        // Don't free message here - SetPropertyStr either increases the ref
        // count or takes ownership
      }
      else
      {
        // Only free if we didn't set the property
        LEPUS_FreeValue(ctx, message);
      }

      // Get name property
      LEPUSValue name = LEPUS_GetPropertyStr(ctx, current_error, "name");
      if (!LEPUS_IsException(name) && !LEPUS_IsUndefined(name))
      {
        LEPUS_SetPropertyStr(ctx, current_obj, "name", name);
        // Don't free name here
      }
      else
      {
        LEPUS_FreeValue(ctx, name);
      }

      // Get stack property
      LEPUSValue stack = LEPUS_GetPropertyStr(ctx, current_error, "stack");
      if (!LEPUS_IsException(stack) && !LEPUS_IsUndefined(stack))
      {
        LEPUS_SetPropertyStr(ctx, current_obj, "stack", stack);
        // Don't free stack here
      }
      else
      {
        LEPUS_FreeValue(ctx, stack);
      }

      // Check for cause
      LEPUSValue cause = LEPUS_GetPropertyStr(ctx, current_error, "cause");

      if (!LEPUS_IsException(cause) && !LEPUS_IsUndefined(cause) &&
          !LEPUS_IsNull(cause) && LEPUS_IsError(ctx, cause) &&
          depth < 2) // Check depth before going deeper
      {
        // Create a new object for the cause
        next_obj = LEPUS_NewObject(ctx);

        // Link current object to the cause
        LEPUS_SetPropertyStr(ctx, current_obj, "cause", next_obj);

        // Move to next iteration
        current_obj = next_obj;
        LEPUS_FreeValue(ctx, current_error);
        current_error = cause; // Take ownership, don't free
        depth++;
      }
      else
      {
        // Handle non-error cause or max depth reached
        if (!LEPUS_IsException(cause) && !LEPUS_IsUndefined(cause) &&
            !LEPUS_IsNull(cause))
        {
          LEPUS_SetPropertyStr(ctx, current_obj, "cause", cause);
          // Don't free cause here
        }
        else
        {
          LEPUS_FreeValue(ctx, cause);
        }
        LEPUS_FreeValue(ctx, current_error);
        break;
      }
    }

    // Use LEPUS_ToJSON to create JSON string
    json_value = LEPUS_ToJSON(ctx, error_obj, 2); // Indent with 2 spaces
    LEPUS_FreeValue(ctx, error_obj);

    if (!LEPUS_IsException(json_value))
    {
      // Convert to C string
      result = LEPUS_ToCString(ctx, json_value);
      LEPUS_FreeValue(ctx, json_value);
      return result;
    }
    else
    {
      LEPUS_FreeValue(ctx, json_value);
    }
  }
  else
  {
    // For non-error objects, try LEPUS_ToJSON directly
    json_value = LEPUS_ToJSON(ctx, *obj, 2); // Indent with 2 spaces
    if (!LEPUS_IsException(json_value))
    {
      // Convert to C string
      result = LEPUS_ToCString(ctx, json_value);
      LEPUS_FreeValue(ctx, json_value);
      return result;
    }
    else
    {
      LEPUS_FreeValue(ctx, json_value);
    }
  }

  // If JSON serialization fails, use a static buffer
  static char error_buffer[128];
  snprintf(error_buffer, sizeof(error_buffer),
           "{\"error\":\"Failed to serialize object\"}");
  return error_buffer;
}

LEPUSValue *
WASM_EXPORT(HAKO_GetModuleNamespace)(LEPUSContext *ctx,
                                     LEPUSValueConst *module_func_obj)
{
  if (!LEPUS_VALUE_IS_MODULE(*module_func_obj))
  {
    return jsvalue_to_heap(LEPUS_ThrowTypeError(ctx, "Not a module"));
  }

  struct LEPUSModuleDef *module = LEPUS_VALUE_GET_PTR(*module_func_obj);
  return jsvalue_to_heap(LEPUS_GetModuleNamespace(ctx, module));
}

OwnedHeapChar *WASM_EXPORT(HAKO_Typeof)(LEPUSContext *ctx,
                                        LEPUSValueConst *value)
{
  CString *result = "unknown";

  if (LEPUS_IsUndefined(*value))
  {
    result = "undefined";
  }
  else if (LEPUS_IsNull(*value))
  {
    result = "null";
  }
  else if (LEPUS_IsNumber(*value))
  {
    result = "number";
  }
#ifdef CONFIG_BIGNUM
  else if (LEPUS_IsBigInt(*value))
  {
    result = "bigint";
  }
  else if (LEPUS_IsBigFloat(*value))
  {
    result = "bigfloat";
  }
#endif
  else if (LEPUS_IsFunction(ctx, *value))
  {
    result = "function";
  }
  else if (LEPUS_IsBool(*value))
  {
    result = "boolean";
  }
  else if (LEPUS_IsNull(*value))
  {
    result = "object";
  }
  else if (LEPUS_IsUninitialized(*value))
  {
    result = "undefined";
  }
  else if (LEPUS_IsString(*value))
  {
    result = "string";
  }
  else if (LEPUS_IsSymbol(*value))
  {
    result = "symbol";
  }
  else if (LEPUS_IsObject(*value))
  {
    result = "object";
  }
  char *out = strdup(result);
  return out;
}

LEPUSAtom HAKO_AtomLength = 0;
int WASM_EXPORT(HAKO_GetLength)(LEPUSContext *ctx, uint32_t *out_len,
                                LEPUSValueConst *value)
{
  LEPUSValue len_val;
  int result;

  if (!LEPUS_IsObject(*value))
  {
    return -1;
  }

  if (HAKO_AtomLength == 0)
  {
    HAKO_AtomLength = LEPUS_NewAtom(ctx, "length");
  }

  len_val = LEPUS_GetProperty(ctx, *value, HAKO_AtomLength);
  if (LEPUS_IsException(len_val))
  {
    return -1;
  }

  result = LEPUS_ToUint32(ctx, out_len, len_val);
  LEPUS_FreeValue(ctx, len_val);
  return result;
}

LEPUS_BOOL WASM_EXPORT(HAKO_IsEqual)(LEPUSContext *ctx, LEPUSValueConst *a,
                                     LEPUSValueConst *b, IsEqualOp op)
{
  switch (op)
  {
  case HAKO_EqualOp_SameValue:
    return LEPUS_SameValue(ctx, *a, *b);
  case HAKO_EqualOp_SameValueZero:
    return LEPUS_SameValueZero(ctx, *a, *b);
  default:
  case HAKO_EqualOp_StrictEq:
    return LEPUS_StrictEq(ctx, *a, *b);
  }
}

LEPUSValue *WASM_EXPORT(HAKO_GetGlobalObject)(LEPUSContext *ctx)
{
  return jsvalue_to_heap(LEPUS_GetGlobalObject(ctx));
}

LEPUSValue *
WASM_EXPORT(HAKO_NewPromiseCapability)(LEPUSContext *ctx,
                                       LEPUSValue **resolve_funcs_out)
{
  LEPUSValue resolve_funcs[2];
  LEPUSValue promise = LEPUS_NewPromiseCapability(ctx, resolve_funcs);
  resolve_funcs_out[0] = jsvalue_to_heap(resolve_funcs[0]);
  resolve_funcs_out[1] = jsvalue_to_heap(resolve_funcs[1]);
  return jsvalue_to_heap(promise);
}

LEPUS_BOOL WASM_EXPORT(HAKO_IsPromise)(LEPUSContext *ctx,
                                       LEPUSValueConst *promise)
{
  return LEPUS_IsPromise(*promise);
}

LEPUSPromiseStateEnum WASM_EXPORT(HAKO_PromiseState)(LEPUSContext *ctx,
                                                     LEPUSValueConst *promise)
{
  return LEPUS_PromiseState(ctx, *promise);
}

LEPUSValue *WASM_EXPORT(HAKO_PromiseResult)(LEPUSContext *ctx,
                                            LEPUSValueConst *promise)
{
  return jsvalue_to_heap(LEPUS_PromiseResult(ctx, *promise));
}

LEPUS_BOOL WASM_EXPORT(HAKO_BuildIsDebug)()
{
#ifdef HAKO_DEBUG_MODE
  return 1;
#else
  return 0;
#endif
}

CString *WASM_EXPORT(HAKO_GetVersion)() { return HAKO_VERSION; }

uint64_t WASM_EXPORT(HAKO_GetPrimjsVersion)()
{
  return LEPUS_GetPrimjsVersion();
}

// Module loading helpers

// C -> Host Callbacks
LEPUSValue *hako_host_call_function(LEPUSContext *ctx,
                                    LEPUSValueConst *this_ptr, int argc,
                                    LEPUSValueConst *argv,
                                    uint32_t magic_func_id)
{
  return host_call_function(ctx, this_ptr, argc, argv, magic_func_id);
}

// Function: PrimJS -> C
LEPUSValue hako_call_function(LEPUSContext *ctx, LEPUSValueConst this_val,
                              int argc, LEPUSValueConst *argv, int magic)
{
  LEPUSValue *result_ptr =
      hako_host_call_function(ctx, &this_val, argc, argv, magic);
  if (result_ptr == NULL)
  {
    return LEPUS_UNDEFINED;
  }

  LEPUSValue result = *result_ptr;

  if (result_ptr == &HAKO_Undefined || result_ptr == &HAKO_Null ||
      result_ptr == &HAKO_True || result_ptr == &HAKO_False)
  {
    return result;
  }
  free(result_ptr);
  return result;
}

LEPUSValue *WASM_EXPORT(HAKO_NewFunction)(LEPUSContext *ctx, uint32_t func_id,
                                          CString *name)
{
  LEPUSValue func_obj =
      LEPUS_NewCFunctionMagic(ctx, hako_call_function, name, 0,
                              LEPUS_CFUNC_constructor_or_func_magic, func_id);
  return jsvalue_to_heap(func_obj);
}

LEPUSValueConst *
WASM_EXPORT(HAKO_ArgvGetJSValueConstPointer)(LEPUSValueConst *argv, int index)
{
  return &argv[index];
}

void WASM_EXPORT(HAKO_RuntimeEnableInterruptHandler)(LEPUSRuntime *rt, JSVoid *opaque)
{
  LEPUS_SetInterruptHandler(rt, host_interrupt_handler, opaque);
}

void WASM_EXPORT(HAKO_RuntimeDisableInterruptHandler)(LEPUSRuntime *rt)
{
  LEPUS_SetInterruptHandler(rt, NULL, NULL);
}

void WASM_EXPORT(HAKO_RuntimeEnableModuleLoader)(LEPUSRuntime *rt,
                                                 LEPUS_BOOL use_custom_normalize)
{
  LEPUSModuleNormalizeFunc *module_normalize = NULL;
  if (use_custom_normalize)
  {
    module_normalize = hako_normalize_module;
  }
  LEPUS_SetModuleLoaderFunc(rt, module_normalize, hako_load_module, NULL);
}

void WASM_EXPORT(HAKO_RuntimeDisableModuleLoader)(LEPUSRuntime *rt)
{
  LEPUS_SetModuleLoaderFunc(rt, NULL, NULL, NULL);
}

LEPUSValue *WASM_EXPORT(HAKO_bjson_encode)(LEPUSContext *ctx,
                                           LEPUSValueConst *val)
{
  size_t length;
  uint8_t *buffer = LEPUS_WriteObject(ctx, &length, *val, 0);
  if (!buffer)
    return jsvalue_to_heap(LEPUS_EXCEPTION);

  LEPUSValue array = LEPUS_NewArrayBufferCopy(ctx, buffer, length);
  lepus_free(ctx, buffer);
  return jsvalue_to_heap(array);
}

LEPUSValue *WASM_EXPORT(HAKO_bjson_decode)(LEPUSContext *ctx,
                                           LEPUSValueConst *data)
{
  size_t length;
  uint8_t *buffer = LEPUS_GetArrayBuffer(ctx, &length, *data);
  if (!buffer)
    return jsvalue_to_heap(LEPUS_EXCEPTION);

  LEPUSValue value = LEPUS_ReadObject(ctx, buffer, length, 0);
  return jsvalue_to_heap(value);
}

LEPUS_BOOL WASM_EXPORT(HAKO_IsArray)(LEPUSContext *ctx, LEPUSValueConst *val)
{
  return LEPUS_IsArray(ctx, *val);
}

LEPUS_BOOL WASM_EXPORT(HAKO_IsTypedArray)(LEPUSContext *ctx,
                                          LEPUSValueConst *val)
{
  return LEPUS_IsTypedArray(ctx, *val);
}

// there is a super weird bug here where if any string literal contains the
// class name (e.g. "Uint8Array") it will be corrupted in memory.
HAKO_TypedArrayType WASM_EXPORT(HAKO_GetTypedArrayType)(LEPUSContext *ctx,
                                                        LEPUSValueConst *val)
{
  LEPUSTypedArrayType type = LEPUS_GetTypedArrayType(ctx, *val);

  switch (type)
  {
  case LEPUS_TYPED_UINT8_ARRAY:
    return HAKO_TYPED_UINT8_ARRAY;
  case LEPUS_TYPED_UINT8C_ARRAY:
    return HAKO_TYPED_UINT8C_ARRAY;
  case LEPUS_TYPED_INT8_ARRAY:
    return HAKO_TYPED_INT8_ARRAY;
  case LEPUS_TYPED_UINT16_ARRAY:
    return HAKO_TYPED_UINT16_ARRAY;
  case LEPUS_TYPED_INT16_ARRAY:
    return HAKO_TYPED_INT16_ARRAY;
  case LEPUS_TYPED_UINT32_ARRAY:
    return HAKO_TYPED_UINT32_ARRAY;
  case LEPUS_TYPED_INT32_ARRAY:
    return HAKO_TYPED_INT32_ARRAY;
  case LEPUS_TYPED_FLOAT32_ARRAY:
    return HAKO_TYPED_FLOAT32_ARRAY;
  case LEPUS_TYPED_FLOAT64_ARRAY:
    return HAKO_TYPED_FLOAT64_ARRAY;
  default:
    return HAKO_TYPED_UNKNOWN;
  }
}

JSVoid *WASM_EXPORT(HAKO_CopyTypedArrayBuffer)(LEPUSContext *ctx,
                                               LEPUSValueConst *val,
                                               size_t *out_length)
{
  if (LEPUS_GetTypedArrayType(ctx, *val) != LEPUS_TYPED_UINT8_ARRAY)
  {
    LEPUS_ThrowTypeError(ctx, "Not a Uint8Array");
    return NULL;
  }

  size_t byte_offset, byte_length, bytes_per_element;
  LEPUSValue buffer = LEPUS_GetTypedArrayBuffer(
      ctx, *val, &byte_offset, &byte_length, &bytes_per_element);

  if (LEPUS_IsException(buffer))
    return NULL;

  // Now that we have the buffer, get the actual bytes
  size_t buffer_length;
  uint8_t *buffer_data = LEPUS_GetArrayBuffer(ctx, &buffer_length, buffer);
  if (!buffer_data)
  {
    LEPUS_FreeValue(ctx, buffer); // Free the buffer value we got
    return NULL;
  }

  // Allocate memory for the result
  uint8_t *result = malloc(byte_length);
  if (!result)
  {
    LEPUS_FreeValue(ctx, buffer);
    return NULL;
  }

  // Copy the relevant portion of the buffer
  memcpy(result, buffer_data + byte_offset, byte_length);

  // Set the output length if requested
  if (out_length)
    *out_length = byte_length;

  // Free the buffer value we obtained
  LEPUS_FreeValue(ctx, buffer);

  return result;
}

LEPUS_BOOL WASM_EXPORT(HAKO_IsArrayBuffer)(LEPUSValueConst *val)
{
  return LEPUS_IsArrayBuffer(*val);
}

LEPUSValue *WASM_EXPORT(HAKO_ToJson)(LEPUSContext *ctx, LEPUSValueConst *val,
                                     int indent)
{
  if (LEPUS_IsUndefined(*val))
  {
    return jsvalue_to_heap(LEPUS_NewString(ctx, "undefined"));
  }
  if (LEPUS_IsNull(*val))
  {
    return jsvalue_to_heap(LEPUS_NewString(ctx, "null"));
  }

  LEPUSValue result = LEPUS_ToJSON(ctx, *val, indent);
  if (LEPUS_IsException(result))
  {
    return jsvalue_to_heap(result);
  }
  return jsvalue_to_heap(result);
}

LEPUS_BOOL WASM_EXPORT(HAKO_IsError)(LEPUSContext *ctx, LEPUSValueConst *val)
{
  return LEPUS_IsError(ctx, *val);
}

LEPUS_BOOL WASM_EXPORT(HAKO_IsException)(LEPUSValueConst *val)
{
  return LEPUS_IsException(*val);
}

LEPUSValue *WASM_EXPORT(HAKO_GetException)(LEPUSContext *ctx)
{
  return jsvalue_to_heap(LEPUS_GetException(ctx));
}

void WASM_EXPORT(SetGCThreshold)(LEPUSRuntime *rt, int64_t threshold)
{
  LEPUS_SetGCThreshold(rt, threshold);
}

LEPUSValue *WASM_EXPORT(HAKO_NewBigInt)(LEPUSContext *ctx, int32_t low,
                                        int32_t high)
{
#ifdef CONFIG_BIGNUM
  int64_t combined = ((int64_t)high << 32) | ((uint32_t)low);
  return jsvalue_to_heap(LEPUS_NewBigInt64(ctx, combined));
#else
  return jsvalue_to_heap(LEPUS_ThrowTypeError(ctx, "BigInt not supported"));
#endif
}

LEPUSValue *WASM_EXPORT(HAKO_NewBigUInt)(LEPUSContext *ctx, uint32_t low,
                                         uint32_t high)
{
#ifdef CONFIG_BIGNUM
  uint64_t combined = ((uint64_t)high << 32) | low;
  return jsvalue_to_heap(LEPUS_NewBigUint64(ctx, combined));
#else
  return jsvalue_to_heap(LEPUS_ThrowTypeError(ctx, "BigInt not supported"));
#endif
}

LEPUS_BOOL WASM_EXPORT(HAKO_IsGCMode)(LEPUSContext *ctx)
{
  return LEPUS_IsGCMode(ctx);
}

LEPUSValue *WASM_EXPORT(HAKO_NewDate)(LEPUSContext *ctx, double time)
{
  return jsvalue_to_heap(LEPUS_NewDate(ctx, time));
}

LEPUSClassID WASM_EXPORT(HAKO_GetClassID)(LEPUSContext *ctx,
                                          LEPUSValueConst *val)
{
  return LEPUS_GetClassID(ctx, *val);
}

LEPUS_BOOL WASM_EXPORT(HAKO_IsInstanceOf)(LEPUSContext *ctx,
                                          LEPUSValueConst *val,
                                          LEPUSValueConst *obj)
{
  return LEPUS_IsInstanceOf(ctx, *val, *obj);
}

HakoBuildInfo *WASM_EXPORT(HAKO_BuildInfo)()
{
  // Return pointer to the existing static structure
  return &build_info;
}

void *thread_entry_point(void *ctx)
{
  int id = (int)ctx;
  printf(" in thread %d\n", id);
  return 0;
}
