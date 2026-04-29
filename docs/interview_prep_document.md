# MultiTenant SaaS Project - Interview Preparation Guide

This document is designed to help you intuitively understand the architecture, data flows, and key decisions of your MultiTenant SaaS project, providing you with a solid foundation for explaining it in an interview setting.

---

## 1. The "Elevator Pitch"
**What is it?**
A multi-tenant SaaS platform built to provide AI-powered services (like counseling, enrollment, and support) to various organizations. 

**Why is it interesting?**
It features a highly decoupled, asynchronous, event-driven architecture. Instead of the frontend waiting indefinitely for AI generation (which could cause timeouts), it leverages a **Task Queue (RabbitMQ)**, an **AI Orchestrator (LangGraph)**, and **WebSockets** to stream live status updates back to the user interface.

## 2. Core Architecture & Tech Stack
If asked "What is your stack?", break it down by responsibility:

*   **Frontend**: Next.js (App Router), React, Tailwind CSS, Shadcn UI. (Provides the user dashboard and chat interfaces).
*   **API / Authentication Gateway**: Node.js & Express. (Acts as the front door, handling JWT validation, RBAC (Role-Based Access Control), and routing).
*   **Message Broker**: RabbitMQ. (Decouples the fast API gateway from the slow AI agents).
*   **AI Agents / Workers**: Python & FastAPI. 
    *   **Orchestrator**: Built with LangGraph. Uses an LLM to decide which specialized agent to route a task to.
    *   **Worker Agents**: Perform the actual specialized tasks (e.g., worker_agent1, worker_agent2).
*   **Real-time Updates**: A Node.js `task-status` service managing WebSocket connections.
*   **Database**: PostgreSQL (handling multi-tenant data, RBAC permissions, and task state).
*   **Infrastructure**: AWS. Specifically, Terraform is used to provision an EC2 instance running **K3s** (a lightweight Kubernetes distribution), pulling container images from ECR.

## 3. Deep Dive: Component by Component

### A. Auth Gateway (The Front Door)
*   **Role**: All incoming API requests hit this gateway first.
*   **Key Action**: When a user submits a chat message, the gateway validates their JWT token and checks their permissions against the DB.
*   **The "Trick"**: Instead of waiting for the AI to respond, it instantly creates a `TaskId` in the database, publishes a message to the `tasks` RabbitMQ queue, and returns an HTTP `202 Accepted` to the frontend with the `TaskId`.

### B. The AI Agent Orchestrator (The Brain)
*   **Role**: Consumes messages from the RabbitMQ `tasks` queue.
*   **Workflow**:
    1.  Receives task and sets status to `running` in the DB.
    2.  Uses **LangGraph** to evaluate the user's prompt (e.g., uses an LLM to classify if the request is for generic info, HR/enrollment, or IT support).
    3.  Once the type is decided, it makes an **RPC (Remote Procedure Call)** via RabbitMQ to the specific worker agent queue.
    4.  Waits for the worker to finish, saves the result to the database (`agent_results`), and publishes a "completed" event to the `events.{org_id}` RabbitMQ exchange.

### C. Task Status Service (The Messenger)
*   **Role**: Keeps the frontend updated without constant polling.
*   **Mechanism**: It holds active WebSocket connections from the frontend (grouped by `session_id`). It listens to the `events.#` routing key on RabbitMQ. When the orchestrator publishes a status update, this service instantly relays it over the WebSocket to the correct user.

### D. Infrastructure (The Foundation)
*   **Role**: Runs the containerized microservices.
*   **Key Detail**: While the README mentions AWS EKS, the actual Terraform code provisions a single EC2 instance and installs **K3s**.
*   **Smart Cost-Saving Feature**: The Terraform includes an AWS CloudWatch metric alarm that automatically stops the EC2 instance if CPU utilization drops below 10% for 60 minutes. (Interviewers love cost-aware engineering).

---

## 4. The Core Data Flow (Be ready to draw or explain this)
**Scenario: A user sends a prompt to the chat.**

