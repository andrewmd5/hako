/**
 * A generic Result type representing either success or failure.
 *
 * This union type follows the "discriminated union" pattern in TypeScript,
 * where the presence of different properties indicates different variants.
 *
 * - Success variant: `{ value: S }`
 * - Failure variant: `{ error: F }`
 *
 * @template S - The type of the success value
 * @template F - The type of the failure/error value
 */
export type SuccessOrFail<S, F> =
  | {
      /** The success value */
      value: S;
      /** Undefined in the success case, helps TypeScript discriminate the union */
      error?: undefined;
    }
  | {
      /** The error value representing the failure */
      error: F;
    };

/**
 * Type guard to check if a SuccessOrFail is the success variant.
 *
 * @template S - The type of the success value
 * @template F - The type of the failure/error value
 * @param successOrFail - The SuccessOrFail instance to check
 * @returns True if this is a success result (has a value property)
 */
export function isSuccess<S, F>(
  successOrFail: SuccessOrFail<S, F>
): successOrFail is { value: S } {
  return "error" in successOrFail === false;
}

/**
 * Type guard to check if a SuccessOrFail is the failure variant.
 *
 * @template S - The type of the success value
 * @template F - The type of the failure/error value
 * @param successOrFail - The SuccessOrFail instance to check
 * @returns True if this is a failure result (has an error property)
 */
export function isFail<S, F>(
  successOrFail: SuccessOrFail<S, F>
): successOrFail is { error: F } {
  return "error" in successOrFail === true;
}

/**
 * Specialization of SuccessOrFail for virtual machine call results.
 *
 * This represents the result of calling a function within the VM,
 * where both success and failure values are VM handles.
 *
 * @template VmHandle - The VM's handle type for JavaScript values
 */
export type VmCallResult<VmHandle> = SuccessOrFail<VmHandle, VmHandle>;

/**
 * Type definition for implementing JavaScript functions in the host environment.
 *
 * A VmFunctionImplementation receives VM handles as arguments and should return
 * a handle, a result object, or be void. It can signal errors either by throwing
 * an exception or by returning a result with an error.
 *
 * Memory management notes:
 * - It should not free its arguments or its return value
 * - It should not retain a reference to its return value or thrown error
 *
 * @template VmHandle - The VM's handle type for JavaScript values
 * @param this - The 'this' value for the function call (a VM handle)
 * @param args - Arguments passed to the function (VM handles)
 * @returns A VM handle for the result, a VmCallResult, or undefined
 */
export type VmFunctionImplementation<VmHandle> = (
  this: VmHandle,
  ...args: VmHandle[]
) => VmHandle | VmCallResult<VmHandle> | undefined;

/**
 * Property descriptor for defining object properties in the VM.
 *
 * Similar to JavaScript's Object.defineProperty descriptor, but adapted
 * for the VM bridge where values are represented as VM handles.
 *
 * Inspired by Figma's plugin system design.
 * @see https://www.figma.com/blog/how-we-built-the-figma-plugin-system/
 *
 * @template VmHandle - The VM's handle type for JavaScript values
 */
export interface VmPropertyDescriptor<VmHandle> {
  /** The property value (a VM handle) */
  value?: VmHandle;

  /** Whether the property can be changed and deleted */
  configurable?: boolean;

  /** Whether the property shows up during enumeration */
  enumerable?: boolean;

  /** Getter function for the property */
  get?: (this: VmHandle) => VmHandle;

  /** Setter function for the property */
  set?: (this: VmHandle, value: VmHandle) => void;
}
