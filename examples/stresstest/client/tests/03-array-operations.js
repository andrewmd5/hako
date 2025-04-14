// Array Operations
// Tests array manipulation and higher-order functions
(() => {
    const sourceArray = Array.from({ length: 200 }, (_, i) => i);
    const evens = sourceArray.filter(n => n % 2 === 0);
    const odds = sourceArray.filter(n => n % 2 !== 0);
    const squared = sourceArray.map(n => n * n);
    const sumOfSquaredEvens = evens.map(n => n * n).reduce((a, b) => a + b, 0);
    const firstTenMultipliedByPi = sourceArray.slice(0, 10).map(n => n * Math.PI);
    return {
        evensCount: evens.length,
        oddsCount: odds.length,
        sumOfSquaredEvens,
        piSample: firstTenMultipliedByPi
    };
})();