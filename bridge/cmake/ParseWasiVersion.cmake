# ParseWasiVersion.cmake
# Function to parse the WASI SDK VERSION file into CMake variables
#
# This function reads the VERSION file from the WASI SDK directory and parses
# its contents into CMake variables that can be used in the build system
# and in generated source files.

if(__parse_wasi_version)
  return()
endif()
set(__parse_wasi_version INCLUDED)

function(parse_wasi_version WASI_SDK_PATH)
  set(VERSION_FILE "${WASI_SDK_PATH}/VERSION")
  
  # Check if VERSION file exists
  if(NOT EXISTS "${VERSION_FILE}")
    message(WARNING "WASI SDK VERSION file not found at ${VERSION_FILE}")
    # Set default values
    set(WASI_VERSION "unknown" PARENT_SCOPE)
    set(WASI_WASI_LIBC "unknown" PARENT_SCOPE)
    set(WASI_LLVM "unknown" PARENT_SCOPE)
    set(WASI_LLVM_VERSION "unknown" PARENT_SCOPE)
    set(WASI_CONFIG "unknown" PARENT_SCOPE)
    return()
  endif()
  
  # Read the VERSION file content
  file(READ "${VERSION_FILE}" VERSION_CONTENT)
  
  # Extract the WASI SDK version (first line)
  if(VERSION_CONTENT MATCHES "^([^\n]*)")
    set(WASI_VERSION "${CMAKE_MATCH_1}" PARENT_SCOPE)
    message(STATUS "WASI SDK version: ${CMAKE_MATCH_1}")
  else()
    set(WASI_VERSION "unknown" PARENT_SCOPE)
  endif()
  
  # Extract WASI-libc commit hash
  if(VERSION_CONTENT MATCHES "wasi-libc:[ \t]*([^\n]*)")
    set(WASI_WASI_LIBC "${CMAKE_MATCH_1}" PARENT_SCOPE)
    message(STATUS "WASI-libc commit: ${CMAKE_MATCH_1}")
  else()
    set(WASI_WASI_LIBC "unknown" PARENT_SCOPE)
  endif()
  
  # Extract LLVM commit hash
  if(VERSION_CONTENT MATCHES "llvm:[ \t]*([^\n]*)")
    set(WASI_LLVM "${CMAKE_MATCH_1}" PARENT_SCOPE)
    message(STATUS "LLVM commit: ${CMAKE_MATCH_1}")
  else()
    set(WASI_LLVM "unknown" PARENT_SCOPE)
  endif()
  
  # Extract LLVM version
  if(VERSION_CONTENT MATCHES "llvm-version:[ \t]*([^\n]*)")
    set(WASI_LLVM_VERSION "${CMAKE_MATCH_1}" PARENT_SCOPE)
    message(STATUS "LLVM version: ${CMAKE_MATCH_1}")
  else()
    set(WASI_LLVM_VERSION "unknown" PARENT_SCOPE)
  endif()
  
  # Extract configuration hash
  if(VERSION_CONTENT MATCHES "config:[ \t]*([^\n]*)")
    set(WASI_CONFIG "${CMAKE_MATCH_1}" PARENT_SCOPE)
    message(STATUS "Config hash: ${CMAKE_MATCH_1}")
  else()
    set(WASI_CONFIG "unknown" PARENT_SCOPE)
  endif()
endfunction()