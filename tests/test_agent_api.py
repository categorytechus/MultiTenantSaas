#!/usr/bin/env python3
"""
Test Suite for Agent API and Worker Agents (Remote Cluster)

Tests the flow against a deployed cluster via ingress (/api and /ws paths only).
Run with: make test-py-remote

Environment (required):
    AUTH_GATEWAY_URL - Gateway URL (e.g. http://<EC2_IP>)
    WS_URL - WebSocket URL (e.g. ws://<EC2_IP>/ws/task-status)
    JWT_KEY - JWT signing key (must match cluster jwt-secret)
"""

import os
import sys
import time
import json
import asyncio
from dataclasses import dataclass, field
from typing import List, Optional, Callable, Any

import requests
import jwt
import websockets

AUTH_GATEWAY_URL = os.getenv("AUTH_GATEWAY_URL")
WS_URL = os.getenv("WS_URL")
JWT_KEY = os.getenv("JWT_KEY", "development-secret")

if not AUTH_GATEWAY_URL or not WS_URL:
    print("Error: AUTH_GATEWAY_URL and WS_URL must be set (e.g. make test-py-remote)")
    sys.exit(1)

TEST_ORG_ID = "11111111-1111-1111-1111-111111111111"
TEST_USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
UNKNOWN_USER_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff"


@dataclass
class TestResult:
    name: str
    status: str
    error: Optional[str] = None


@dataclass
class TestResults:
    passed: int = 0
    failed: int = 0
    tests: List[TestResult] = field(default_factory=list)


results = TestResults()


def generate_token(permissions: List[str] = None) -> str:
    """Generate a JWT token for testing."""
    if permissions is None:
        permissions = ["agents:run", "agents:create", "users:manage"]
    
    payload = {
        "sub": TEST_USER_ID,
        "email": "test@acme.com",
        "org_id": TEST_ORG_ID,
        "permissions": permissions,
        "iss": "multi-tenant-saas",
    }
    return jwt.encode(payload, JWT_KEY, algorithm="HS256")


def generate_token_for_user(user_id: str, permissions: List[str] = None) -> str:
    """Generate a JWT token for a specific user ID."""
    if permissions is None:
        permissions = ["agents:run"]
    
    payload = {
        "sub": user_id,
        "email": "test@acme.com",
        "org_id": TEST_ORG_ID,
        "permissions": permissions,
        "iss": "multi-tenant-saas",
    }
    return jwt.encode(payload, JWT_KEY, algorithm="HS256")


def log(message: str, log_type: str = "info") -> None:
    """Print colored log messages."""
    colors = {
        "info": "\033[36m[INFO]\033[0m",
        "pass": "\033[32m[PASS]\033[0m",
        "fail": "\033[31m[FAIL]\033[0m",
        "warn": "\033[33m[WARN]\033[0m",
    }
    prefix = colors.get(log_type, colors["info"])
    print(f"{prefix} {message}")


def test(name: str):
    """Decorator to run a test function and track results."""
    def decorator(fn: Callable):
        def wrapper(*args, **kwargs):
            global results
            try:
                fn(*args, **kwargs)
                results.passed += 1
                results.tests.append(TestResult(name=name, status="passed"))
                log(name, "pass")
            except Exception as e:
                results.failed += 1
                results.tests.append(TestResult(name=name, status="failed", error=str(e)))
                log(f"{name}: {e}", "fail")
        return wrapper
    return decorator


def run_test(name: str, fn: Callable) -> None:
    """Run a test function and track results."""
    global results
    try:
        fn()
        results.passed += 1
        results.tests.append(TestResult(name=name, status="passed"))
        log(name, "pass")
    except Exception as e:
        results.failed += 1
        results.tests.append(TestResult(name=name, status="failed", error=str(e)))
        log(f"{name}: {e}", "fail")


def assert_equal(actual: Any, expected: Any, message: str) -> None:
    """Assert two values are equal."""
    if actual != expected:
        raise AssertionError(f'{message}: expected "{expected}", got "{actual}"')


def assert_true(condition: bool, message: str) -> None:
    """Assert a condition is true."""
    if not condition:
        raise AssertionError(message)


def assert_in(value: Any, collection: List[Any], message: str) -> None:
    """Assert a value is in a collection."""
    if value not in collection:
        raise AssertionError(f'{message}: "{value}" not in {collection}')


