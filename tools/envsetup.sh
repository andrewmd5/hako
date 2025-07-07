#!/usr/bin/env bash

# Exit on error, and error if a variable is unset
set -eo pipefail

# Determine script and project directories
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "${SCRIPT_DIR}/.." && pwd )"
TOOL_INSTALL_DIR="${SCRIPT_DIR}/third-party"

# Tool versions
BINARYEN_VERSION="version_123"
WASI_SDK_VERSION="25"
WASI_SDK_VERSION_FULL="${WASI_SDK_VERSION}.0"
WABT_VERSION="1.0.37"
BIOME_VERSION="2.0.6"

# Create tool installation directory if it doesn't exist
mkdir -p "${TOOL_INSTALL_DIR}"

# Detect system architecture and OS
SYS_OS=$OSTYPE
SYS_ARCH=$(uname -m)

# Check if mac or linux
if [[ "$SYS_OS" == "linux"* ]]; then
    SYS_OS="linux"
    # For WABT, we need to map Linux to Ubuntu-20.04 for downloads
    WABT_OS="ubuntu-20.04"
    BIOME_PLATFORM="linux-x64"
elif [[ "$SYS_OS" == "darwin"* ]] || [[ "$SYS_OS" == "msys" ]]; then
    SYS_OS="macos"
    # For WABT, we need to map macOS to macos-14 for downloads
    WABT_OS="macos-14"
    # For Biome, we need to determine if we're on Intel or ARM Mac
    if [[ "$SYS_ARCH" == "arm64" ]]; then
        BIOME_PLATFORM="darwin-arm64"
    else
        BIOME_PLATFORM="darwin-x64"
    fi
else
    echo "Unsupported OS $SYS_OS"
    exit 1
fi

# Check if x86_64 or arm64
if [[ "$SYS_ARCH" != "x86_64" && "$SYS_ARCH" != "arm64" ]]; then
    echo "Unsupported architecture $SYS_ARCH"
    exit 1
fi

# Function to download and extract a tool
download_and_extract() {
    local name=$1
    local url=$2
    local install_dir=$3
    local tarball
    tarball=$(basename "$url")
    local outfile="/tmp/$tarball"
    
    echo "Installing $name to $install_dir..."
    
    if [ ! -f "$outfile" ]; then
        echo "Downloading $name to $outfile..."
        if ! curl --retry 3 -L "$url" -o "$outfile"; then
            echo "Error downloading $name. Exiting."
            exit 1
        fi
    fi
    
    echo "Extracting to $install_dir..."
    mkdir -p "$install_dir"
    if ! tar zxf "$outfile" -C "$TOOL_INSTALL_DIR"; then
        echo "Error extracting $name. Exiting."
        exit 1
    fi
    
    echo "$name installed successfully."
}

# Function to download a binary
download_binary() {
    local name=$1
    local url=$2
    local output_file=$3
    
    echo "Installing $name to $output_file..."
    
    echo "Downloading $name..."
    if ! curl --retry 3 -L "$url" -o "$output_file"; then
        echo "Error downloading $name. Exiting."
        exit 1
    fi
    
    chmod +x "$output_file"
    echo "$name installed successfully."
}

# Download and install Binaryen tools
BINARYEN_INSTALL_DIR="$TOOL_INSTALL_DIR/binaryen-$BINARYEN_VERSION"
BINARYEN_BINARIES="$BINARYEN_INSTALL_DIR/bin/wasm-opt"
if [ ! -f "$BINARYEN_BINARIES" ]; then
    TARBALL="binaryen-$BINARYEN_VERSION-$SYS_ARCH-$SYS_OS.tar.gz"
    INSTALL_URL="https://github.com/WebAssembly/binaryen/releases/download/$BINARYEN_VERSION/$TARBALL"
    download_and_extract "Binaryen $BINARYEN_VERSION" "$INSTALL_URL" "$BINARYEN_INSTALL_DIR"
else
    echo "Binaryen $BINARYEN_VERSION already installed at $BINARYEN_INSTALL_DIR"
fi

# Download and install WASI SDK
WASI_SDK_INSTALL_DIR="$TOOL_INSTALL_DIR/wasi-sdk-$WASI_SDK_VERSION_FULL"
if [ ! -d "$WASI_SDK_INSTALL_DIR" ]; then
    WASI_SDK_TARBALL="wasi-sdk-$WASI_SDK_VERSION_FULL-$SYS_ARCH-$SYS_OS.tar.gz"
    WASI_SDK_INSTALL_URL="https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_SDK_VERSION/$WASI_SDK_TARBALL"
    download_and_extract "WASI SDK $WASI_SDK_VERSION_FULL" "$WASI_SDK_INSTALL_URL" "$TOOL_INSTALL_DIR"
    
    # Rename the architecture-specific directory to a generic name if needed
    EXTRACTED_DIR="$TOOL_INSTALL_DIR/wasi-sdk-$WASI_SDK_VERSION_FULL-$SYS_ARCH-$SYS_OS"
    if [ -d "$EXTRACTED_DIR" ] && [ "$EXTRACTED_DIR" != "$WASI_SDK_INSTALL_DIR" ]; then
        echo "Renaming $EXTRACTED_DIR to $WASI_SDK_INSTALL_DIR..."
        mv "$EXTRACTED_DIR" "$WASI_SDK_INSTALL_DIR"
    fi
