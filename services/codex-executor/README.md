# Codex Executor

The planned asynchronous execution service for running Codex headless jobs on behalf of OpenCode.

Phase 2 adds the process runner. It starts Codex with `codex exec --json`, captures stdout/stderr, supports cancellation and timeouts, and reads the final message. It does not expose an HTTP server or durable job store yet.

## Contract

The contract in [`src/contract.ts`](./src/contract.ts) defines:

- idempotent execution submission;
- queued, running, and terminal execution states;
- stdout/stderr log records with sequence numbers;
- final agent messages;
- independent verification results;
- completion, failure, and cancellation events;
- status helpers that distinguish process completion from verified success.
- a process runner with argv construction, output limits, timeout handling, and cancellation.

The intended service API is:

```text
POST /executions
GET  /executions/:jobID
GET  /executions/:jobID/events?after=<sequence>
POST /executions/:jobID/cancel
```

The implementation should use durable storage and isolate each Codex invocation in its own workspace or container.
