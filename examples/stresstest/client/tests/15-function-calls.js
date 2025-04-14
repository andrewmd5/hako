// Complex Function Calls
// Tests function composition and higher-order functions
(() => {
    // Higher-order function to create a pipe of functions
    const pipe = (...fns) => x => fns.reduce((y, f) => f(y), x);

    // Various transformation functions
    const double = x => x * 2;
    const addTen = x => x + 10;
    const square = x => x * x;
    const negate = x => -x;
    const roundToDecimal = decimals => x => Number.parseFloat(x.toFixed(decimals));

    // Create some function compositions
    const operation1 = pipe(double, addTen, square);
    const operation2 = pipe(addTen, square, negate);
    const operation3 = pipe(square, double, addTen, roundToDecimal(2));

    // Apply the functions to a range of numbers
    const numbers = Array.from({ length: 5 }, (_, i) => i + 1);

    const results = numbers.map(n => ({
        input: n,
        operation1: operation1(n),
        operation2: operation2(n),
        operation3: operation3(n)
    }));

    return results;
})();