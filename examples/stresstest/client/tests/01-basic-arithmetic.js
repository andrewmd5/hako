// Basic Arithmetic Operations
// Tests basic arithmetic operations and Math methods
(() => {
    const numbers = Array.from({ length: 100 }, () => Math.floor(Math.random() * 1000));
    const sum = numbers.reduce((a, b) => a + b, 0);
    const average = sum / numbers.length;
    const max = Math.max(...numbers);
    const min = Math.min(...numbers);
    return { sum, average, max, min };
})();