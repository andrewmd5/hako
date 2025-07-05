
#ifndef BUILD_H
#define BUILD_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Build flags indicating which features are enabled in the runtime
 */
typedef enum HAKO_BuildFlag {
  HAKO_BuildFlag_Debug = 1 << 0,         /* Debug build */
  HAKO_BuildFlag_Sanitizer = 1 << 1,     /* Address sanitizer enabled */
  HAKO_BuildFlag_Bignum = 1 << 2,        /* BigNum support enabled */
  HAKO_BuildFlag_LepusNG = 1 << 3,       /* LepusNG enabled */
  HAKO_BuildFlag_Debugger = 1 << 4,      /* QuickJS debugger enabled */
  HAKO_BuildFlag_Snapshot = 1 << 5,      /* PrimJS snapshot enabled */
  HAKO_BuildFlag_CompatibleMM = 1 << 6,  /* Compatible memory management */
  HAKO_BuildFlag_Nanbox = 1 << 7,        /* NaN boxing enabled */
  HAKO_BuildFlag_CodeCache = 1 << 8,     /* Code cache enabled */
  HAKO_BuildFlag_CacheProfile = 1 << 9,  /* Cache profiling enabled */
  HAKO_BuildFlag_MemDetection = 1 << 10, /* Memory leak detection enabled */
  HAKO_BuildFlag_Atomics = 1 << 11,      /* Atomics support enabled */
  HAKO_BuildFlag_ForceGC = 1 << 12,      /* Force GC at allocation enabled */
  HAKO_BuildFlag_LynxSimplify = 1 << 13, /* Lynx simplification enabled */
  HAKO_BuildFlag_BuiltinSerialize = 1 << 14, /* Builtin serialization enabled */
  HAKO_BuildFlag_HakoProfiler = 1 << 15,     /* Hako profiler enabled */
} HAKO_BuildFlag;

/* Build flags as individual compile-time constants */
#if defined(DEBUG) || defined(_DEBUG)
#define HAKO_HAS_DEBUG 1
#else
#define HAKO_HAS_DEBUG 0
#endif

#ifdef __SANITIZE_ADDRESS__
#define HAKO_HAS_SANITIZER 1
#else
#define HAKO_HAS_SANITIZER 0
#endif

#ifdef CONFIG_BIGNUM
#define HAKO_HAS_BIGNUM 1
#else
#define HAKO_HAS_BIGNUM 0
#endif

#ifdef ENABLE_LEPUSNG
#define HAKO_HAS_LEPUSNG 1
#else
#define HAKO_HAS_LEPUSNG 0
#endif

#ifdef ENABLE_QUICKJS_DEBUGGER
#define HAKO_HAS_DEBUGGER 1
#else
#define HAKO_HAS_DEBUGGER 0
#endif

#ifdef ENABLE_PRIMJS_SNAPSHOT
#define HAKO_HAS_SNAPSHOT 1
#else
#define HAKO_HAS_SNAPSHOT 0
#endif

#ifdef ENABLE_COMPATIBLE_MM
#define HAKO_HAS_COMPATIBLE_MM 1
#else
#define HAKO_HAS_COMPATIBLE_MM 0
#endif

#if defined(DISABLE_NANBOX) && DISABLE_NANBOX == 0
#define HAKO_HAS_NANBOX 1
#else
#define HAKO_HAS_NANBOX 0
#endif

#ifdef ENABLE_CODECACHE
#define HAKO_HAS_CODECACHE 1
#else
#define HAKO_HAS_CODECACHE 0
#endif

#ifdef CACHE_PROFILE
#define HAKO_HAS_CACHE_PROFILE 1
#else
#define HAKO_HAS_CACHE_PROFILE 0
#endif

#ifdef DEBUG_MEMORY
#define HAKO_HAS_MEM_DETECTION 1
#else
#define HAKO_HAS_MEM_DETECTION 0
#endif

#if defined(CONFIG_ATOMICS) || defined(ENABLE_ATOMICS)
#define HAKO_HAS_ATOMICS 1
#else
#define HAKO_HAS_ATOMICS 0
#endif

#ifdef FORCE_GC_AT_MALLOC
#define HAKO_HAS_FORCE_GC 1
#else
#define HAKO_HAS_FORCE_GC 0
#endif

#ifdef LYNX_SIMPLIFY
#define HAKO_HAS_LYNX_SIMPLIFY 1
#else
#define HAKO_HAS_LYNX_SIMPLIFY 0
#endif

#ifdef ENABLE_BUILTIN_SERIALIZE
#define HAKO_HAS_BUILTIN_SERIALIZE 1
#else
#define HAKO_HAS_BUILTIN_SERIALIZE 0
#endif

#ifdef ENABLE_HAKO_PROFILER
#define HAKO_HAS_HAKO_PROFILER 1
#else
#define HAKO_HAS_HAKO_PROFILER 0
#endif

/* Define the build flags value as a true compile-time constant */
#define HAKO_BUILD_FLAGS_VALUE                                          \
  ((HAKO_HAS_DEBUG ? HAKO_BuildFlag_Debug : 0) |                        \
   (HAKO_HAS_SANITIZER ? HAKO_BuildFlag_Sanitizer : 0) |                \
   (HAKO_HAS_BIGNUM ? HAKO_BuildFlag_Bignum : 0) |                      \
   (HAKO_HAS_LEPUSNG ? HAKO_BuildFlag_LepusNG : 0) |                    \
   (HAKO_HAS_DEBUGGER ? HAKO_BuildFlag_Debugger : 0) |                  \
   (HAKO_HAS_SNAPSHOT ? HAKO_BuildFlag_Snapshot : 0) |                  \
   (HAKO_HAS_COMPATIBLE_MM ? HAKO_BuildFlag_CompatibleMM : 0) |         \
   (HAKO_HAS_NANBOX ? HAKO_BuildFlag_Nanbox : 0) |                      \
   (HAKO_HAS_CODECACHE ? HAKO_BuildFlag_CodeCache : 0) |                \
   (HAKO_HAS_CACHE_PROFILE ? HAKO_BuildFlag_CacheProfile : 0) |         \
   (HAKO_HAS_MEM_DETECTION ? HAKO_BuildFlag_MemDetection : 0) |         \
   (HAKO_HAS_ATOMICS ? HAKO_BuildFlag_Atomics : 0) |                    \
   (HAKO_HAS_FORCE_GC ? HAKO_BuildFlag_ForceGC : 0) |                   \
   (HAKO_HAS_LYNX_SIMPLIFY ? HAKO_BuildFlag_LynxSimplify : 0) |         \
   (HAKO_HAS_BUILTIN_SERIALIZE ? HAKO_BuildFlag_BuiltinSerialize : 0) | \
   (HAKO_HAS_HAKO_PROFILER ? HAKO_BuildFlag_HakoProfiler : 0))

/* Helper macro to check if a build flag is enabled at compile time */
#define HAKO_IS_ENABLED(flag) ((HAKO_BUILD_FLAGS_VALUE & (flag)) != 0)

/**
 * @brief Structure containing build information
 */
typedef struct HakoBuildInfo {
  const char* version;    /* Git version */
  HAKO_BuildFlag flags;   /* Feature flags bitmap */
  const char* build_date; /* Build date */
  const char* wasi_sdk_version;
  const char* wasi_libc;    /* WASI-libc commit hash */
  const char* llvm;         /* LLVM commit hash */
  const char* llvm_version; /* LLVM version */
  const char* config;       /* Configuration hash */
} HakoBuildInfo;

#ifdef __cplusplus
}
#endif

#endif /* BUILD_H */
