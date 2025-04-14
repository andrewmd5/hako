// Recursive Functions
// Tests recursive function calls
(() => {
    const factorialCache = new Map();
    function factorial(n) {
        if (n <= 1) return 1;
        if (factorialCache.has(n)) return factorialCache.get(n);
        const result = n * factorial(n - 1);
        factorialCache.set(n, result);
        return result;
    }

    const fibCache = new Map();
    function fibonacci(n) {
        if (n <= 1) return n;
        if (fibCache.has(n)) return fibCache.get(n);
        const result = fibonacci(n - 1) + fibonacci(n - 2);
        fibCache.set(n, result);
        return result;
    }

    const factResults = Array.from({ length: 10 }, (_, i) => factorial(i));
    const fibResults = Array.from({ length: 20 }, (_, i) => fibonacci(i));

    return { factorials: factResults, fibonacci: fibResults };
})();