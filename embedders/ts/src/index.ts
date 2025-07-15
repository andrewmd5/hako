import { useClock, useRandom, useStdio, WASI } from "uwasi";
import { HakoError } from "./etc/errors";
import type { HakoExports } from "./etc/ffi";
import type { Base64, InterruptHandler } from "./etc/types";
import { CallbackManager } from "./host/callback";
import { Container } from "./host/container";
import { HakoRuntime } from "./host/runtime";
import { MemoryManager } from "./mem/memory";

/**
 * Default initial memory size for the WebAssembly instance (24MB)
 */
const defaultInitialMemory = 25165824; // 24MB

/**
 * Default maximum memory size for the WebAssembly instance (256MB)
 */
const defaultMaximumMemory = 268435456; // 256MB

/**
 * Generic fetch-like function type
 *
 * @template TOptions - Type for fetch options
 * @template TResponse - Type for fetch response
 * @param url - URL to fetch
 * @param options - Optional fetch options
 * @returns Response or promise of response
 */
type FetchLike<TOptions, TResponse> = (
  url: string,
  options?: TOptions
) => TResponse | PromiseLike<TResponse>;

/**
 * Standard I/O interface for redirecting stdout and stderr
 */
type StandardIO = {
  /**
   * Function to handle stdout output
   * @param lines - Output content as string or Uint8Array
   */
  stdout: (lines: string | Uint8Array) => void;
  /**
   * Function to handle stderr output
   * @param lines - Error content as string or Uint8Array
   */
  stderr: (lines: string | Uint8Array) => void;
};

/**
 * Configuration options for initializing a Hako runtime
 *
 * @template TOptions - Type for fetch options
 * @template TResponse - Type for fetch response
 */
export interface HakoOptions<TOptions, TResponse> {
  wasm?: {
    /** Command line arguments to pass to the WASI environment */
    args?: string[];
    /** Environment variables to set in the WASI environment */
    env?: Record<string, string>;
    /** File system paths to pre-open in the WASI environment */
    preopens?: Record<string, string>;
    /** Standard I/O configuration for redirecting stdout and stderr */
    io?: StandardIO;
    /** Memory configuration for the WebAssembly instance */
    memory?: {
      /** Initial memory size in bytes */
      initial?: number;
      /** Maximum memory size in bytes */
      maximum?: number;
      /** Bring Your Own Memory - use an existing WebAssembly memory instance */
      byom?: WebAssembly.Memory;
    };
  };
  runtime?: {
    /** Memory limit for the runtime */
    memoryLimit?: number;
    /** Handler for interrupting execution */
    interruptHandler?: InterruptHandler;
  };
  loader: {
    /** WebAssembly binary as a buffer source */
    binary?: BufferSource;
    /** Fetch function for loading the WebAssembly module */
    fetch?: FetchLike<TOptions, TResponse>;
    /** Source URL for fetching the WebAssembly module */
    src?: string;
  };
}

/**
 * Initializes Hako and creates a runtime with the provided options
 *
 * @template TOptions - Type for fetch options
 * @template TResponse - Type for fetch response
 * @param options - Configuration options for initializing the runtime
 * @returns A promise that resolves to a Hako runtime instance
 * @throws {HakoError} If no WebAssembly binary is provided or if runtime creation fails
 */
