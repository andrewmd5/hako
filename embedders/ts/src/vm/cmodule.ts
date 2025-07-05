import type { HostCallbackFunction } from "@hako/etc/types";
import type { VMContext } from "@hako/vm/context";
import { VMValue } from "@hako/vm/value";
import { Scope } from "@hako/mem/lifetime";
import type { HakoRuntime } from "@hako/runtime/runtime";

/**
 * Builder for creating C modules. Used in the main context.
 */
export class CModuleBuilder {
    private vmContext: VMContext;
    private modulePtr: number;
    private exports: string[] = [];

    constructor(context: VMContext, name: string) {
        this.vmContext = context;

        this.modulePtr = Scope.withScope((scope) => {
            const memory = context.container.memory;
            const hakoExports = context.container.exports;

            const moduleName = memory.allocateString(context.pointer, name);
            scope.add(() => memory.freeMemory(context.pointer, moduleName));

            const modulePtr = hakoExports.HAKO_NewCModule(context.pointer, moduleName);

            if (modulePtr === 0) {
                throw new Error(`Failed to create C module: ${name}`);
            }

            return modulePtr;
        });
    }

    /**
     * Gets the VM context this module belongs to.
     */
    get context(): VMContext {
        return this.vmContext;
    }

    /**
     * Gets the runtime of the VM context.
     */
    get runtime(): HakoRuntime {
        return this.vmContext.runtime;
    }

    /**
     * Gets the module pointer (internal use).
     * @internal
     */
    get pointer(): number {
        return this.modulePtr;
    }

    /**
     * Gets the list of declared exports.
     */
    get exportNames(): readonly string[] {
        return [...this.exports];
    }

    /**
     * Gets the module name.
     */
    get name(): string {
        return Scope.withScope((scope) => {
            const exports = this.vmContext.container.exports;
            const namePtr = exports.HAKO_GetModuleName(this.vmContext.pointer, this.modulePtr);

            if (namePtr === 0) {
                return "<unknown>";
            }

            scope.add(() => this.vmContext.container.memory.freeCString(this.vmContext.pointer, namePtr));

            return this.vmContext.container.memory.readString(namePtr);
        });
    }

    /**
     * Adds an export to this C module.
     *
     * @param exportName - Name of the export
     * @returns This builder for chaining
     */
    addExport(exportName: string): this {
        Scope.withScope((scope) => {
            const memory = this.vmContext.container.memory;
            const exports = this.vmContext.container.exports;

            const exportNamePtr = memory.allocateString(this.vmContext.pointer, exportName);
            scope.add(() => memory.freeMemory(this.vmContext.pointer, exportNamePtr));

            const result = exports.HAKO_AddModuleExport(this.vmContext.pointer, this.modulePtr, exportNamePtr);

            if (result !== 0) {
                throw new Error(`Failed to add export: ${exportName}`);
            }

            this.exports.push(exportName);
        });

        return this;
    }

    /**
     * Adds multiple exports to this C module.
     *
     * @param exportNames - Array of export names
     * @returns This builder for chaining
     */
    addExports(exportNames: string[]): this {
        for (const exportName of exportNames) {
            this.addExport(exportName);
        }
        return this;
    }
}

/**
 * Initializer for C modules. Used in the init handler context.
 */
export class CModuleInitializer {
    private vmContext: VMContext;
    private modulePtr: number;

    constructor(context: VMContext, modulePtr: number) {
        this.vmContext = context;
        this.modulePtr = modulePtr;
    }

    /**
     * Gets the VM context this module belongs to.
     */
    get context(): VMContext {
        return this.vmContext;
    }

    /**
     * Gets the runtime of the VM context.
     */
    get runtime(): HakoRuntime {
        return this.vmContext.runtime;
    }

    /**
     * Gets the module pointer (internal use).
     * @internal
     */
    get pointer(): number {
        return this.modulePtr;
    }

    /**
     * Gets the module name.
     */
    get name(): string {
        return Scope.withScope((scope) => {
            const exports = this.vmContext.container.exports;
            const namePtr = exports.HAKO_GetModuleName(this.vmContext.pointer, this.modulePtr);

            if (namePtr === 0) {
                return "<unknown>";
            }

            scope.add(() => this.vmContext.container.memory.freeCString(this.vmContext.pointer, namePtr));

            return this.vmContext.container.memory.readString(namePtr);
        });
    }

    /**
     * Sets a single export value.
     *
     * @param exportName - Name of the export
     * @param value - Value to set (any JavaScript value or VMValue)
     */
    setExport(exportName: string, value: unknown): void {
        if (value instanceof VMValue) {
            Scope.withScope((scope) => {
                const memory = this.vmContext.container.memory;
                const exports = this.vmContext.container.exports;

                const exportNamePtr = memory.allocateString(this.vmContext.pointer, exportName);
                scope.add(() => memory.freeMemory(this.vmContext.pointer, exportNamePtr));

                const result = exports.HAKO_SetModuleExport(
                    this.vmContext.pointer,
                    this.modulePtr,
                    exportNamePtr,
                    value.getHandle()
                );

                if (result !== 0) {
                    throw new Error(`Failed to set export: ${exportName}`);
                }
            });
        } else {
            // Convert and dispose after setting
            using vmValue = this.vmContext.newValue(value);
            this.setExport(exportName, vmValue);
        }
    }

    /**
     * Sets multiple export values at once.
     *
     * @param exports - Object mapping export names to values
     */
    setExports(exports: Record<string, unknown>): void {
        for (const [exportName, value] of Object.entries(exports)) {
            this.setExport(exportName, value);
        }
    }

    /**
     * Creates a function export.
     *
     * @param exportName - Name of the function export
     * @param fn - Host function to bind
     */
    setFunction(exportName: string, fn: HostCallbackFunction<VMValue>): void {
        using func = this.vmContext.newFunction(exportName, fn);
        this.setExport(exportName, func);
    }
}