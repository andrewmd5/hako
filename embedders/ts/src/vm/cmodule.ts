import { ValueLifecycle, type ClassConstructorHandler, type ClassOptions, type HostCallbackFunction } from "@hako/etc/types";
import type { VMContext } from "@hako/vm/context";
import { VMValue } from "@hako/vm/value";
import { Scope } from "@hako/mem/lifetime";
import { HakoError } from "@hako/etc/errors";

/**
 * Builder for creating C modules in the main context.
 */
export class CModuleBuilder implements Disposable {
    private vmContext: VMContext;
    private modulePtr: number;
    private exports: string[] = [];
    private createdClasses: CModuleClass[] = [];
    private disposed = false;
    private initializerHandler: (initializer: CModuleInitializer) => void;

    constructor(context: VMContext, name: string, initHandler: (initializer: CModuleInitializer) => void) {
        this.vmContext = context;
        this.initializerHandler = initHandler;

        this.modulePtr = Scope.withScope((scope) => {
            const memory = context.container.memory;
            const hakoExports = context.container.exports;

            const moduleName = memory.allocateString(context.pointer, name);
            scope.add(() => memory.freeMemory(context.pointer, moduleName));

            const modulePtr = hakoExports.HAKO_NewCModule(context.pointer, moduleName);

            if (modulePtr === 0) {
                throw new HakoError(`Failed to create C module: ${name}`);
            }

            return modulePtr;
        });

        this.vmContext.container.callbacks.registerModuleInitHandler(name, (initializer) => {
            initializer._setParentBuilder(this);
            this.initializerHandler(initializer);
            return 0;
        });
    }

    get context(): VMContext {
        return this.vmContext;
    }

    get pointer(): number {
        return this.modulePtr;
    }

    get exportNames(): readonly string[] {
        return [...this.exports];
    }

    get name(): string {
        return Scope.withScope((scope) => {
            const exports = this.vmContext.container.exports;
            const namePtr = exports.HAKO_GetModuleName(this.vmContext.pointer, this.modulePtr);

            if (namePtr === 0) {
                throw new HakoError("Module name not found");
            }

            scope.add(() => this.vmContext.container.memory.freeCString(this.vmContext.pointer, namePtr));

            return this.vmContext.container.memory.readString(namePtr);
        });
    }

    addExport(exportName: string): this {
        this.checkDisposed();

        Scope.withScope((scope) => {
            const memory = this.vmContext.container.memory;
            const exports = this.vmContext.container.exports;

            const exportNamePtr = memory.allocateString(this.vmContext.pointer, exportName);
            scope.add(() => memory.freeMemory(this.vmContext.pointer, exportNamePtr));

            const result = exports.HAKO_AddModuleExport(this.vmContext.pointer, this.modulePtr, exportNamePtr);

            if (result !== 0) {
                throw new HakoError(`Failed to add export: ${exportName}`);
            }

            this.exports.push(exportName);
        });

        return this;
    }

    addExports(exportNames: string[]): this {
        for (const exportName of exportNames) {
            this.addExport(exportName);
        }
        return this;
    }

    /** @internal */
    _registerClass(classObj: CModuleClass): void {
        this.checkDisposed();
        this.createdClasses.push(classObj);
    }

    /** @internal */
    _unregisterClass(classObj: CModuleClass): void {
        const index = this.createdClasses.indexOf(classObj);
        if (index !== -1) {
            this.createdClasses.splice(index, 1);
        }
    }

    private checkDisposed(): void {
        if (this.disposed) {
            throw new HakoError("CModuleBuilder has been disposed");
        }
    }

    [Symbol.dispose](): void {
        if (this.disposed) return;

        for (const classObj of this.createdClasses) {
            try {
                classObj[Symbol.dispose]();
            } catch (error) {
                console.error(`Error disposing CModuleClass ${classObj.id}:`, error);
            }
        }
        this.createdClasses.length = 0;

        this.vmContext.container.callbacks.unregisterModuleInitHandler(this.name);

        if (this.modulePtr !== 0) {
            this.modulePtr = 0;
        }

        this.disposed = true;
    }
}

/**
 * Initializer for C modules in the init handler context.
 */
export class CModuleInitializer implements Disposable {
    private vmContext: VMContext;
    private modulePtr: number;
    private parentBuilder: CModuleBuilder | null = null;
    private createdClasses: CModuleClass[] = [];
    private disposed = false;

    constructor(context: VMContext, modulePtr: number) {
        this.vmContext = context;
        this.modulePtr = modulePtr;
    }

    /** @internal */
    _setParentBuilder(builder: CModuleBuilder): void {
        this.parentBuilder = builder;
    }

    get context(): VMContext {
        return this.vmContext;
    }