1. **Client -> Gateway**: User sends `POST /api/chat` with their prompt.
2. **Gateway -> DB -> Message Queue**: Gateway validates auth/RBAC. It creates a Task ID in Postgres. It publishes `{prompt, taskId, orgId}` to the `tasks` queue. 
3. **Gateway -> Client**: Gateway immediately replies HTTP `202 Accepted` with the `taskId`. *(The frontend UI shows a loading state).*
4. **Message Queue -> Orchestrator**: The Python Orchestrator picks up the task.
5. **Orchestrator -> LLM -> Worker**: Orchestrator uses LLM to classify the prompt, then sends the task to the specific worker queue via RPC.
6. **Worker -> Orchestrator**: Worker completes the AI generation and replies to the Orchestrator.
7. **Orchestrator -> DB & Event Queue**: Orchestrator updates DB task to `completed` and drops a "Task Completed" message into the `events.{org_id}` exchange.
8. **Event Queue -> Task Status Service -> Client**: The Node.js WebSocket service consumes the event and pushes the final AI response to the user's browser via WebSocket. *(Frontend UI updates with the AI's answer).*

---

## 5. Potential Interview Questions & How to Answer Them

**Q1: Why did you use RabbitMQ instead of just calling the Python API directly via HTTP?**
*Answer:* "AI generation can take anywhere from 5 to 30+ seconds. If we used synchronous HTTP calls, the connection could timeout, and the gateway would be blocked waiting for responses, severely limiting concurrent users. Using an event-driven queue decouples the fast components (gateway) from the slow components (AI agents), allowing the system to scale horizontally and handle traffic spikes gracefully."

**Q2: How do you handle Multi-Tenancy in this architecture?**
*Answer:* "We use a combination of Row-Level Security (RLS) or direct `org_id` filtering in PostgreSQL. Additionally, in our message queue and WebSockets, we namespace events by `org_id` (e.g., routing key `events.{org_id}`). This ensures that data from one tenant cannot leak to the WebSocket connection of another tenant."

**Q3: How does your WebSocket connection know which updates to send to which client?**
*Answer:* "The `task-status` service maintains in-memory mapping of `session_id` to WebSocket clients. When the Frontend connects, it subscribes to its specific session. When the RabbitMQ consumer pulls an event, it checks the event's `session_id` and broadcasts only to the clients registered to that ID, after verifying the `org_id` matches the user's token context."

**Q4: I see you use LangGraph for orchestration. Why not just a simple if/else statement?**
*Answer:* "While we do check for explicit actions directly, natural language prompts are unpredictable. LangGraph allows us to build a state machine where an LLM acts as the router. It evaluates the semantic intent of the query and routes it to the specific specialist agent (HR, Support, General). This pattern makes it incredibly easy to snap in new, specialized agents in the future without rewriting routing logic."

**Q5: What was the most challenging part of this project, and how did you solve it?**
*(Tailor this to your actual experience, but a great technical answer is based on the async flow)*:
*Answer (Example):* "Managing the state between the distributed systems was challenging. Initially, it was hard to keep the frontend UI fully synced with what the AI was doing. The solution was implementing the dedicated `task-status` WebSocket service. By having the orchestrator publish granular status updates ('running', 'completed', 'failed') back to RabbitMQ, the WebSocket service could push live state updates to the UI, creating a seamless user experience despite the complex asynchronous backend."

## 6. Pro-Tips for the Interview
*   **Emphasize "Decoupling"**: Interviewers love this word. Emphasize that your auth gateway doesn't care *how* the AI does its job, it just cares that the task is queued.
*   **Mention Cost Optimization**: Highlight the Terraform CloudWatch alarm that shuts down the EC2 instance when idle. This shows you think about business impact, not just code.
*   **Acknowledge Trade-offs**: If asked about weaknesses, mention that event-driven architectures are harder to debug and trace (you might mention needing distributed tracing like Jaeger or OpenTelemetry in the future). This demonstrates maturity.
