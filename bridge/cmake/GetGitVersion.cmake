# GetGitVersion.cmake
# Returns a version string from Git tags
#
# This function inspects the git tags for the project and returns a string
# into a CMake variable
#
# get_git_version(<var>)
#
# - Example
#
# include(GetGitVersion)
# get_git_version(GIT_VERSION)

find_package(Git)
if(__get_git_version)
  return()
endif()
set(__get_git_version INCLUDED)
function(get_git_version var)
  if(GIT_EXECUTABLE)
    # First try the exact tag - this works better in CI environments
    execute_process(
      COMMAND ${GIT_EXECUTABLE} describe --exact-match --tags
      WORKING_DIRECTORY ${PROJECT_SOURCE_DIR}
      RESULT_VARIABLE status_exact
      OUTPUT_VARIABLE GIT_VERSION_EXACT
      ERROR_VARIABLE error_exact
      OUTPUT_STRIP_TRAILING_WHITESPACE
    )
    
    if(NOT ${status_exact})
      # We found an exact tag match
      set(GIT_VERSION ${GIT_VERSION_EXACT})
      message(STATUS "Git exact tag match: ${GIT_VERSION}")
    else()
      # Try with the pattern matching approach
      execute_process(
        COMMAND ${GIT_EXECUTABLE} describe --match "v[0-9]*.[0-9]*.[0-9]*" --abbrev=8
        WORKING_DIRECTORY ${PROJECT_SOURCE_DIR}
        RESULT_VARIABLE status
        OUTPUT_VARIABLE GIT_VERSION
        ERROR_VARIABLE error_output
        OUTPUT_STRIP_TRAILING_WHITESPACE
      )
      
      if(${status})
        message(STATUS "Git version detection failed with: ${error_output}")
        # Fallback to tag listing to see what's available
        execute_process(
          COMMAND ${GIT_EXECUTABLE} tag -l
          WORKING_DIRECTORY ${PROJECT_SOURCE_DIR}
          OUTPUT_VARIABLE available_tags
          ERROR_QUIET
          OUTPUT_STRIP_TRAILING_WHITESPACE
        )
        message(STATUS "Available tags: ${available_tags}")
        set(GIT_VERSION "0.0.0")
      else()
        string(REGEX REPLACE "-[0-9]+-g" "-" GIT_VERSION ${GIT_VERSION})
      endif()
    endif()
  else()
    set(GIT_VERSION "0.0.0")
  endif()
  
  if(GIT_VERSION MATCHES "^v")
    string(SUBSTRING ${GIT_VERSION} 1 -1 GIT_VERSION)
  endif()
  
  message(STATUS "Git Version: ${GIT_VERSION}")
  set(${var} ${GIT_VERSION} PARENT_SCOPE)
endfunction()