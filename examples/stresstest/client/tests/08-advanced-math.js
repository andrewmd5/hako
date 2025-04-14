// Advanced Math
// Tests more complex mathematical operations
(() => {
    function isPrime(n) {
        if (n <= 1) return false;
        if (n <= 3) return true;
        if (n % 2 === 0 || n % 3 === 0) return false;

        let i = 5;
        while (i * i <= n) {
            if (n % i === 0 || n % (i + 2) === 0) return false;
            i += 6;
        }
        return true;
    }

    const randomNumbers = Array.from({ length: 50 }, () => Math.floor(Math.random() * 1000));
    const primes = randomNumbers.filter(isPrime);
    const stats = {
        mean: randomNumbers.reduce((a, b) => a + b, 0) / randomNumbers.length,
        median: (arr => {
            const sorted = [...arr].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 === 0
                ? (sorted[mid - 1] + sorted[mid]) / 2
                : sorted[mid];
        })(randomNumbers),
        variance: (arr => {
            const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
            return arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
        })(randomNumbers),
        primesFound: primes.length
    };

    return stats;
})();