export async function createHakoRuntime<TOptions, TResponse>(
  options: HakoOptions<TOptions, TResponse>
): Promise<HakoRuntime> {
  // Get memory configuration or use defaults
  const memConfig = options.wasm?.memory || {};
  const initialMemory = memConfig.initial || defaultInitialMemory;
  const maximumMemory = memConfig.maximum || defaultMaximumMemory;

  // Use BYOM (Bring Your Own Memory) or create a new one
  let wasmMemory: WebAssembly.Memory;
  if (memConfig.byom) {
    wasmMemory = memConfig.byom;
    if (wasmMemory.buffer instanceof SharedArrayBuffer) {
      throw new HakoError(
        "Hako memory cannot be a SharedArrayBuffer. Use a regular ArrayBuffer instead."
      );
    }
  } else {
    // Convert bytes to pages (64KB per page)
    const initialPages = Math.ceil(initialMemory / 65536);
    const maximumPages = Math.ceil(maximumMemory / 65536);
    wasmMemory = new WebAssembly.Memory({
      initial: initialPages,
      maximum: maximumPages,
      shared: false,
    });
  }

  // Create memory manager with the WebAssembly memory
  const memory = new MemoryManager();

  // Create the callback manager with the memory manager
  const callbacks = new CallbackManager(memory);

  // Create WASI instance
  const wasi = new WASI({
    features: [
      useStdio({
        stdout: options.wasm?.io?.stdout || ((lines) => console.log(lines)),
        stderr: options.wasm?.io?.stderr || ((lines) => console.error(lines)),
      }),
      useClock,
      useRandom({
        randomFillSync: (buffer: Uint8Array) => {
          return crypto.getRandomValues(buffer);
        }
      }),
    ],
    args: options.wasm?.args || [],
    env: options.wasm?.env || {},
    preopens: options.wasm?.preopens || {},
  });

  // Create import object with WASI imports, callback imports, and memory
  const imports = {
    wasi_snapshot_preview1: wasi.wasiImport,
    env: {
      memory: wasmMemory,
    },
    ...callbacks.getImports(),
  };

  // Get WebAssembly binary
  let instance: WebAssembly.Instance;
  if (options.loader.binary) {
    // If binary is provided directly, use regular instantiate
    const result = await WebAssembly.instantiate(
      options.loader.binary,
      imports
    );
    //@ts-expect-error
    instance = result.instance;
  } else if (options.loader.fetch && options.loader.src) {
    const result = await WebAssembly.instantiateStreaming(
      options.loader.fetch(options.loader.src) as
        | Response
        | PromiseLike<Response>,
      imports
    );
    instance = result.instance;
  } else {
    throw new HakoError("No WebAssembly binary provided");
  }

  // Initialize WASI
  wasi.initialize(instance);

  // Get the exports
  const exports = instance.exports as unknown as HakoExports;

  // Create the service container with all dependencies
  const container = new Container(exports, memory, callbacks);

  // Create and return the runtime directly
  const rtPtr = container.exports.HAKO_NewRuntime();
  if (rtPtr === 0) {
    throw new HakoError("Failed to create runtime");
  }

  const runtime = new HakoRuntime(container, rtPtr);

  if (options.runtime?.interruptHandler) {
    runtime.enableInterruptHandler(options.runtime.interruptHandler);
  }

  if (options.runtime?.memoryLimit) {
    runtime.setMemoryLimit(options.runtime.memoryLimit);
  }

  return runtime;
}

/**
 * Decodes a Base64-encoded WebAssembly module and validates its header
 *
 * @param encoded - Base64-encoded WebAssembly module
 * @returns Decoded WebAssembly module as Uint8Array
 * @throws {HakoError} If the buffer is too small or if the WebAssembly module is invalid or has an unsupported version
 */
export const decodeVariant = (encoded: Base64): Uint8Array => {
  let module: Uint8Array;
  //@ts-ignore
  if (typeof Uint8Array.fromBase64 === "function") {
    // fast path
    //@ts-ignore
    module = Uint8Array.fromBase64(encoded, {
      lastChunkHandling: "strict",
    });
  } else {
    const decoded = atob(encoded);
    module = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      module[i] = decoded.charCodeAt(i);
    }
  }
  if (module.length < 8) {
    throw new HakoError("Buffer too small to be a valid WebAssembly module");
  }
  const isMagicValid =
    module[0] === 0x00 &&
    module[1] === 0x61 &&
    module[2] === 0x73 &&
    module[3] === 0x6d;
  if (!isMagicValid) {
    throw new HakoError("Invalid WebAssembly module");
  }
  const isVersionValid =
    module[4] === 0x01 &&
    module[5] === 0x00 &&
    module[6] === 0x00 &&
    module[7] === 0x00;
  if (!isVersionValid) {
    throw new HakoError(
      `Unsupported WebAssembly version: ${module[4]}.${module[5]}.${module[6]}.${module[7]}`
    );
  }
  return module;
};

// Re-export production and debug modules
export { default as HAKO_PROD } from "./variants/hako.g";
export { default as HAKO_DEBUG } from "./variants/hako-debug.g";
