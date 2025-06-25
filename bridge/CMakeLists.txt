cmake_minimum_required(VERSION 4.0.0)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(HAVE_FLAG_SEARCH_PATHS_FIRST 0)

# Get WASI SDK path from environment - require it to be set
if(DEFINED ENV{WASI_SDK_PATH})
  set(WASI_SDK_PATH $ENV{WASI_SDK_PATH})
else()
  message(FATAL_ERROR "WASI SDK not found. Please set WASI_SDK_PATH environment variable.")
endif()

if(DEFINED ENV{PRIMJS_DIR})
  set(PRIMJS_DIR $ENV{PRIMJS_DIR})
else()
  message(FATAL_ERROR "PrimJS dir not found. Please set PRIMJS_DIR environment variable.")
endif()

message(STATUS "Using WASI SDK from: ${WASI_SDK_PATH}")
message(STATUS "Using PrimJS from: ${PRIMJS_DIR}")

# Set WASI tools
set(CMAKE_C_COMPILER "${WASI_SDK_PATH}/bin/clang")
set(CMAKE_CXX_COMPILER "${WASI_SDK_PATH}/bin/clang++")
set(CMAKE_AR "${WASI_SDK_PATH}/bin/llvm-ar")
set(CMAKE_RANLIB "${WASI_SDK_PATH}/bin/llvm-ranlib")
set(CMAKE_STRIP "${WASI_SDK_PATH}/bin/llvm-strip")

# Set WASI sysroot and target
set(CMAKE_SYSROOT "${WASI_SDK_PATH}/share/wasi-sysroot")
set(CMAKE_C_COMPILER_TARGET "wasm32-wasi")
set(CMAKE_CXX_COMPILER_TARGET "wasm32-wasi")

set(CMAKE_TRY_COMPILE_TARGET_TYPE "STATIC_LIBRARY")
set(CMAKE_C_COMPILER_WORKS "1")
set(CMAKE_CXX_COMPILER_WORKS "1")

project("hako")
set(CMAKE_C_LINK_FLAGS "")
set(CMAKE_CXX_LINK_FLAGS "")
list(APPEND CMAKE_MODULE_PATH "${CMAKE_SOURCE_DIR}/cmake")

# Include the ParseWasiVersion module
include(ParseWasiVersion)

# Parse the WASI SDK VERSION file
parse_wasi_version(${WASI_SDK_PATH})

# Create a wasi_version.h file with the parsed values
configure_file(
    ${CMAKE_CURRENT_SOURCE_DIR}/cmake/wasi_version.h.in
    ${CMAKE_CURRENT_SOURCE_DIR}/wasi_version.h
)

include(GetGitVersion)
get_git_version(GIT_VERSION)
set(HAKO_VERSION ${GIT_VERSION})
configure_file(
    ${CMAKE_CURRENT_SOURCE_DIR}/cmake/version.h.in
    ${CMAKE_CURRENT_SOURCE_DIR}/version.h
)

# Basic settings
enable_language(C CXX ASM)
set(CMAKE_CXX_STANDARD 17)

# Build type
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE "Release")
endif()

message(STATUS "Building in ${CMAKE_BUILD_TYPE} mode")
message(STATUS "Source directory: ${CMAKE_CURRENT_SOURCE_DIR}")

if(CMAKE_BUILD_TYPE STREQUAL "Debug")
  # Debug mode - add debug info, disable optimizations
  set(OPTIMIZATION_FLAGS "-g -O0")
else()
  # Release mode - use full optimization
  set(OPTIMIZATION_FLAGS "-O3")
  set(WASM_OPT_FLAG "--wasm-opt")
endif()

# Configuration options
option(ENABLE_QUICKJS_DEBUGGER "Enable quickjs debugger" OFF)
option(ENABLE_HAKO_PROFILER "Enable the Hako profiler" OFF)
option(ENABLE_LEPUSNG "Enable LepusNG" ON)
option(ENABLE_PRIMJS_SNAPSHOT "Enable primjs snapshot" OFF)
option(ENABLE_COMPATIBLE_MM "Enable compatible memory" OFF)
option(DISABLE_NANBOX "Disable nanbox" OFF)
option(ENABLE_CODECACHE "Enable code cache" OFF)
option(CACHE_PROFILE "Enable cache profile" OFF)
option(ENABLE_MEM "Enable memory detection" OFF)
option(ENABLE_ATOMICS "Enable Atomics" OFF)
option(FORCE_GC "Enable force gc" OFF)
option(ENABLE_ASAN "Enable address sanitizer" OFF)
option(ENABLE_BIGNUM "Enable bignum" OFF)
option(WASM_INITIAL_MEMORY "Initial memory size in bytes" "25165824")  # 24MB default
option(WASM_MAX_MEMORY "Maximum memory size in bytes" "268435456") # 256MB default
option(WASM_STACK_SIZE "Stack size in bytes" "8388608")  # 8MB default
option(WASM_OUTPUT_NAME "Output name for the WASM file" "hako.wasm")


