// Set and Map Operations
// Tests Set and Map functionality
(() => {
    // Set operations
    const set1 = new Set([1, 2, 3, 4, 5]);
    const set2 = new Set([4, 5, 6, 7, 8]);

    // Union of sets
    const union = new Set([...set1, ...set2]);

    // Intersection of sets
    const intersection = new Set([...set1].filter(x => set2.has(x)));

    // Difference of sets
    const difference = new Set([...set1].filter(x => !set2.has(x)));

    // Map operations
    const map = new Map();
    for (let i = 0; i < 10; i++) {
        map.set(`key-${i}`, Math.random());
    }

    // Filter entries with values > 0.5
    const entries = [...map.entries()];
    const filteredEntries = entries.filter(([_, value]) => value > 0.5);

    return {
        setOperations: {
            set1: [...set1],
            set2: [...set2],
            union: [...union],
            intersection: [...intersection],
            difference: [...difference]
        },
        mapOperations: {
            entryCount: map.size,
            keys: [...map.keys()],
            highValueCount: filteredEntries.length
        }
    };
})();