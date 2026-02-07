const jwt = require('jsonwebtoken');

/**
 * Creates an Enriched JWT for the Multi-Tenant SaaS
 * @param {Object} user - User object from DB
 * @param {string} orgId - Organization context
 * @param {Array<string>} permissions - List of permission strings
 * @returns {string} Signed JWT
 */
exports.createEnrichedToken = (user, orgId, permissions) => {
    const secret = process.env.JWT_KEY || 'development-secret';

    const payload = {
        sub: user.id,
        email: user.email,
        org_id: orgId,
        permissions: permissions,
        // Standard claims
        iss: 'multi-tenant-saas',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (60 * 60), // 60 minutes (Inactivity Timeout)
    };

    return jwt.sign(payload, secret);
};

exports.verifyToken = (token) => {
    const secret = process.env.JWT_KEY || 'development-secret';
    try {
        return jwt.verify(token, secret);
    } catch (err) {
        return null;
    }
};
