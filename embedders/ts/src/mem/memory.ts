/**
 * memory.ts - Memory management utilities for PrimJS wrapper
 *
 * This module provides a MemoryManager class that handles WebAssembly memory operations
 * for the PrimJS runtime. It includes functions for allocating, reading, writing, and
 * freeing memory in the WebAssembly heap, with special handling for JavaScript values,
 * strings, and arrays of pointers.
 */
import type {
  CString,
  JSContextPointer,
  JSRuntimePointer,
  JSValuePointer,
} from "@hako/etc/types";
import type { HakoExports } from "@hako/etc/ffi";

/**
 * Handles memory operations for the PrimJS WebAssembly module.
 *
 * MemoryManager provides an abstraction layer over the raw WebAssembly memory
 * operations, handling allocation, deallocation, and data transfer between
 * JavaScript and the WebAssembly environment. It includes utilities for working
 * with strings, pointers, arrays, and JavaScript values in WebAssembly memory.
 */
export class MemoryManager {
  private requiresBufferCopy: boolean;
  constructor() {
    // Chrome, Firefox, and Chromium forks don't support using TextDecoder on SharedArrayBuffer.
    // Safari on the other hand does. Concidentally, the aforementioned browsers are the only ones that have the 'doNotTrack' property on 'navigator'.
    // so if we detect that property, we can assume that we are in a browser that doesn't support TextDecoder on SharedArrayBuffer.
    this.requiresBufferCopy =
      navigator !== undefined && "doNotTrack" in navigator;
  }
  /**
   * Reference to the WebAssembly exports object, which contains
   * memory management functions and the memory buffer.
   * @private
   */
  private exports: HakoExports | null = null;

  /**
   * TextEncoder instance for converting JavaScript strings to UTF-8 byte arrays.
   * @private
   */
  private encoder = new TextEncoder();

  /**
   * TextDecoder instance for converting UTF-8 byte arrays to JavaScript strings.
   * @private
   */
  private decoder = new TextDecoder();

  /**
   * Sets the WebAssembly exports object after module instantiation.
   * This must be called before any other MemoryManager methods.
   *
   * @param exports - The PrimJS WebAssembly exports object
   */
  setExports(exports: HakoExports): void {
    this.exports = exports;
  }

  /**
   * Checks if the exports object has been set and returns it.
   *
   * @returns The PrimJS WebAssembly exports object
   * @throws Error if exports are not set
   * @private
   */
  private checkExports(): HakoExports {
    if (!this.exports) {
      throw new Error("Exports not set on MemoryManager");
    }
    return this.exports;
  }

  /**
   * Allocates a block of memory in the WebAssembly heap.
   *
   * @param size - Size of memory block to allocate in bytes
   * @returns Pointer to the allocated memory
   * @throws Error if memory allocation fails
   */
  allocateMemory(ctx: JSContextPointer, size: number): number {
    if (size <= 0) {
      throw new Error("Size must be greater than 0");
    }
    const exports = this.checkExports();
    const ptr = exports.HAKO_Malloc(ctx, size);
    if (ptr === 0) {
      throw new Error(`Failed to allocate ${size} bytes of memory`);
    }
    return ptr;
  }

  allocateRuntimeMemory(rt: JSRuntimePointer, size: number): number {
    if (size <= 0) {
      throw new Error("Size must be greater than 0");
    }
    const exports = this.checkExports();
    const ptr = exports.HAKO_RuntimeMalloc(rt, size);
    if (ptr === 0) {
      throw new Error(`Failed to allocate ${size} bytes of memory`);
    }
    return ptr;
  }

  /**
   * Frees a block of memory in the WebAssembly heap.
   *
   * @param ptr - Pointer to the memory block to free
   */
  freeMemory(ctx: JSContextPointer, ptr: number): void {
    if (ptr !== 0) {
      const exports = this.checkExports();
      exports.HAKO_Free(ctx, ptr);
    }
  }

  freeRuntimeMemory(rt: JSRuntimePointer, ptr: number): void {
    if (ptr !== 0) {
      const exports = this.checkExports();
      exports.HAKO_RuntimeFree(rt, ptr);
    }
  }