else
    echo "WASI SDK $WASI_SDK_VERSION_FULL already installed at $WASI_SDK_INSTALL_DIR"
fi

# Download and install WABT (WebAssembly Binary Toolkit)
WABT_INSTALL_DIR="$TOOL_INSTALL_DIR/wabt-$WABT_VERSION"
WABT_BINARIES="$WABT_INSTALL_DIR/bin/wat2wasm"
if [ ! -f "$WABT_BINARIES" ]; then
    WABT_TARBALL="wabt-$WABT_VERSION-$WABT_OS.tar.gz"
    WABT_INSTALL_URL="https://github.com/WebAssembly/wabt/releases/download/$WABT_VERSION/$WABT_TARBALL"
    download_and_extract "WABT $WABT_VERSION" "$WABT_INSTALL_URL" "$TOOL_INSTALL_DIR"
    
    # WABT extracts to wabt-version-os, we need to normalize it
    EXTRACTED_WABT_DIR="$TOOL_INSTALL_DIR/wabt-$WABT_VERSION"
    if [ ! -d "$EXTRACTED_WABT_DIR" ]; then
        WABT_EXTRACTED_DIR=$(find "$TOOL_INSTALL_DIR" -type d -name "wabt-*" | grep -v "$WABT_INSTALL_DIR" | head -1)
        if [ -n "$WABT_EXTRACTED_DIR" ]; then
            echo "Renaming $WABT_EXTRACTED_DIR to $WABT_INSTALL_DIR..."
            mv "$WABT_EXTRACTED_DIR" "$WABT_INSTALL_DIR"
        fi
    fi
    
    # Make sure bin directory exists (WABT might extract directly to tools rather than having a bin subdirectory)
    if [ ! -d "$WABT_INSTALL_DIR/bin" ] && [ -f "$WABT_INSTALL_DIR/wat2wasm" ]; then
        mkdir -p "$WABT_INSTALL_DIR/bin"
        echo "Creating bin directory and moving executables..."
        for tool in wat2wasm wasm2wat wasm-objdump wasm-interp wasm-decompile wasm2c; do
            if [ -f "$WABT_INSTALL_DIR/$tool" ]; then
                ln -sf "$WABT_INSTALL_DIR/$tool" "$WABT_INSTALL_DIR/bin/$tool"
            fi
        done
    fi
else
    echo "WABT $WABT_VERSION already installed at $WABT_INSTALL_DIR"
fi

# Download and install Biome
BIOME_INSTALL_DIR="$TOOL_INSTALL_DIR/biome-$BIOME_VERSION"
BIOME_BINARY="$BIOME_INSTALL_DIR/bin/biome"
if [ ! -f "$BIOME_BINARY" ]; then
    mkdir -p "$BIOME_INSTALL_DIR/bin"
    BIOME_INSTALL_URL="https://github.com/biomejs/biome/releases/download/cli%2Fv$BIOME_VERSION/biome-$BIOME_PLATFORM"
    download_binary "Biome $BIOME_VERSION" "$BIOME_INSTALL_URL" "$BIOME_BINARY"
else
    echo "Biome $BIOME_VERSION already installed at $BIOME_INSTALL_DIR"
fi

# Export PATH and environment variables
cat > "$TOOL_INSTALL_DIR/env.sh" << EOF
#!/bin/bash
# This file is generated by envsetup.sh
# Source this file to set up environment variables

export WASI_SDK_PATH="$WASI_SDK_INSTALL_DIR"
export PATH="$BINARYEN_INSTALL_DIR/bin:$WASI_SDK_INSTALL_DIR/bin:$WABT_INSTALL_DIR/bin:$BIOME_INSTALL_DIR/bin:\$PATH"

# Print environment information
echo "WebAssembly development environment configured:"
echo "  WASI_SDK_PATH: \$WASI_SDK_PATH"
echo "  Binaryen: $BINARYEN_VERSION"
echo "  WASI SDK: $WASI_SDK_VERSION_FULL"
echo "  WABT: $WABT_VERSION"
echo "  Biome: $BIOME_VERSION"
EOF

chmod +x "$TOOL_INSTALL_DIR/env.sh"

echo ""
echo "Installation complete!"
echo "To use the installed tools, run:"
echo "  source ${TOOL_INSTALL_DIR}/env.sh"