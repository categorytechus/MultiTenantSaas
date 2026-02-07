const { hasPermission, getOrgId } = require('./permissions');

exports.handler = async (event) => {
    console.log("Orchestrator received event:", JSON.stringify(event, null, 2));

    // 1. Extract Authorizer Context (passed from our Lambda Authorizer)
    const context = event.requestContext.authorizer;
    const orgId = getOrgId(context);

    // 2. Determine required permission based on the path
    // Example: /api/agents (POST) might require 'agents:create'
    const path = event.path || event.requestContext.resourcePath;
    const method = event.httpMethod;

    let requiredPermission = 'read'; // default
    if (path.includes('agents') && method === 'POST') requiredPermission = 'agents:create';
    if (path.includes('users') && method === 'POST') requiredPermission = 'users:manage';
    if (path.includes('orgs') && method === 'PUT') requiredPermission = 'org:manage';

    // 3. Security Check: Orchestration Layer Permission Evaluation
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

    // 4. Success: Proceed with Orchestration logic (e.g., publishing to RabbitMQ)
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
