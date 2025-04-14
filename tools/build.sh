#!/bin/bash
# Script to build the Hako WASM module with all CMake options
# Ensure we exit on error
set -eo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
if [[ ! -d "$SCRIPT_DIR" ]]; then
  echo "Error: Unable to determine script directory."
  exit 1
fi

ENV_FILE="${SCRIPT_DIR}/third-party/env.sh"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: Environment file not found at ${ENV_FILE}"
  exit 1
fi
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/third-party/env.sh"
PROJECT_ROOT="$( cd "${SCRIPT_DIR}/.." && pwd )"
export PRIMJS_DIR="${PROJECT_ROOT}/primjs"


# Default configuration
WASM_INITIAL_MEMORY=25165824  # 24MB
WASM_STACK_SIZE=8388608       # 8MB
WASM_MAX_MEMORY=268435456     # 256MB
WASM_OUTPUT_NAME="hako.wasm"
BUILD_DIR="${PROJECT_ROOT}/bridge/build"
BUILD_TYPE="Release"
CLEAN_BUILD=false

# Feature flags (matching CMakeLists.txt options)
ENABLE_QUICKJS_DEBUGGER=OFF
ENABLE_HAKO_PROFILER=OFF
ENABLE_LEPUSNG=ON
ENABLE_PRIMJS_SNAPSHOT=OFF
ENABLE_COMPATIBLE_MM=OFF
DISABLE_NANBOX=OFF
ENABLE_CODECACHE=OFF
CACHE_PROFILE=OFF
ENABLE_MEM=OFF
ENABLE_ATOMICS=ON
FORCE_GC=OFF
ENABLE_ASAN=OFF
ENABLE_BIGNUM=OFF

function show_help {
    echo "Usage: $0 [options]"
    echo "Options:"
    echo "  --memory=BYTES         Set initial memory size (default: 25165824)"
    echo "  --max-memory=BYTES     Set maximum memory size (default: 268435456)"
    echo "  --stack=BYTES          Set stack size (default: 8388608)"
    echo "  --output=NAME          Set output file name (default: hako.wasm)"
    echo "  --build-dir=DIR        Set build directory (default: [project_root]/bridge/build)"
    echo "  --build-type=TYPE      Set build type (Debug|Release|RelWithDebInfo|MinSizeRel)"
    echo "  --clean                Clean build directory before building"
    echo ""
    echo "Feature flags (ON/OFF):"
    echo "  --debugger=ON|OFF      Enable QuickJS debugger (default: OFF)"
    echo "  --hako-profiler=ON|OFF   Enable Hako profiler (default: OFF)"
    echo "  --lepusng=ON|OFF       Enable LepusNG (default: ON)"
    echo "  --snapshot=ON|OFF      Enable PrimJS snapshot (default: OFF)"
    echo "  --compat-mm=ON|OFF     Enable compatible memory (default: OFF)"
    echo "  --disable-nanbox=ON|OFF Disable nanbox (default: OFF)"
    echo "  --codecache=ON|OFF     Enable code cache (default: OFF)"
    echo "  --cache-profile=ON|OFF Enable cache profile (default: OFF)"
    echo "  --mem=ON|OFF           Enable memory detection (default: OFF)"
    echo "  --atomics=ON|OFF       Enable Atomics (default: OFF)"
    echo "  --force-gc=ON|OFF      Enable force GC (default: OFF)"
    echo "  --asan=ON|OFF          Enable address sanitizer (default: OFF)"
    echo "  --bignum=ON|OFF        Enable bignum support (default: OFF)"
    echo ""
    echo "  --help, -h             Show this help message"
    exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --memory=*)
            WASM_INITIAL_MEMORY="${1#*=}"
            shift
            ;;
        --max-memory=*)           # Add this case
            WASM_MAX_MEMORY="${1#*=}"
            shift
            ;;
        --stack=*)
            WASM_STACK_SIZE="${1#*=}"
            shift
            ;;
        --output=*)
            WASM_OUTPUT_NAME="${1#*=}"
            shift
            ;;
        --build-dir=*)
            BUILD_DIR="${1#*=}"
            shift
            ;;
        --build-type=*)
            BUILD_TYPE="${1#*=}"
            shift
            ;;
        --clean)
            CLEAN_BUILD=true
            shift
            ;;
        # Feature flags
        --debugger=*)
            ENABLE_QUICKJS_DEBUGGER="${1#*=}"
            shift
            ;;
        --hako-profiler=*)
            ENABLE_HAKO_PROFILER="${1#*=}"
            shift
            ;;
        --lepusng=*)
            ENABLE_LEPUSNG="${1#*=}"
            shift
            ;;
        --snapshot=*)
            ENABLE_PRIMJS_SNAPSHOT="${1#*=}"
            shift
            ;;
        --compat-mm=*)
            ENABLE_COMPATIBLE_MM="${1#*=}"
            shift
            ;;
        --disable-nanbox=*)
            DISABLE_NANBOX="${1#*=}"
            shift
            ;;
        --codecache=*)
            ENABLE_CODECACHE="${1#*=}"
            shift
            ;;
        --cache-profile=*)
            CACHE_PROFILE="${1#*=}"
            shift
            ;;
        --mem=*)
            ENABLE_MEM="${1#*=}"
            shift
            ;;
        --atomics=*)
            ENABLE_ATOMICS="${1#*=}"
            shift
            ;;
        --force-gc=*)
            FORCE_GC="${1#*=}"
            shift
            ;;
        --asan=*)
            ENABLE_ASAN="${1#*=}"
            shift
            ;;
        --bignum=*)
            ENABLE_BIGNUM="${1#*=}"
            shift
            ;;
        --help|-h)
            show_help
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help to see available options"
            exit 1
            ;;
    esac
