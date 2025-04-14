// Closure and Scope
// Tests closures and scope
(() => {
    const initialValue = Math.floor(Math.random() * 100);
    const step = Math.floor(Math.random() * 10) + 1;

    function createCounter(initialValue, step) {
        let count = initialValue;

        return {
            increment() {
                count += step;
                return count;
            },
            decrement() {
                count -= step;
                return count;
            },
            reset() {
                count = initialValue;
                return count;
            },
            getValue() {
                return count;
            }
        };
    }

    const counter = createCounter(initialValue, step);
    const results = [
        counter.getValue(),
        counter.increment(),
        counter.increment(),
        counter.decrement(),
        counter.reset(),
        counter.increment()
    ];

    return {
        initialValue,
        step,
        operations: [
            "getValue",
            "increment",
            "increment",
            "decrement",
            "reset",
            "increment"
        ],
        results
    };
})();