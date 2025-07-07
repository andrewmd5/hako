// Simple ban macros for unsafe memory and string functions
#ifndef HAKO_UNSAFE_BAN_H
#define HAKO_UNSAFE_BAN_H

// Ban direct malloc/free usage
#ifdef malloc
#undef malloc
#endif
#ifdef free
#undef free
#endif
#ifdef calloc
#undef calloc
#endif
#ifdef realloc
#undef realloc
#endif

// Ban unsafe string functions
#ifdef strcpy
#undef strcpy
#endif
#ifdef strncpy
#undef strncpy
#endif

// Create compile-time errors for banned functions
#define malloc(size) _Static_assert(0, "Use lepus_malloc() instead of malloc()")

#define free(ptr) _Static_assert(0, "Use lepus_free() instead of free()")

#define calloc(nmemb, size) \
  _Static_assert(0, "Use lepus_mallocz() instead of calloc()")

#define realloc(ptr, size) \
  _Static_assert(0, "Use lepus_realloc() instead of realloc()")

#define strcpy(dest, src) \
  _Static_assert(         \
      0, "Use lepus_strndup() or safe string functions instead of strcpy()")

#define strncpy(dest, src, n)                                             \
  _Static_assert(0,                                                       \
                 "Use lepus_strndup() or memcpy() with null termination " \
                 "instead of strncpy()")

// For cases where you absolutely need system functions (e.g., host interfacing)
#define SYSTEM_MALLOC_UNSAFE(size) __builtin_malloc(size)
#define SYSTEM_FREE_UNSAFE(ptr) __builtin_free(ptr)
#define SYSTEM_CALLOC_UNSAFE(nmemb, size) __builtin_calloc(nmemb, size)
#define SYSTEM_REALLOC_UNSAFE(ptr, size) __builtin_realloc(ptr, size)

#endif  // HAKO_UNSAFE_BAN_H