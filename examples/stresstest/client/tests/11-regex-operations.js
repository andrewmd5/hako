// Regular Expression Operations
// Tests complex regular expression operations
(() => {
    const testStrings = [
        "john.doe@example.com",
        "invalid-email@",
        "support@company.co.uk",
        "12345",
        "https://www.example.com/path?query=value",
        "192.168.1.1",
        "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
        "The price is $19.99",
        "Call us at +1-555-123-4567",
        "The meeting is on 2023-04-15 at 15:30"
    ];

    const patterns = {
        email: /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/,
        url: /^(https?:\/\/)?([\w\d]+\.)?[\w\d]+\.\w+\/?.*/i,
        ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
        ipv6: /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/,
        price: /\$\d+\.\d{2}/,
        phone: /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
        date: /\d{4}-\d{2}-\d{2}/
    };

    // Only process a subset of strings for performance
    const sampleStrings = testStrings.slice(0, 5);

    const regexResults = sampleStrings.map(str => {
        const results = {};
        for (const [name, pattern] of Object.entries(patterns)) {
            results[name] = pattern.test(str);
        }
        return { string: str, matches: results };
    });

    return regexResults;
})();