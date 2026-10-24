import { describe, expect, test } from "bun:test"
import { isSuccessfulExecution, isTerminalStatus, type ExecutionRecord } from "../src/contract"
import { mapCodexEvent, mapProcessResult, mapProcessStarted } from "../src/events"
import { buildCodexCommand } from "../src/executor"

const record = (overrides: Partial<ExecutionRecord> = {}): ExecutionRecord => ({
  jobID: "job_1",
  idempotencyKey: "request_1",
  sessionID: "session_1",
  promptID: "prompt_1",
  status: "completed",
  verification: { status: "passed" },
  createdAt: 1,
  ...overrides,
})

describe("codex executor contract", () => {
  test("identifies terminal execution states", () => {
    expect(isTerminalStatus("queued")).toBe(false)
    expect(isTerminalStatus("running")).toBe(false)
    expect(isTerminalStatus("completed")).toBe(true)
    expect(isTerminalStatus("failed")).toBe(true)
    expect(isTerminalStatus("cancelled")).toBe(true)
    expect(isTerminalStatus("needs_review")).toBe(true)
  })

  test("requires verification for successful execution", () => {
    expect(isSuccessfulExecution(record())).toBe(true)
    expect(isSuccessfulExecution(record({ verification: { status: "not_configured" } }))).toBe(false)
    expect(isSuccessfulExecution(record({ status: "needs_review" }))).toBe(false)
  })

  test("builds an argv array without a shell command", () => {
    expect(
      buildCodexCommand(
        { sandbox: "workspace-write" },
        { binary: "/usr/local/bin/codex", approveForMe: true },
        "/tmp/final message.txt",
      ),
    ).toEqual([
      "/usr/local/bin/codex",
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
      "--output-last-message",
      "/tmp/final message.txt",
      "-",
    ])
  })

  test("preserves raw Codex events and extracts agent messages", () => {
    expect(
      mapCodexEvent(
        { jobID: "job_1" },
        { type: "item.completed", item: { type: "agent_message", text: "Implemented the change" } },
        4,
        123,
      ),
    ).toEqual({
      raw: {
        type: "execution.raw",
        jobID: "job_1",
        sequence: 4,
        event: { type: "item.completed", item: { type: "agent_message", text: "Implemented the change" } },
        createdAt: 123,
      },
      message: "Implemented the change",
      kind: "item_completed",
    })
  })

  test("maps process lifecycle into OpenCode execution events", () => {
    const request = { sessionID: "session_1" }
    expect(mapProcessStarted(request)).toEqual({ type: "session.execution.started", data: request })
    expect(mapProcessResult(request, { status: "completed", exitCode: 0, timedOut: false, outputBytes: 10 })).toEqual({
      type: "session.execution.succeeded",
      data: request,
    })
    expect(mapProcessResult(request, { status: "failed", exitCode: 1, timedOut: false, outputBytes: 10 })).toEqual({
      type: "session.execution.failed",
      data: {
        sessionID: "session_1",
        error: { type: "codex_exit", message: "Codex exited with code 1", status: 500 },
      },
    })
    expect(mapProcessResult(request, { status: "cancelled", exitCode: null, timedOut: false, outputBytes: 10 })).toEqual({
      type: "session.execution.interrupted",
      data: { sessionID: "session_1", reason: "user" },
    })
  })
})
