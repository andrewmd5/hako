// Object Manipulation
// Tests object creation, access and manipulation
(() => {
    const createUser = (id) => ({
        id,
        name: `User ${id}`,
        email: `user${id}@example.com`,
        active: id % 3 === 0,
        createdAt: new Date().toISOString(),
        permissions: {
            admin: id === 1,
            editor: id < 5,
            viewer: true
        }
    });

    const users = Array.from({ length: 10 }, (_, i) => createUser(i + 1));
    const activeUsers = users.filter(u => u.active);
    const admins = users.filter(u => u.permissions.admin);
    const usersByPermission = users.reduce((acc, user) => {
        for (const [permission, hasPermission] of Object.entries(user.permissions)) {
            if (hasPermission) {
                if (!acc[permission]) acc[permission] = [];
                acc[permission].push(user.id);
            }
        }
        return acc;
    }, {});

    return {
        activeUserCount: activeUsers.length,
        adminCount: admins.length,
        usersByPermission
    };
})();