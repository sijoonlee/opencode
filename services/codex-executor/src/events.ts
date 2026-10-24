import type { CodexProcessResult, ExecutionEvent, ExecutionRequest, JSONValue } from "./contract.js"

export type OpenCodeExecutionEvent =
  | { readonly type: "session.execution.started"; readonly data: { readonly sessionID: string } }
  | { readonly type: "session.execution.succeeded"; readonly data: { readonly sessionID: string } }
  | {
      readonly type: "session.execution.failed"
      readonly data: {
        readonly sessionID: string
        readonly error: { readonly type: string; readonly message: string; readonly status?: number }
      }
    }
  | {
      readonly type: "session.execution.interrupted"
      readonly data: { readonly sessionID: string; readonly reason: "user" | "shutdown" }
    }

export type CodexEventMapping = {
  readonly raw: Extract<ExecutionEvent, { type: "execution.raw" }>
  readonly message?: string
  readonly kind:
    | "thread_started"
    | "turn_started"
    | "turn_completed"
    | "item_started"
    | "item_completed"
    | "error"
    | "unknown"
}

export function mapCodexEvent(
  request: Pick<ExecutionRequest, "jobID">,
  event: JSONValue,
  sequence: number,
  createdAt = Date.now(),
): CodexEventMapping {
  const type = eventObject(event)?.type
  const kind = eventKind(type)
  const message = extractAgentMessage(event)
  return {
    raw: {
      type: "execution.raw",
      jobID: request.jobID,
      sequence,
      event,
      createdAt,
    },
    ...(message === undefined ? {} : { message }),
    kind,
  }
}

export function mapProcessStarted(request: Pick<ExecutionRequest, "sessionID">): OpenCodeExecutionEvent {
  return { type: "session.execution.started", data: { sessionID: request.sessionID } }
}

export function mapProcessResult(
  request: Pick<ExecutionRequest, "sessionID">,
  result: CodexProcessResult,
): OpenCodeExecutionEvent {
  if (result.status === "completed") {
    return { type: "session.execution.succeeded", data: { sessionID: request.sessionID } }
  }
  if (result.status === "cancelled") {
    return { type: "session.execution.interrupted", data: { sessionID: request.sessionID, reason: "user" } }
  }
  return {
    type: "session.execution.failed",
    data: {
      sessionID: request.sessionID,
      error: {
        type: result.timedOut ? "timeout" : "codex_exit",
        message: result.timedOut
          ? "Codex execution timed out"
          : `Codex exited with code ${result.exitCode ?? "unknown"}`,
        ...(result.exitCode === null ? {} : { status: 500 }),
      },
    },
  }
}

function eventObject(value: JSONValue) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined
}

function eventKind(type: JSONValue | undefined): CodexEventMapping["kind"] {
  if (type === "thread.started") return "thread_started"
  if (type === "turn.started") return "turn_started"
  if (type === "turn.completed") return "turn_completed"
  if (type === "item.started") return "item_started"
  if (type === "item.completed") return "item_completed"
  if (type === "error") return "error"
  return "unknown"
}

function extractAgentMessage(value: JSONValue) {
  const object = eventObject(value)
  const item = eventObject(object?.item)
  if (item?.type !== "agent_message") return undefined
  if (typeof item.text === "string") return item.text
  if (typeof object?.text === "string") return object.text
  return undefined
}
