# Codex Executor

The planned asynchronous execution service for running Codex headless jobs on behalf of OpenCode.

Phase 3 adds event mapping. It preserves raw Codex JSONL events, extracts final agent messages, and maps process outcomes to OpenCode session execution lifecycle events. It does not expose an HTTP server or durable job store yet.

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
- an event adapter that preserves raw Codex events and maps lifecycle outcomes to OpenCode events.

The intended service API is:

```text
POST /executions
GET  /executions/:jobID
GET  /executions/:jobID/events?after=<sequence>
POST /executions/:jobID/cancel
```

The implementation should use durable storage and isolate each Codex invocation in its own workspace or container.

## OpenCode integration

OpenCode can opt into the executor for its existing session runner with:

```text
OPENCODE_EXECUTOR=codex
OPENCODE_CODEX_BIN=codex
OPENCODE_CODEX_SANDBOX=workspace-write
OPENCODE_CODEX_APPROVAL=never
```

This runs one Codex process for each admitted OpenCode prompt and keeps the normal OpenCode backend as the default. The Codex CLI must be installed and authenticated in the OpenCode server environment.
