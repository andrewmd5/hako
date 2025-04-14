// CPU Intensive Operations
// Tests CPU-intensive calculations
(() => {
    // Find primes up to 500 using a simple but inefficient algorithm
    function isPrimeInefficient(n) {
        if (n <= 1) return false;
        for (let i = 2; i < n; i++) {
            if (n % i === 0) return false;
        }
        return true;
    }

    const primes = [];
    for (let i = 2; i < 500; i++) {
        if (isPrimeInefficient(i)) {
            primes.push(i);
        }
    }

    // Quick sort implementation
    function quickSort(arr) {
        if (arr.length <= 1) return arr;

        const pivot = arr[Math.floor(arr.length / 2)];
        const left = arr.filter(x => x < pivot);
        const middle = arr.filter(x => x === pivot);
        const right = arr.filter(x => x > pivot);

        return [...quickSort(left), ...middle, ...quickSort(right)];
    }

    // Generate a random array and sort it
    const randomArray = Array.from({ length: 200 }, () => Math.floor(Math.random() * 1000));
    const sortedArray = quickSort(randomArray);

    return {
        primeCount: primes.length,
        firstFivePrimes: primes.slice(0, 5),
        lastFivePrimes: primes.slice(-5),
        arrayLength: randomArray.length,
        sortSuccess: sortedArray.every((val, i) => i === 0 || val >= sortedArray[i - 1])
    };
})();