if(CMAKE_BUILD_TYPE STREQUAL "Debug")
   set(ENABLE_MEM ON)
endif()

# Required WASI emulation options
add_compile_options(
  -Wno-cast-function-type-mismatch
  -D_WASI_EMULATED_MMAN
  -D_WASI_EMULATED_SIGNAL
  -D_WASI_EMULATED_PROCESS_CLOCKS
  -DWASI_STACK_SIZE=${WASM_STACK_SIZE}
)

# Simplify for WASI
if(NOT DEFINED LYNX_SIMPLIFY)
  add_definitions(-DLYNX_SIMPLIFY -DENABLE_BUILTIN_SERIALIZE)
endif()

# Compiler flags
set(CMAKE_COMMON_FLAGS
    "${OPTIMIZATION_FLAGS} -fPIC -ffunction-sections -fdata-sections \
    -fno-short-enums -fno-strict-aliasing -Wall -Wextra -Wno-unused-parameter \
    -Wno-unused-function -faddrsig -Wno-c99-designator -Wno-unknown-warning-option \
    -Wno-sign-compare -Wno-unused-but-set-variable -msimd128 -mmultivalue -mmutable-globals -mtail-call -msign-ext -mbulk-memory -mnontrapping-fptoint -mextended-const")

if(ENABLE_ASAN)
  add_definitions(-DHAKO_SANITIZE_LEAK)
  set(CMAKE_COMMON_FLAGS
      "${CMAKE_COMMON_FLAGS} -fno-omit-frame-pointer")
else()
  set(CMAKE_COMMON_FLAGS
      "${CMAKE_COMMON_FLAGS} -fomit-frame-pointer -fno-sanitize=safe-stack")
endif()

set(CMAKE_C_FLAGS "${CMAKE_COMMON_FLAGS} ${CMAKE_C_FLAGS}")
set(CMAKE_CXX_FLAGS "${CMAKE_COMMON_FLAGS} ${CMAKE_CXX_FLAGS} -std=c++17")

set(CMAKE_SHARED_LINKER_FLAGS
    "${CMAKE_SHARED_LINKER_FLAGS} -Wl,--gc-sections -Wl,--build-id=sha1 -O2")

# Common definitions
add_definitions(-DEMSCRIPTEN)
add_definitions(-D__WASI_SDK__)
add_definitions(-DOS_WASI=1)

if(${ENABLE_LEPUSNG} AND ${ENABLE_BIGNUM})
  message(FATAL_ERROR "ENABLE_LEPUSNG and ENABLE_BIGNUM cannot be both enabled.")
endif()

if(${ENABLE_BIGNUM})
  add_definitions(-DCONFIG_BIGNUM)
endif()

if(${ENABLE_ATOMICS})
  add_definitions(-DENABLE_ATOMICS -DCONFIG_ATOMICS)
endif()

if(${ENABLE_HAKO_PROFILER})
  add_definitions(-DENABLE_HAKO_PROFILER)
endif()

# Feature definitions
if(${ENABLE_MEM})
  add_definitions(-DDEBUG_MEMORY)
  add_definitions(-DDUMP_QJS_VALUE)
  add_definitions(-DDUMP_LEAKS)
endif()

if(${FORCE_GC})
  add_definitions(-DFORCE_GC_AT_MALLOC)
endif()

if(${ENABLE_LEPUSNG})
  add_definitions(-DENABLE_LEPUSNG)
endif()

if(${DISABLE_NANBOX})
  add_definitions(-DDISABLE_NANBOX=1)
else()
  add_definitions(-DDISABLE_NANBOX=0)
endif()