    /** @internal */
    get pointer(): number {
        return this.modulePtr;
    }

    get name(): string {
        return Scope.withScope((scope) => {
            const exports = this.vmContext.container.exports;
            const namePtr = exports.HAKO_GetModuleName(this.vmContext.pointer, this.modulePtr);

            if (namePtr === 0) {
                throw new HakoError("Module name not found");
            }

            scope.add(() => this.vmContext.container.memory.freeCString(this.vmContext.pointer, namePtr));

            return this.vmContext.container.memory.readString(namePtr);
        });
    }

    setExport(exportName: string, value: unknown): void {
        this.checkDisposed();

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
                    throw new HakoError(`Failed to set export: ${exportName}`);
                }
            });
        } else {
            using vmValue = this.vmContext.newValue(value);
            this.setExport(exportName, vmValue);
        }
    }

    setExports(exports: Record<string, unknown>): void {
        for (const [exportName, value] of Object.entries(exports)) {
            this.setExport(exportName, value);
        }
    }

    setFunction(exportName: string, fn: HostCallbackFunction<VMValue>): void {
        using func = this.vmContext.newFunction(exportName, fn);
        this.setExport(exportName, func);
    }

    /**
     * Creates and exports a class with inheritance support.
     * The constructor function receives the created instance, arguments, and new_target,
     * and should initialize the instance (set properties, opaque data, etc.).
     */
    setClass(
        exportName: string,
        name: string,
        constructorFn: (instance: VMValue, args: VMValue[], newTarget: VMValue) => void,
        options: ClassOptions = {}
    ): void {
        this.checkDisposed();

        const classObj = new CModuleClass(this.vmContext, name, constructorFn, options);

        this.createdClasses.push(classObj);

        if (this.parentBuilder) {
            this.parentBuilder._registerClass(classObj);
            classObj._setParentInitializer(this);
        }

        this.setExport(exportName, classObj.ctor);
    }

    private checkDisposed(): void {
        if (this.disposed) {
            throw new HakoError("CModuleInitializer has been disposed");
        }
    }

    /**
     * Disposal is coordinated through CModuleBuilder to avoid double-disposal.
     */
    [Symbol.dispose](): void {
        if (this.disposed) return;

        this.createdClasses.length = 0;
        this.disposed = true;
    }
}

export class CModuleClass implements Disposable {
    private context: VMContext;
    private classId: number;
    private proto: VMValue | undefined;
    private ctorFunction: VMValue | undefined;
    private disposed = false;

    constructor(
        context: VMContext,
        name: string,
        constructorFn: (instance: VMValue, args: VMValue[], newTarget: VMValue) => void,
        options: Omit<ClassOptions, 'constructor'> = {}
    ) {
        this.context = context;

        this.classId = Scope.withScope((scope) => {
            const classIdPtr = context.container.memory.allocatePointerArray(context.pointer, 1);
            scope.add(() => context.container.memory.freeMemory(context.pointer, classIdPtr));
            context.container.memory.writePointerToArray(classIdPtr, 0, 0);

            const classId = context.container.exports.HAKO_NewClassID(classIdPtr);
            if (classId === 0) {
                throw new HakoError(`Failed to allocate class ID for: ${name}`);
            }

            return classId;
        });

        try {
            this.setupClass(name, options);

            // Register inheritance-aware constructor wrapper
            const internalConstructor: ClassConstructorHandler = (_ctx, newTarget, args, _classId) => {
                using protoProperty = newTarget.getProperty("prototype");
                if (!protoProperty || context.getLastError(protoProperty)) {
                    throw new HakoError("Failed to get prototype from new_target");
                }

                let instance: VMValue | undefined;
                try {
                    instance = this.createInstanceWithPrototype(protoProperty);
                    constructorFn(instance, args, newTarget);
                    return instance;
                } catch (error) {
                    if (instance) {
                        instance.dispose();
                    }
                    throw error;
                }
            };

            context.container.callbacks.registerClassConstructor(this.classId, internalConstructor);
            if (options.finalizer) {
                context.container.callbacks.registerClassFinalizer(this.classId, options.finalizer);
            }
        } catch (error) {
            this.cleanup();
            throw error;
        }
    }

    /** @internal */
    _setParentInitializer(initializer: CModuleInitializer): void {
    }