  /**
   * Writes a Uint8Array to WebAssembly memory.
   * @param bytes - Uint8Array to write to WebAssembly memory
   * @returns Pointer to the allocated memory
   */
  writeBytes(ctx: JSContextPointer, bytes: Uint8Array): number {
    const exports = this.checkExports();
    const ptr = this.allocateMemory(ctx, bytes.byteLength);

    const memory = new Uint8Array(exports.memory.buffer);
    memory.set(bytes.subarray(0, bytes.byteLength), ptr);
    return ptr;
  }

  /**
   * Creates a null-terminated C string in the WebAssembly heap.
   *
   * Encodes the JavaScript string to UTF-8, allocates memory for it,
   * and copies the bytes to WebAssembly memory with a null terminator.
   *
   * @param str - JavaScript string to convert to a C string
   * @returns Pointer to the C string in WebAssembly memory
   */
  allocateString(ctx: JSContextPointer, str: string): CString {
    const exports = this.checkExports();
    const bytes = this.encoder.encode(str);
    const ptr = this.allocateMemory(ctx, bytes.byteLength + 1);
    const memory = new Uint8Array(exports.memory.buffer);
    memory.set(bytes, ptr);
    memory[ptr + bytes.length] = 0; // Null terminator
    return ptr;
  }

  copy(offset: number, length: number): Uint8Array {
    const exports = this.checkExports();
    const memory = new Uint8Array(exports.memory.buffer);
    return memory.slice(offset, offset + length);
  }

  slice(offset: number, length: number): Uint8Array {
    const exports = this.checkExports();
    const memory = new Uint8Array(exports.memory.buffer);
    return memory.subarray(offset, offset + length);
  }

  writeNullTerminatedString(ctx: JSContextPointer, str: string): { pointer: CString; length: number } {
    const exports = this.checkExports();
    const bytes = this.encoder.encode(str);
    const ptr = this.allocateMemory(ctx, bytes.byteLength + 1);
    const memory = new Uint8Array(exports.memory.buffer);
    memory.set(bytes, ptr);
    memory[ptr + bytes.length] = 0; // Null terminator
    return { pointer: ptr, length: bytes.length + 1 };

  }


  /**
   * Reads a null-terminated C string from the WebAssembly heap.
   *
   * @param ptr - Pointer to the C string
   * @returns JavaScript string
   */
  readString(ptr: CString): string {
    if (ptr === 0) return "";
    const exports = this.checkExports();
    const memory = new Uint8Array(exports.memory.buffer);

    let end = ptr;
    while (memory[end] !== 0) end++;

    return this.decoder.decode(memory.subarray(ptr, end));
  }

  /**
   * Frees a C string created by PrimJS.
   *
   * This uses the PrimJS-specific function to free strings that were
   * allocated by the PrimJS engine, rather than by us.
   *
   * @param ctx - PrimJS context pointer
   * @param ptr - Pointer to the C string
   */
  freeCString(ctx: JSContextPointer, ptr: CString): void {
    if (ptr !== 0) {
      const exports = this.checkExports();
      exports.HAKO_FreeCString(ctx, ptr);
    }
  }

  /**
   * Frees a JavaScript value pointer in a specific context.
   *
   * @param ctx - PrimJS context pointer
   * @param ptr - Pointer to the JavaScript value
   */
  freeValuePointer(ctx: JSContextPointer, ptr: JSValuePointer): void {
    if (ptr !== 0) {
      const exports = this.checkExports();
      exports.HAKO_FreeValuePointer(ctx, ptr);
    }
  }

  /**
   * Frees a JavaScript value pointer using the runtime instead of a context.
   *
   * This is useful for freeing values when a context is not available,
   * but should be used carefully as it bypasses some safety checks.
   *
   * @param rt - PrimJS runtime pointer
   * @param ptr - Pointer to the JavaScript value
   */
  freeValuePointerRuntime(rt: JSRuntimePointer, ptr: JSValuePointer): void {
    if (ptr !== 0) {
      const exports = this.checkExports();
      exports.HAKO_FreeValuePointerRuntime(rt, ptr);
    }
  }


