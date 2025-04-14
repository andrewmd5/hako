#!/bin/bash
# Script to apply all patches to primjs

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

# Define paths relative to the script location
# Assuming the script is in the tools directory
PATCHES_DIR="${SCRIPT_DIR}/../patches"
PRIMJS_DIR="${SCRIPT_DIR}/../primjs"

# Check if directories exist
if [ ! -d "$PATCHES_DIR" ]; then
  echo "Error: Patches directory not found at ${PATCHES_DIR}"
  exit 1
fi

if [ ! -d "$PRIMJS_DIR" ]; then
  echo "Error: PrimJS directory not found at ${PRIMJS_DIR}"
  exit 1
fi

# Count the number of patches
PATCH_COUNT=$(find "$PATCHES_DIR" -name "*.patch" -o -name "*.diff" | wc -l)
if [ "$PATCH_COUNT" -eq 0 ]; then
  echo "No patches found in ${PATCHES_DIR}"
  exit 0
fi

echo "Found ${PATCH_COUNT} patches to apply"

# Apply each patch
for PATCH_FILE in "$PATCHES_DIR"/*.{patch,diff}; do
  # Skip if no files match the pattern
  [ -e "$PATCH_FILE" ] || continue
  
  PATCH_NAME=$(basename "$PATCH_FILE")
  echo "Applying patch: ${PATCH_NAME}"
  
  # Try to apply the patch with -p1 to handle forkSrcPrefix
  if patch -p1 -d "$PRIMJS_DIR" -i "$PATCH_FILE" --forward --dry-run > /dev/null 2>&1; then
    # Patch can be applied cleanly
    patch --no-backup-if-mismatch -p1 -d "$PRIMJS_DIR" -i "$PATCH_FILE" --forward
    echo "  ✓ Successfully applied patch: ${PATCH_NAME}"
  elif patch -p1 -d "$PRIMJS_DIR" -i "$PATCH_FILE" --reverse --dry-run > /dev/null 2>&1; then
    # Patch is already applied
    echo "  ✓ Patch already applied: ${PATCH_NAME} (skipping)"
  else
    # Patch cannot be applied
    echo "  ✗ Failed to apply patch: ${PATCH_NAME}"
    echo "    The patch may not apply cleanly to this version of primjs."
    echo "    You may need to manually resolve conflicts."
    
    # Ask whether to continue or abort
    read -p "Continue with remaining patches? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborting patch application."
      exit 1
    fi
  fi
done

echo "All patches processed!"