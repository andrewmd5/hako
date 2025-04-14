// JSON Operations
// Tests JSON handling and serialization
(() => {
    const complexObject = {
        id: Math.floor(Math.random() * 10000),
        name: "Test Object",
        tags: ["test", "json", "serialization"],
        metadata: {
            created: new Date().toISOString(),
            version: "1.0",
            isActive: true,
            stats: {
                views: 1000,
                likes: 50,
                comments: [
                    { id: 1, text: "Great!", author: "User1" },
                    { id: 2, text: "Awesome!", author: "User2" }
                ]
            }
        },
        data: Array.from({ length: 20 }, (_, i) => ({
            index: i,
            value: Math.random(),
            isEven: i % 2 === 0
        }))
    };

    // Serialize to JSON
    const jsonString = JSON.stringify(complexObject);

    // Parse it back
    const parsedBack = JSON.parse(jsonString);

    // Verify fields after round-trip
    const verification = {
        idMatch: parsedBack.id === complexObject.id,
        nameMatch: parsedBack.name === complexObject.name,
        tagCount: parsedBack.tags.length,
        dataLength: parsedBack.data.length,
        commentCount: parsedBack.metadata.stats.comments.length,
        stringLength: jsonString.length,
        // Date objects become strings in JSON
        createdIsString: typeof parsedBack.metadata.created === 'string'
    };

    return verification;
})();