done

# Check if wasm-opt is available when building in Release mode
if [[ "$BUILD_TYPE" == "Release" ]]; then
    if ! command -v wasm-opt &> /dev/null; then
        echo "⚠️  WARNING: Building in Release mode but 'wasm-opt' was not found in PATH"
        echo "   Release builds normally use wasm-opt for optimization."
        echo "   Install Binaryen to get wasm-opt: https://github.com/WebAssembly/binaryen"
        echo "   Your build will continue but may not have optimal size/performance."
        echo ""
    fi
fi

# Check if LepusNG and BigNum are both enabled (which is not allowed)
if [ "$ENABLE_LEPUSNG" = "ON" ] && [ "$ENABLE_BIGNUM" = "ON" ]; then
    echo "Error: ENABLE_LEPUSNG and ENABLE_BIGNUM cannot be both enabled."
    exit 1
fi

# Check if WASI_SDK_PATH is set
if [ -z "${WASI_SDK_PATH}" ]; then
    echo "Error: WASI_SDK_PATH environment variable is not set"
    echo "Please set it to your WASI SDK installation path"
    exit 1
fi

# Check if PRIMJS_DIR exists
if [ ! -d "${PRIMJS_DIR}" ]; then
    echo "Error: PrimJS directory not found at ${PRIMJS_DIR}"
    echo "Please ensure the directory exists or set the correct path"
    exit 1
fi

