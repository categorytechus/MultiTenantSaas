const { verifyToken } = require('./auth_util');

exports.handler = async (event) => {
    console.log('Authorizing request...');

    // Extract token from Authorization header (Bearer <token>)
    const authHeader = event.authorizationToken || event.headers?.Authorization;

    if (!authHeader) {
        return generatePolicy('user', 'Deny', event.methodArn);
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = verifyToken(token);

    if (!decoded) {
        return generatePolicy('user', 'Deny', event.methodArn);
    }

    // Token is valid! Pass the org_id and permissions to the backend via context
    return generatePolicy(decoded.sub, 'Allow', event.methodArn, {
        org_id: decoded.org_id,
        permissions: JSON.stringify(decoded.permissions),
        email: decoded.email
    });
};

/**
 * Helper to generate IAM Policy for API Gateway
 */
const generatePolicy = (principalId, effect, resource, context = {}) => {
    const authResponse = {
        principalId: principalId
    };

    if (effect && resource) {
        authResponse.policyDocument = {
            Version: '2012-10-14',
            Statement: [
                {
                    Action: 'execute-api:Invoke',
                    Effect: effect,
                    Resource: resource
                }
            ]
        };
    }

    // Pass context to the backend lambda
    authResponse.context = context;

    return authResponse;
};
