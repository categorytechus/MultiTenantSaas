const express = require('express');
const { verifyToken, createEnrichedToken } = require('./auth_util');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

/**
 * Traefik ForwardAuth endpoint.
 * Validates the JWT from the Authorization header and returns
 * user context as response headers for downstream services.
 */
app.get('/verify', (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);
    const decoded = verifyToken(token);

    if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    res.set({
        'X-User-Id': decoded.sub,
        'X-Org-Id': decoded.org_id,
        'X-Permissions': JSON.stringify(decoded.permissions),
        'X-Email': decoded.email
    });

    return res.status(200).json({ status: 'authenticated' });
});

/**
 * Token creation endpoint.
 * Expects { user: { id, email }, org_id, permissions }.
 */
app.post('/token', (req, res) => {
    const { user, org_id, permissions } = req.body;

    if (!user?.id || !user?.email || !org_id || !Array.isArray(permissions)) {
        return res.status(400).json({
            error: 'Bad Request',
            message: 'Required: { user: { id, email }, org_id, permissions: [...] }'
        });
    }

    const token = createEnrichedToken(user, org_id, permissions);
    return res.status(200).json({ token });
});

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Auth service listening on port ${PORT}`);
});
