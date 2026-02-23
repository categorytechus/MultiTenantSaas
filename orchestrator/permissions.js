/**
 * Permission Evaluator Utility for Backend Services.
 *
 * Auth context is passed via trusted headers set by the auth service
 * through Traefik ForwardAuth (X-User-Id, X-Org-Id, X-Permissions, X-Email).
 */

/**
 * Builds a context object from trusted request headers.
 * @param {import('express').Request} req
 * @returns {{ user_id: string|null, org_id: string|null, permissions: string|null, email: string|null }}
 */
exports.buildContextFromHeaders = (req) => ({
    user_id: req.headers['x-user-id'] || null,
    org_id: req.headers['x-org-id'] || null,
    permissions: req.headers['x-permissions'] || null,
    email: req.headers['x-email'] || null
});

/**
 * Validates if the user context has the required permission.
 * @param {Object} context - Auth context (from buildContextFromHeaders)
 * @param {string} requiredPermission - e.g. 'agents:create'
 * @returns {boolean}
 */
exports.hasPermission = (context, requiredPermission) => {
    if (!context || !context.permissions) return false;

    try {
        const permissions = JSON.parse(context.permissions);
        return permissions.includes('*') || permissions.includes(requiredPermission);
    } catch (e) {
        console.error('Failed to parse permissions from context:', e);
        return false;
    }
};

/**
 * Returns the Organization ID from the context.
 */
exports.getOrgId = (context) => {
    return context ? context.org_id : null;
};
