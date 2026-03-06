/**
 * Verification Script for 3-Tier Agent Architecture
 * Simulates a client request to the Auth Gateway and tracks the flow.
 */
const axios = require('axios');
const jwt = require('jsonwebtoken');

const AUTH_GATEWAY_URL = 'http://localhost:3001';
const JWT_KEY = process.env.JWT_KEY || 'development-secret';

// 1. Generate a mock token for Alice Admin (Acme Corp)
const token = jwt.sign({
    sub: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    email: 'alice@acme.com',
    org_id: '11111111-1111-1111-1111-111111111111',
    permissions: ['agents:run', 'knowledge_base:manage'],
    iss: 'multi-tenant-saas',
}, JWT_KEY);

const runVerification = async () => {
    console.log('--- Starting 3-Tier Architecture Verification ---');

    try {
        // 2. Submit Chat Request
        console.log('\n[1] Submitting chat request to Gateway...');
        const res = await axios.post(`${AUTH_GATEWAY_URL}/api/chat`, {
            prompt: 'How do I enroll in the payroll system?'
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log('Response:', res.data);

        if (res.status === 202) {
            console.log('\nSUCCESS: Request accepted by Gateway.');
            console.log('Next Steps: Check RabbitMQ queue "tasks" and then the "agent_tasks" table in DB.');
        }

    } catch (err) {
        console.error('\nFAILED:', err.response ? err.response.data : err.message);
        process.exit(1);
    }
};

runVerification();
