/**
 * Permission Evaluator Utility for Backend Services
 */

/**
 * Validates if the user context has the required permission
 * @param {Object} context - Request context from Authorizer
 * @param {string} requiredPermission - Permission string (e.g., 'agents:create')
 * @returns {boolean}
 */
exports.hasPermission = (context, requiredPermission) => {
    if (!context || !context.permissions) return false;

    try {
        const permissions = JSON.parse(context.permissions);

        // Check for Global Admin (*) or exact permission
        return permissions.includes('*') || permissions.includes(requiredPermission);
    } catch (e) {
        console.error('Failed to parse permissions from context:', e);
        return false;
    }
};

/**
 * Returns the Organization ID from the context
 */
exports.getOrgId = (context) => {
    return context ? context.org_id : null;
};