# primjs snapshot version
if(${ENABLE_PRIMJS_SNAPSHOT})
  add_definitions(-DENABLE_PRIMJS_SNAPSHOT)

  if(${ENABLE_COMPATIBLE_MM})
    add_definitions(-DENABLE_COMPATIBLE_MM)
  endif()

  if(${ENABLE_QUICKJS_DEBUGGER})
    set(primjs_embedded_sources
        ${PRIMJS_DIR}/src/interpreter/primjs/wasi/embedded-inspector.S)
  else()
    set(primjs_embedded_sources
        ${PRIMJS_DIR}/src/interpreter/primjs/wasi/embedded.S)
  endif()
endif()

# List all QuickJS sources
set(quickjs_sources
    ${PRIMJS_DIR}/src/basic/log/logging.cc
    ${PRIMJS_DIR}/src/gc/allocator.cc
    ${PRIMJS_DIR}/src/gc/collector.cc
    ${PRIMJS_DIR}/src/gc/global-handles.cc
    ${PRIMJS_DIR}/src/gc/qjsvaluevalue-space.cc
    ${PRIMJS_DIR}/src/gc/sweeper.cc
    ${PRIMJS_DIR}/src/gc/thread_pool.cc
    ${PRIMJS_DIR}/src/gc/collector.cc
    ${PRIMJS_DIR}/src/interpreter/quickjs/source/cutils.cc
    ${PRIMJS_DIR}/src/interpreter/quickjs/source/libregexp.cc
    ${PRIMJS_DIR}/src/interpreter/quickjs/source/libunicode.cc
    ${PRIMJS_DIR}/src/interpreter/quickjs/source/primjs_monitor.cc
    ${PRIMJS_DIR}/src/interpreter/quickjs/source/quickjs_gc.cc
    ${PRIMJS_DIR}/src/interpreter/quickjs/source/quickjs_queue.cc
    ${PRIMJS_DIR}/src/interpreter/quickjs/source/quickjs_version.cc
    ${PRIMJS_DIR}/src/interpreter/quickjs/source/quickjs-libc.cc
    ${PRIMJS_DIR}/src/interpreter/quickjs/source/quickjs.cc)

# Add BigNum support if enabled
if(ENABLE_BIGNUM)
 set(quickjs_sources
     ${quickjs_sources}
     ${PRIMJS_DIR}/src/interpreter/quickjs/source/libbf.cc)
endif()

# Add debugger sources if enabled
if(${ENABLE_QUICKJS_DEBUGGER})
  add_definitions(-DENABLE_QUICKJS_DEBUGGER)
  set(quickjs_debugger_sources
      ${PRIMJS_DIR}/src/inspector/cpuprofiler/cpu_profiler.cc
      ${PRIMJS_DIR}/src/inspector/cpuprofiler/profile_generator.cc
      ${PRIMJS_DIR}/src/inspector/cpuprofiler/profile_tree.cc
      ${PRIMJS_DIR}/src/inspector/cpuprofiler/profiler_sampling.cc
      ${PRIMJS_DIR}/src/inspector/cpuprofiler/tracing_cpu_profiler.cc
      ${PRIMJS_DIR}/src/inspector/debugger/debugger_breakpoint.cc
      ${PRIMJS_DIR}/src/inspector/debugger/debugger_callframe.cc
      ${PRIMJS_DIR}/src/inspector/debugger/debugger_properties.cc
      ${PRIMJS_DIR}/src/inspector/debugger/debugger_queue.cc
      ${PRIMJS_DIR}/src/inspector/debugger/debugger.cc
      ${PRIMJS_DIR}/src/inspector/heapprofiler/edge.cc
      ${PRIMJS_DIR}/src/inspector/heapprofiler/entry.cc
      ${PRIMJS_DIR}/src/inspector/heapprofiler/gen.cc
      ${PRIMJS_DIR}/src/inspector/heapprofiler/heapexplorer.cc
      ${PRIMJS_DIR}/src/inspector/heapprofiler/heapprofiler.cc
      ${PRIMJS_DIR}/src/inspector/heapprofiler/serialize.cc
      ${PRIMJS_DIR}/src/inspector/heapprofiler/snapshot.cc
      ${PRIMJS_DIR}/src/inspector/runtime/runtime.cc
      ${PRIMJS_DIR}/src/inspector/protocols.cc
      ${PRIMJS_DIR}/src/inspector/string_tools.cc)

  # Add debugger sources to QuickJS sources
  set(quickjs_sources ${quickjs_sources} ${quickjs_debugger_sources})