  /**
   * Duplicates a JavaScript value pointer.
   *
   * This creates a new reference to the same JavaScript value,
   * incrementing its reference count in the PrimJS engine.
   *
   * @param ctx - PrimJS context pointer
   * @param ptr - Pointer to the JavaScript value
   * @returns Pointer to the duplicated JavaScript value
   */
  dupValuePointer(ctx: JSContextPointer, ptr: JSValuePointer): JSValuePointer {
    const exports = this.checkExports();
    return exports.HAKO_DupValuePointer(ctx, ptr);
  }

  /**
   * Creates a new ArrayBuffer JavaScript value.
   *
   * Allocates memory for the provided data and creates an ArrayBuffer
   * that references this memory in the WebAssembly environment.
   *
   * @param ctx - PrimJS context pointer
   * @param data - The data to store in the ArrayBuffer
   * @returns Pointer to the new JavaScript ArrayBuffer value
   */
  newArrayBuffer(ctx: JSContextPointer, data: Uint8Array): JSValuePointer {
    const exports = this.checkExports();

    if (data.byteLength === 0) {
      return exports.HAKO_NewArrayBuffer(ctx, 0, 0);
    }

    const bufPtr = this.allocateMemory(ctx, data.byteLength);
    const memory = new Uint8Array(exports.memory.buffer);
    memory.set(data, bufPtr);
    return exports.HAKO_NewArrayBuffer(ctx, bufPtr, data.byteLength);
  }


  /**
   * Allocates memory for an array of pointers.
   *
   * @param count - Number of pointers to allocate space for
   * @returns Pointer to the array in WebAssembly memory
   */
  allocatePointerArray(ctx: JSContextPointer, count: number): number {
    return this.allocateMemory(ctx, count * 4); // 4 bytes per pointer
  }

  allocateRuntimePointerArray(rt: JSRuntimePointer, count: number): number {
    return this.allocateRuntimeMemory(rt, count * 4); // 4 bytes per pointer
  }

  /**
   * Writes a pointer value to an array of pointers.
   *
   * @param arrayPtr - Pointer to the array
   * @param index - Index in the array to write to
   * @param value - Pointer value to write
   * @returns The memory address that was written to
   */
  writePointerToArray(arrayPtr: number, index: number, value: number): number {
    const exports = this.checkExports();
    const view = new DataView(exports.memory.buffer);
    const ptr = arrayPtr + index * 4;
    view.setUint32(ptr, value, true); // Little endian
    // return the ptr we just wrote to
    return ptr;
  }

  /**
   * Reads a pointer value from an array of pointers.
   *
   * @param arrayPtr - Pointer to the array
   * @param index - Index in the array to read from
   * @returns The pointer value at the specified index
   */
  readPointerFromArray(arrayPtr: number, index: number): number {
    const exports = this.checkExports();
    const view = new DataView(exports.memory.buffer);
    return view.getUint32(arrayPtr + index * 4, true); // Little endian
  }

  /**
   * Reads a pointer value from a specific memory address.
   *
   * @param address - Memory address to read from
   * @returns The pointer value at the specified address
   */
  readPointer(address: number): number {
    const exports = this.checkExports();
    const view = new DataView(exports.memory.buffer);
    return view.getUint32(address, true); // Little endian
  }

  /**
   * Reads a 32-bit unsigned integer from a specific memory address.
   *
   * @param address - Memory address to read from
   * @returns The uint32 value at the specified address
   */
  readUint32(address: number): number {
    const exports = this.checkExports();
    const view = new DataView(exports.memory.buffer);
    return view.getUint32(address, true); // Little endian
  }

  /**
   * Writes a 32-bit unsigned integer to a specific memory address.
   *
   * @param address - Memory address to write to
   * @param value - Uint32 value to write
   */
  writeUint32(address: number, value: number): void {
    const exports = this.checkExports();
    const view = new DataView(exports.memory.buffer);
    view.setUint32(address, value, true); // Little endian
  }
}
