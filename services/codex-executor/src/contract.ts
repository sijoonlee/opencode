export type JSONValue =
  | null
  | boolean
  | number
  | string
  | readonly JSONValue[]
  | { readonly [key: string]: JSONValue }

export type ExecutionStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "needs_review"

export type VerificationStatus = "not_configured" | "pending" | "passed" | "failed" | "inconclusive"

export type LogStream = "stdout" | "stderr"

export type CodexSandbox = "read-only" | "workspace-write" | "danger-full-access"

export type ExecutionRequest = {
  readonly jobID: string
  readonly idempotencyKey: string
  readonly sessionID: string
  readonly promptID: string
  readonly prompt: string
  readonly workspaceDirectory: string
  readonly sandbox: CodexSandbox
  readonly timeoutMs?: number
  readonly verificationCommand?: readonly string[]
  readonly metadata?: Readonly<Record<string, JSONValue>>
}

export type ExecutionAccepted = {
  readonly jobID: string
  readonly sessionID: string
  readonly promptID: string
  readonly status: "queued" | "running"
}

export type ExecutionLog = {
  readonly sequence: number
  readonly stream: LogStream
  readonly text: string
  readonly createdAt: number
}

export type VerificationResult = {
  readonly status: Exclude<VerificationStatus, "pending">
  readonly command?: readonly string[]
  readonly exitCode?: number
  readonly output?: string
  readonly durationMs?: number
}

export type ExecutionRecord = {
  readonly jobID: string
  readonly idempotencyKey: string
  readonly sessionID: string
  readonly promptID: string
  readonly status: ExecutionStatus
  readonly verification: VerificationResult
  readonly createdAt: number
  readonly startedAt?: number
  readonly completedAt?: number
  readonly processID?: number
  readonly exitCode?: number
  readonly signal?: string
  readonly finalMessage?: string
  readonly error?: string
  readonly metadata?: Readonly<Record<string, JSONValue>>
}

export type ExecutionEvent =
  | {
      readonly type: "execution.accepted"
      readonly record: ExecutionAccepted
      readonly createdAt: number
    }
  | {
      readonly type: "execution.started"
      readonly jobID: string
      readonly processID?: number
      readonly createdAt: number
    }
  | {
      readonly type: "execution.log"
      readonly jobID: string
      readonly log: ExecutionLog
    }
  | {
      readonly type: "execution.message"
      readonly jobID: string
      readonly message: string
      readonly createdAt: number
    }
  | {
      readonly type: "execution.verification.started"
      readonly jobID: string
      readonly command: readonly string[]
      readonly createdAt: number
    }
  | {
      readonly type: "execution.verification.completed"
      readonly jobID: string
      readonly result: VerificationResult
      readonly createdAt: number
    }
  | {
      readonly type: "execution.completed"
      readonly jobID: string
      readonly record: ExecutionRecord
      readonly createdAt: number
    }
  | {
      readonly type: "execution.failed"
      readonly jobID: string
      readonly error: string
      readonly record: ExecutionRecord
      readonly createdAt: number
    }
  | {
      readonly type: "execution.cancelled"
      readonly jobID: string
      readonly record: ExecutionRecord
      readonly createdAt: number
    }

export type SubmitExecutionRequest = {
  readonly execution: ExecutionRequest
}

export type SubmitExecutionResponse = {
  readonly execution: ExecutionAccepted
  readonly deduplicated: boolean
}

export type GetExecutionResponse = {
  readonly execution: ExecutionRecord
}

export type ListExecutionEventsResponse = {
  readonly events: readonly ExecutionEvent[]
  readonly nextSequence?: number
}

export type CodexProcessResult = {
  readonly status: Extract<ExecutionStatus, "completed" | "failed" | "cancelled">
  readonly exitCode: number | null
  readonly signal?: string
  readonly timedOut: boolean
  readonly finalMessage?: string
  readonly outputBytes: number
}

export function isTerminalStatus(status: ExecutionStatus) {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "needs_review"
}

export function isSuccessfulExecution(record: ExecutionRecord) {
  return record.status === "completed" && record.verification.status === "passed"
}
