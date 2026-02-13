const { hasPermission, getOrgId } = require('./permissions');

/**
 * Handles POST /api/validate-permissions
 * Accepts a JSON body with either:
 *   { "permission": "agents:create" }           — single permission check
 *   { "permissions": ["agents:create", "org:read"] } — batch permission check
 *
 * Returns the validation result for each requested permission.
 */
const handleValidatePermissions = (context, body) => {
    const orgId = getOrgId(context);

    let parsed;
    try {
        parsed = typeof body === 'string' ? JSON.parse(body) : body;
    } catch (e) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: "Bad Request",
                message: "Invalid JSON body. Expected { \"permission\": \"...\" } or { \"permissions\": [\"...\"] }"
            })
        };
    }

    // Normalize to an array of permissions to check
    const permissionsToCheck = parsed.permissions
        ? parsed.permissions
        : parsed.permission
            ? [parsed.permission]
            : [];

    if (permissionsToCheck.length === 0) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: "Bad Request",
                message: "Request body must include \"permission\" (string) or \"permissions\" (array)."
            })
        };
    }

    // Evaluate each permission
    const results = permissionsToCheck.map((perm) => ({
        permission: perm,
        granted: hasPermission(context, perm)
    }));

    const allGranted = results.every((r) => r.granted);

    console.log(`Permission validation for Org ${orgId}: ${JSON.stringify(results)}`);

    return {
        statusCode: 200,
        body: JSON.stringify({
            org_id: orgId,
            principal: context?.principalId || null,
            all_granted: allGranted,
            results: results
        })
    };
};

exports.handler = async (event) => {
    console.log("Orchestrator received event:", JSON.stringify(event, null, 2));

    // 1. Extract Authorizer Context (passed from our Lambda Authorizer)
    const context = event.requestContext.authorizer;
    const orgId = getOrgId(context);

    // 2. Determine the request path and method
    const path = event.path || event.requestContext.resourcePath;
    const method = event.httpMethod;

    // --- /api/validate-permissions endpoint ---
    if (path.includes('validate-permissions')) {
        if (method !== 'POST') {
            return {
                statusCode: 405,
                body: JSON.stringify({
                    error: "Method Not Allowed",
                    message: "Use POST to validate permissions."
                })
            };
        }
        return handleValidatePermissions(context, event.body);
    }

    // 3. Determine required permission based on the path
    // Example: /api/agents (POST) might require 'agents:create'
    let requiredPermission = 'read'; // default
    if (path.includes('agents') && method === 'POST') requiredPermission = 'agents:create';
    if (path.includes('users') && method === 'POST') requiredPermission = 'users:manage';
    if (path.includes('orgs') && method === 'PUT') requiredPermission = 'org:manage';

    // 4. Security Check: Orchestration Layer Permission Evaluation
    if (!hasPermission(context, requiredPermission)) {
        console.warn(`Unauthorized access attempt: User ${context?.principalId} lacks ${requiredPermission} for Org ${orgId}`);
        return {
            statusCode: 403,
            body: JSON.stringify({
                error: "Forbidden",
                message: `You do not have the required permission: ${requiredPermission}`
            })
        };
    }

    // 5. Success: Proceed with Orchestration logic (e.g., publishing to RabbitMQ)
    console.log(`Permission granted for ${requiredPermission}. Processing task for Org: ${orgId}`);

    return {
        statusCode: 200,
        body: JSON.stringify({
            message: "Orchestration successful",
            org_id: orgId,
            action: requiredPermission,
            status: "PROCESSED"
        }),
    };
};
