# Implement Thread Pool Concurrency

Both the Orchestrator and Worker Agent currently process messages one-by-one because of the synchronous RabbitMQ consumer loop. We will implement a `ThreadPoolExecutor` to allow these services to handle multiple tasks in parallel.

## Proposed Changes

### [Component] Orchestrator
#### [MODIFY] [agents/orchestrator/main.py](file:///c:/KolmioLabs/MultiTenantSaas/agents/orchestrator/main.py)
- Import `ThreadPoolExecutor` from `concurrent.futures`.
- Increase RabbitMQ `prefetch_count` in `mq_client` (or via a new method).
- Update [callback](file:///c:/KolmioLabs/MultiTenantSaas/agents/orchestrator/main.py#27-90) to submit the task to the executor.
- Handle [ack](file:///c:/KolmioLabs/MultiTenantSaas/agents/orchestrator/main.py#27-90) in a thread-safe manner (though with `BlockingConnection` and a single consumer thread, we can also [ack](file:///c:/KolmioLabs/MultiTenantSaas/agents/orchestrator/main.py#27-90) immediately if we are okay with "at-most-once" or "at-least-once" depending on placement).
  - *Recommendation*: Move `ch.basic_ack` to the end of the threaded task.

### [Component] Worker Agent 1
#### [MODIFY] [agents/worker_agent1/main.py](file:///c:/KolmioLabs/MultiTenantSaas/agents/worker_agent1/main.py)
- Same changes as Orchestrator to allow multiple long-running agent tasks to execute concurrently on one container.

## Technical Detail: Pika and Threads
Pika's `BlockingConnection` is NOT thread-safe. To acknowledge a message from a worker thread, we must use `connection.add_callback_threadsafe`.

## Verification Plan

### Automated Verification
- Send 5 concurrent tasks to the Gateway.
- Observe the timestamps in logs to verify that multiple agents are "thinking" at the same time.

### Manual Verification
- Check memory usage when multiple threads are active to ensure OOM risks are managed.