endif()

# Add embedded sources if defined
if(DEFINED primjs_embedded_sources)
  set(quickjs_sources ${quickjs_sources} ${primjs_embedded_sources})
endif()

# Include directories
include_directories(
  ${PRIMJS_DIR}/src
  ${PRIMJS_DIR}/src/interpreter
  ${PRIMJS_DIR}/src/interpreter/quickjs/include
  ${PRIMJS_DIR}/src/interpreter/quickjs/source
  ${PRIMJS_DIR}/src/napi
  ${PRIMJS_DIR}/src/napi/common
  ${PRIMJS_DIR}/src/napi/env
  ${PRIMJS_DIR}/src/napi/internal
  ${PRIMJS_DIR}/src/napi/quickjs
  ${PRIMJS_DIR}/src/napi/v8)

# Build the QuickJS static library
add_library(quickjs STATIC ${quickjs_sources})
set_target_properties(quickjs PROPERTIES
  ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}
  OUTPUT_NAME "quick")

# Add WASI-specific link options to the QuickJS library
target_link_options(quickjs PRIVATE
  "-Wl,--allow-undefined -Wl,wasi-emulated-signal -Wl,wasi-emulated-process-clocks")

# Build the hako WASM module
set(hako_source
    ${CMAKE_CURRENT_SOURCE_DIR}/hako.c)

add_executable(hako_reactor ${hako_source})
set_target_properties(hako_reactor PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}
    OUTPUT_NAME ${WASM_OUTPUT_NAME}
)

target_link_libraries(hako_reactor PRIVATE quickjs)

target_include_directories(hako_reactor PRIVATE
    ${PRIMJS_DIR}/src
    ${PRIMJS_DIR}/src/interpreter
    ${PRIMJS_DIR}/src/interpreter/quickjs/include
    ${PRIMJS_DIR}/src/interpreter/quickjs/source
    ${PRIMJS_DIR}/src/napi
    ${PRIMJS_DIR}/src/napi/common
    ${PRIMJS_DIR}/src/napi/env
    ${PRIMJS_DIR}/src/napi/internal
    ${PRIMJS_DIR}/src/napi/quickjs
    ${PRIMJS_DIR}/src/napi/v8
)

# WASM-specific link options
#import and export memory
target_link_options(hako_reactor PRIVATE
    -Wl,--import-memory,--export-memory
    -mexec-model=reactor
    -Wl,--no-entry
    -Wl,--export=malloc
    -Wl,--export=free
    -Wl,--export=__heap_base
    -Wl,--export=__data_end
    -Wl,--allow-undefined
    -Wl,-z,stack-size=${WASM_STACK_SIZE}
    -Wl,--initial-memory=${WASM_INITIAL_MEMORY}
    -Wl,--max-memory=${WASM_MAX_MEMORY}
    ${WASM_OPT_FLAG}
)

message(STATUS "Configuration summary:")
message(STATUS "  WASI SDK path: ${WASI_SDK_PATH}")
message(STATUS "  PrimJS directory: ${PRIMJS_DIR}")
message(STATUS "  Output WASM: ${WASM_OUTPUT_NAME}")
message(STATUS "  Initial memory: ${WASM_INITIAL_MEMORY} bytes")
message(STATUS "  Maximum memory: ${WASM_MAX_MEMORY} bytes")
message(STATUS "  Stack size: ${WASM_STACK_SIZE} bytes")
message(STATUS "  Bignum support: ${ENABLE_BIGNUM}")
message(STATUS "  LepusNG support: ${ENABLE_LEPUSNG}")
message(STATUS "  Debugger support: ${ENABLE_QUICKJS_DEBUGGER}")

if(DEFINED WASI_VERSION_PARSED)
  message(STATUS "  WASI SDK version: ${WASI_VERSION}")
  if(DEFINED WASI_WASI_LIBC)
    message(STATUS "  WASI-libc version: ${WASI_WASI_LIBC}")
  endif()
  if(DEFINED WASI_LLVM)
    message(STATUS "  LLVM version: ${WASI_LLVM}")
  endif()
  if(DEFINED WASI_LLVM_VERSION)
    message(STATUS "  LLVM detailed version: ${WASI_LLVM_VERSION}")
  endif()
  if(DEFINED WASI_CONFIG)
    message(STATUS "  WASI config: ${WASI_CONFIG}")
  endif()
endif()
