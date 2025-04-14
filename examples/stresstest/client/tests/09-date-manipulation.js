// Date Manipulation
// Tests date operations
(() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    return {
        now: now.toISOString(),
        tomorrow: tomorrow.toISOString(),
        nextWeek: nextWeek.toISOString(),
        nextMonth: nextMonth.toISOString(),
        dayOfWeek: now.getDay(),
        isWeekend: [0, 6].includes(now.getDay()),
        timeSinceMidnight: ((h, m, s) => h * 3600 + m * 60 + s)(
            now.getHours(),
            now.getMinutes(),
            now.getSeconds()
        )
    };
})();