echo "Building hako with the following configuration:"
echo " WASI_SDK_PATH: ${WASI_SDK_PATH}"
echo " PRIMJS_DIR: ${PRIMJS_DIR}"
echo " Build type: ${BUILD_TYPE}"
echo " Initial memory: ${WASM_INITIAL_MEMORY} bytes"
echo " Maximum memory: ${WASM_MAX_MEMORY} bytes"
echo " Stack size: ${WASM_STACK_SIZE} bytes"
echo " Output file: ${WASM_OUTPUT_NAME}"
echo " Build directory: ${BUILD_DIR}"
echo ""
echo "Feature flags:"
echo " QuickJS debugger: ${ENABLE_QUICKJS_DEBUGGER}"
echo " Hako profiler: ${ENABLE_HAKO_PROFILER}"
echo " LepusNG: ${ENABLE_LEPUSNG}"
echo " PrimJS snapshot: ${ENABLE_PRIMJS_SNAPSHOT}"
echo " Compatible memory: ${ENABLE_COMPATIBLE_MM}"
echo " Disable nanbox: ${DISABLE_NANBOX}"
echo " Code cache: ${ENABLE_CODECACHE}"
echo " Cache profile: ${CACHE_PROFILE}"
echo " Memory detection: ${ENABLE_MEM}"
echo " Atomics: ${ENABLE_ATOMICS}"
echo " Force GC: ${FORCE_GC}"
echo " Address sanitizer: ${ENABLE_ASAN}"
echo " BigNum support: ${ENABLE_BIGNUM}"

# Create and clean build directory if needed
if [ "$CLEAN_BUILD" = true ] && [ -d "$BUILD_DIR" ]; then
    echo "Cleaning build directory: ${BUILD_DIR}"
    rm -rf "${BUILD_DIR}"
fi
mkdir -p "${BUILD_DIR}"
cd "${BUILD_DIR}"

# Run CMake with all options
echo "Running CMake..."
cmake "${PROJECT_ROOT}/bridge" \
    -DCMAKE_BUILD_TYPE="${BUILD_TYPE}" \
    -DWASM_INITIAL_MEMORY="${WASM_INITIAL_MEMORY}" \
    -DWASM_MAX_MEMORY="${WASM_MAX_MEMORY}" \
    -DWASM_STACK_SIZE="${WASM_STACK_SIZE}" \
    -DWASM_OUTPUT_NAME="${WASM_OUTPUT_NAME}" \
    -DENABLE_QUICKJS_DEBUGGER="${ENABLE_QUICKJS_DEBUGGER}" \
    -DENABLE_LEPUSNG="${ENABLE_LEPUSNG}" \
    -DENABLE_PRIMJS_SNAPSHOT="${ENABLE_PRIMJS_SNAPSHOT}" \
    -DENABLE_COMPATIBLE_MM="${ENABLE_COMPATIBLE_MM}" \
    -DDISABLE_NANBOX="${DISABLE_NANBOX}" \
    -DENABLE_CODECACHE="${ENABLE_CODECACHE}" \
    -DCACHE_PROFILE="${CACHE_PROFILE}" \
    -DENABLE_MEM="${ENABLE_MEM}" \
    -DENABLE_ATOMICS="${ENABLE_ATOMICS}" \
    -DFORCE_GC="${FORCE_GC}" \
    -DENABLE_ASAN="${ENABLE_ASAN}" \
    -DENABLE_BIGNUM="${ENABLE_BIGNUM}" \
    -DENABLE_HAKO_PROFILER="${ENABLE_HAKO_PROFILER}" \

# Build
echo "Building..."
# Detect number of CPU cores for parallel build
if command -v nproc >/dev/null 2>&1; then
    # Linux
    CORES=$(nproc)
elif command -v sysctl >/dev/null 2>&1; then
    # macOS
    CORES=$(sysctl -n hw.ncpu)
else
    # Default
    CORES=4
fi

cmake --build "${BUILD_DIR}" -j"${CORES}"

# Check if build was successful
if [ ! -f "${BUILD_DIR}/${WASM_OUTPUT_NAME}" ]; then
    echo "Error: Build failed - output file not found"
    exit 1
fi

if [[ "$BUILD_TYPE" == "Release" && -x "$(command -v wasm-strip)" ]]; then
   wasm-strip "${BUILD_DIR}/${WASM_OUTPUT_NAME}"
fi

echo "Build successful: ${BUILD_DIR}/${WASM_OUTPUT_NAME}"
echo "File size: $(du -h "${BUILD_DIR}/${WASM_OUTPUT_NAME}" | cut -f1)"


exit 0