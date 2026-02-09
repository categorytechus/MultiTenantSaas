-- Enable required PostgreSQL extensions
-- Migration: 001_extensions.sql

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Vector similarity search for AI features
CREATE EXTENSION IF NOT EXISTS "vector";

-- Cryptographic functions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Case-insensitive text
CREATE EXTENSION IF NOT EXISTS "citext";

-- Additional timestamp functions
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Verify extensions are enabled
SELECT extname, extversion FROM pg_extension 
WHERE extname IN ('uuid-ossp', 'vector', 'pgcrypto', 'citext', 'btree_gist');