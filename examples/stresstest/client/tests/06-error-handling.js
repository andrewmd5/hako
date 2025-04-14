// Error Handling
// Tests try/catch and error objects
(() => {
    try {
        const result = (() => {
            // Intentional error to test error handling
            const obj = null;
            return obj.someProperty;
        })();
        return { unexpected: "Error should have been thrown" };
    } catch (error) {
        // We expect an error here
        return {
            name: error.name,
            message: error.message,
            stackSample: error.stack ? error.stack.substring(0, 100) : null
        };
    }
})();