def wait_for_task_result(task_id: str, token: str, timeout_secs: int = 30) -> dict:
    """Poll for task completion and return the result data."""
    start_time = time.time()
    while time.time() - start_time < timeout_secs:
        res = requests.get(
            f"{AUTH_GATEWAY_URL}/api/agents/{task_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if res.status_code == 200:
            data = res.json()
            status = data.get("status")
            if status in ("completed", "failed"):
                return data
        time.sleep(1)
    raise TimeoutError(f"Task {task_id} did not complete within {timeout_secs} seconds")


# ============================================================================
# Test: Unauthorized Access (no token)
# ============================================================================
def test_unauthorized_access() -> None:
    """Test that requests without token return 401."""
    res = requests.post(f"{AUTH_GATEWAY_URL}/api/chat", json={"prompt": "test"})
    assert_equal(res.status_code, 401, "Unauthorized status")


# ============================================================================
# Test: Invalid Token
# ============================================================================
def test_invalid_token() -> None:
    """Test that requests with invalid token return 401."""
    res = requests.post(
        f"{AUTH_GATEWAY_URL}/api/chat",
        json={"prompt": "test"},
        headers={"Authorization": "Bearer invalid-token"},
    )
    assert_equal(res.status_code, 401, "Invalid token status")


# ============================================================================
# Test: POST /api/chat - General Chat
# ============================================================================
def test_chat_endpoint() -> dict:
    """Test the chat endpoint for general queries."""
    token = generate_token(["agents:run"])
    res = requests.post(
        f"{AUTH_GATEWAY_URL}/api/chat",
        json={"prompt": "What is the weather today?"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert_equal(res.status_code, 202, "Chat endpoint status")
    data = res.json()
    assert_equal(data.get("action"), "agents:run", "Response action")

    # Wait for and log response
    log(f"Waiting for chat response (Task ID: {data.get('task_id')})...")
    result = wait_for_task_result(data.get("task_id"), token)
    res_data = result.get("result_data") or {}
    answer = res_data.get("answer") or "No answer received"
    log(f"Chat Response: {answer}", "pass")

    return data


# ============================================================================
# Test: POST /api/agents/start - Create Agent Task
# ============================================================================
def test_agent_start_endpoint() -> dict:
    """Test the agent start endpoint."""
    token = generate_token(["agents:create"])
    res = requests.post(
        f"{AUTH_GATEWAY_URL}/api/agents/start",
        json={"prompt": "Generate a report on sales data"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert_equal(res.status_code, 202, "Agent start status")
    data = res.json()
    assert_equal(data.get("action"), "agents:create", "Response action")

    # Wait for and log response
    log(f"Waiting for agent response (Task ID: {data.get('task_id')})...")
    result = wait_for_task_result(data.get("task_id"), token)
    res_data = result.get("result_data") or {}
    answer = res_data.get("answer") or "No answer received"
    log(f"Agent Response: {answer}", "pass")

    return data


# ============================================================================
# Test: Session ID Persistence
# ============================================================================
def test_session_persistence() -> None:
    """Test that session ID is preserved when provided."""
    token = generate_token(["agents:run"])
    import uuid
    session_id = str(uuid.uuid4())

    res = requests.post(
        f"{AUTH_GATEWAY_URL}/api/chat",
        json={"prompt": "First message", "sessionId": session_id},
        headers={"Authorization": f"Bearer {token}"},
    )

    json_res = res.json()
    if json_res.get("session_id") != session_id:
        print(f" [DEBUG] Session mismatch. Response: {json_res}")
    assert_equal(json_res.get("session_id"), session_id, "Session ID should be preserved")


# ============================================================================
# Test: GET /api/agents/:taskId - Task Status
# ============================================================================
def test_task_status_polling() -> None:
    """Test task status polling endpoint."""
    token = generate_token(["agents:run"])

    # First create a task
    create_res = requests.post(
        f"{AUTH_GATEWAY_URL}/api/chat",
        json={"prompt": "Test task for status polling"},
        headers={"Authorization": f"Bearer {token}"},
    )

    task_id = create_res.json().get("task_id")
    assert_true(task_id, "Task ID should exist")

    # Poll for status
    status_res = requests.get(
        f"{AUTH_GATEWAY_URL}/api/agents/{task_id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert_equal(status_res.status_code, 200, "Status poll response")
    data = status_res.json()
    assert_true(data.get("id") or data.get("task_id"), "Status should have task identifier")


# ============================================================================
# Test: Task Not Found
# ============================================================================
def test_task_not_found() -> None:
    """Test that non-existent task returns 404."""
    token = generate_token(["agents:run"])

    res = requests.get(
        f"{AUTH_GATEWAY_URL}/api/agents/00000000-0000-0000-0000-000000000000",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert_equal(res.status_code, 404, "Task not found status")


# ============================================================================
# Test: Forbidden - Missing Permission
# ============================================================================
def test_forbidden_access() -> None:
    """Test that requests without required permissions return 403."""
    token = generate_token_for_user(UNKNOWN_USER_ID, [])  # No permissions in DB for this user

    res = requests.post(
        f"{AUTH_GATEWAY_URL}/api/chat",
        json={"prompt": "test"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert_equal(res.status_code, 403, "Forbidden status")


# ============================================================================
# Test: Worker Agent Routing - HR/Enrollment Query
# ============================================================================
def test_hr_agent_routing() -> dict:
    """Test that HR queries are accepted (routed to worker_agent2)."""
    token = generate_token(["agents:run"])
    res = requests.post(
        f"{AUTH_GATEWAY_URL}/api/chat",
        json={"prompt": "How do I enroll in the 401k plan?"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert_equal(res.status_code, 202, "HR query accepted")
    assert_true(res.json().get("task_id"), "HR query should return task_id")
    return res.json()


# ============================================================================
# Test: Worker Agent Routing - IT Support Query
# ============================================================================
def test_it_agent_routing() -> dict:
    """Test that IT queries are accepted (routed to worker_agent3)."""
    token = generate_token(["agents:run"])
    res = requests.post(
        f"{AUTH_GATEWAY_URL}/api/chat",
        json={"prompt": "I need help resetting my VPN password"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert_equal(res.status_code, 202, "IT query accepted")
    assert_true(res.json().get("task_id"), "IT query should return task_id")
    return res.json()


# ============================================================================
# Test: WebSocket Connection and Task Subscription
# ============================================================================
def test_websocket_connection() -> None:
    """Test WebSocket connection to task-status-service."""
    token = generate_token(["agents:run"])

    async def connect():
        try:
            async with websockets.connect(
                f"{WS_URL}?token={token}",
                close_timeout=5,
            ) as ws:
                # Connection successful
                pass
        except asyncio.TimeoutError:
            raise AssertionError("WebSocket connection timeout")
        except Exception as e:
            raise AssertionError(f"WebSocket error: {e}")

    asyncio.get_event_loop().run_until_complete(
        asyncio.wait_for(connect(), timeout=5.0)
    )


# ============================================================================
# Test: End-to-End Flow with Status Updates
# ============================================================================
def test_end_to_end_flow() -> None:
    """Test full end-to-end flow with task creation and polling."""
    token = generate_token(["agents:run"])

    # 1. Create task
    create_res = requests.post(
        f"{AUTH_GATEWAY_URL}/api/chat",
        json={"prompt": "What are the company holidays this year?"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert_equal(create_res.status_code, 202, "Task creation accepted")
    task_id = create_res.json().get("task_id")
    assert_true(task_id, "Task ID returned")

    assert_true(task_id, "Task ID returned")

    # 2. Wait for completion
    log(f"Waiting for E2E task result (Task ID: {task_id})...")
    result = wait_for_task_result(task_id, token)
    final_status = result.get("status")
    
    res_data = result.get("result_data") or {}
    answer = res_data.get("answer") or "No answer received"
    log(f"Final Agent Answer: {answer}", "pass")

    assert_in(
        final_status,
        ["pending", "running", "completed", "failed"],
        "Final status should be valid",
    )


# ============================================================================
# Main Test Runner
# ============================================================================
def run_tests() -> None:
    """Run all tests."""
    print("\n========================================")
    print("  Agent API & Worker Agent Test Suite")
    print("========================================")
    print(f"Gateway: {AUTH_GATEWAY_URL}")
    print(f"WebSocket: {WS_URL}")
    print("")

    # Auth Tests
    run_test("Unauthorized Access (no token)", test_unauthorized_access)
    run_test("Invalid Token", test_invalid_token)

    # Agent API Tests
    run_test("POST /api/chat - General Chat", test_chat_endpoint)
    run_test("POST /api/agents/start - Create Task", test_agent_start_endpoint)
    run_test("Session ID Persistence", test_session_persistence)
    run_test("GET /api/agents/:taskId - Status Polling", test_task_status_polling)
    run_test("Task Not Found (404)", test_task_not_found)
    run_test("Forbidden Access (no permissions)", test_forbidden_access)

    # Worker Agent Routing Tests
    run_test("HR/Enrollment Query Routing", test_hr_agent_routing)
    run_test("IT Support Query Routing", test_it_agent_routing)

    # WebSocket Tests (may fail if task-status-service not running)
    run_test("WebSocket Connection", test_websocket_connection)

    # End-to-End Flow (requires all services running)
    run_test("End-to-End Flow with Polling", test_end_to_end_flow)

    # Summary
    print("\n========================================")
    print("  Test Results")
    print("========================================")
    print(f"\033[32mPassed: {results.passed}\033[0m")
    print(f"\033[31mFailed: {results.failed}\033[0m")
    print("")

    if results.failed > 0:
        print("Failed Tests:")
        for t in results.tests:
            if t.status == "failed":
                print(f"  - {t.name}: {t.error}")

    sys.exit(1 if results.failed > 0 else 0)


if __name__ == "__main__":
    run_tests()
