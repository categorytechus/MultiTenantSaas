-- Migration: 007_add_session_id.sql
-- Adds session_id to agent_tasks to group tasks belonging to the same chat conversation.

ALTER TABLE agent_tasks
    ADD COLUMN session_id UUID;

CREATE INDEX idx_agent_tasks_session_id ON agent_tasks(session_id);
