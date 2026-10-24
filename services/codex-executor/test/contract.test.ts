import { describe, expect, test } from "bun:test"
import { isSuccessfulExecution, isTerminalStatus, type ExecutionRecord } from "../src/contract"
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
})