    private setupClass(name: string, options: Omit<ClassOptions, 'constructor'>): void {
        const protoPtr = this.context.container.exports.HAKO_NewObject(this.context.pointer);
        const protoError = this.context.getLastError(protoPtr);
        if (protoError) {
            throw new HakoError(`Prototype creation exception for ${name}`, protoError);
        }

        this.proto = new VMValue(this.context, protoPtr, ValueLifecycle.Owned);

        if (options.methods) {
            for (const [methodName, methodFn] of Object.entries(options.methods)) {
                using method = this.context.newFunction(methodName, methodFn);
                const methodError = this.context.getLastError(method);
                if (methodError) {
                    throw new HakoError(`Failed to create method ${methodName}`, methodError);
                }

                this.proto.setProperty(methodName, method);
            }
        }

        this.ctorFunction = Scope.withScope((scope) => {
            const namePtr = this.context.container.memory.allocateString(this.context.pointer, name);
            scope.add(() => this.context.container.memory.freeMemory(this.context.pointer, namePtr));

            const constructorPtr = this.context.container.exports.HAKO_NewClass(
                this.context.pointer,
                this.classId,
                namePtr,
                options.finalizer ? 1 : 0
            );

            const ctorError = this.context.getLastError(constructorPtr);
            if (ctorError) {
                throw new HakoError(`Class constructor exception for ${name}`, ctorError);
            }

            return new VMValue(this.context, constructorPtr, ValueLifecycle.Owned);
        });

        if (options.staticMethods) {
            for (const [methodName, methodFn] of Object.entries(options.staticMethods)) {
                using method = this.context.newFunction(methodName, methodFn);
                const methodError = this.context.getLastError(method);
                if (methodError) {
                    throw new HakoError(`Failed to create static method ${methodName}`, methodError);
                }

                this.ctorFunction.setProperty(methodName, method);
            }
        }

        // Set up constructor-prototype relationship for inheritance
        this.context.container.exports.HAKO_SetConstructor(
            this.context.pointer,
            this.ctorFunction.getHandle(),
            this.proto.getHandle()
        );

        this.context.container.exports.HAKO_SetClassProto(
            this.context.pointer,
            this.classId,
            this.proto.getHandle()
        );
    }

    private cleanup(): void {
        if (this.ctorFunction) {
            this.ctorFunction.dispose();
            this.ctorFunction = undefined;
        }
        if (this.proto) {
            this.proto.dispose();
            this.proto = undefined;
        }
    }

    private checkDisposed(): void {
        if (this.disposed) {
            throw new HakoError("CModuleClass has been disposed");
        }
    }

    get ctor(): VMValue {
        this.checkDisposed();
        if (!this.ctorFunction) {
            throw new HakoError('Constructor not initialized');
        }
        return this.ctorFunction;
    }

    get id(): number {
        return this.classId;
    }

    get prototype(): VMValue {
        this.checkDisposed();
        if (!this.proto) {
            throw new HakoError('Prototype not initialized');
        }
        return this.proto;
    }

    createInstance(opaque?: number): VMValue {
        this.checkDisposed();

        const instancePtr = this.context.container.exports.HAKO_NewObjectClass(
            this.context.pointer,
            this.classId
        );

        const error = this.context.getLastError(instancePtr);
        if (error) {
            throw new HakoError(`Instance creation exception`, error);
        }

        const instance = new VMValue(this.context, instancePtr, ValueLifecycle.Owned);

        if (opaque !== undefined) {
            this.context.container.exports.HAKO_SetOpaque(instance.getHandle(), opaque);
        }

        return instance;
    }

    createInstanceWithPrototype(customProto: VMValue, opaque?: number): VMValue {
        this.checkDisposed();

        const instancePtr = this.context.container.exports.HAKO_NewObjectProtoClass(
            this.context.pointer,
            customProto.getHandle(),
            this.classId
        );

        const error = this.context.getLastError(instancePtr);
        if (error) {
            throw new HakoError(`Instance creation with prototype exception`, error);
        }

        const instance = new VMValue(this.context, instancePtr, ValueLifecycle.Owned);

        if (opaque !== undefined) {
            this.context.container.exports.HAKO_SetOpaque(instance.getHandle(), opaque);
        }

        return instance;
    }

    getOpaque(instance: VMValue): number {
        this.checkDisposed();
        return this.context.container.exports.HAKO_GetOpaque(this.context.pointer,
            instance.getHandle(),
            this.classId
        );
    }

    isInstance(value: VMValue): boolean {
        this.checkDisposed();
        const classId = this.context.container.exports.HAKO_GetClassID(value.getHandle());
        return classId === this.classId;
    }

    [Symbol.dispose](): void {
        if (this.disposed) return;

        try {
            this.context.container.callbacks.unregisterClassConstructor?.(this.classId);
            this.context.container.callbacks.unregisterClassFinalizer?.(this.classId);

            this.cleanup();
            this.disposed = true;
        } catch (error) {
            console.error(`Error during CModuleClass ${this.classId} disposal:`, error);
            this.disposed = true;
        }
    }
}