// Memory Intensive
// Tests memory allocation and garbage collection
(() => {
    // Create several large arrays with complex objects
    const largeArrays = [];

    for (let i = 0; i < 5; i++) {
        const arr = new Array(1000).fill(0).map((_, index) => ({
            id: index,
            value: Math.random(),
            name: `Item ${index}`,
            tags: Array.from({ length: 5 }, (_, j) => `tag-${j}`)
        }));

        largeArrays.push(arr);
    }

    // Do some processing on the arrays
    const processed = largeArrays.map(arr => {
        return {
            count: arr.length,
            avgValue: arr.reduce((sum, item) => sum + item.value, 0) / arr.length,
            filteredCount: arr.filter(item => item.value > 0.5).length
        };
    });

    // Force some cleanup by nullifying the large arrays
    // This helps with garbage collection in subsequent runs
    for (let i = 0; i < largeArrays.length; i++) {
        largeArrays[i] = null;
    }

    return processed;
})();