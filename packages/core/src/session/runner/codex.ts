import {
  executeCodex,
  mapCodexEvent,
  type CodexProcessResult,
  type CodexEventMapping,
  type ExecutionLog,
} from "@opencode/codex-executor"
import { Money } from "@opencode/schema/money"
import type { TokenUsage } from "@opencode/schema/token-usage"
import { Effect } from "effect"
import { Bus } from "../../bus.js"
import { SessionEvent } from "../event.js"
import { SessionMessage } from "../message.js"
import type { SessionContext } from "../context.js"
import { StepFailedError } from "../error.js"

const zeroTokens: TokenUsage.Info = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}

export const enabled = () => process.env.OPENCODE_EXECUTOR === "codex"

export const run = Effect.fn("SessionRunner.Codex")(function* (input: {
  readonly bus: Bus.Interface
  readonly context: SessionContext.Loaded
  readonly assistantMessageID: SessionMessage.ID
}) {
  const user = input.context.messages.findLast((message) => message.type === "user")
  if (!user || user.type !== "user")
    return yield* new StepFailedError({ error: { type: "codex.prompt-missing", message: "No user prompt was found" } })

  const started = Date.now()
  yield* input.bus.publish(SessionEvent.Step.Started, {
    sessionID: input.context.session.id,
    assistantMessageID: input.assistantMessageID,
    agent: input.context.agent.id,
    model: input.context.model.ref,
    started,
  })
  const logs: ExecutionLog[] = []
  const events: CodexEventMapping[] = []
  const controller = new AbortController()
  const result = yield* Effect.promise(() =>
    executeCodex(
      {
        jobID: input.context.session.id,
        idempotencyKey: user.id,
        sessionID: input.context.session.id,
        promptID: user.id,
        prompt: user.text,
        workspaceDirectory: input.context.session.location.directory,
        sandbox: (process.env.OPENCODE_CODEX_SANDBOX as "read-only" | "workspace-write" | "danger-full-access") ??
          "workspace-write",
        timeoutMs: process.env.OPENCODE_CODEX_TIMEOUT_MS
          ? Number.parseInt(process.env.OPENCODE_CODEX_TIMEOUT_MS, 10)
          : undefined,
      },
      {
        binary: process.env.OPENCODE_CODEX_BIN,
        approveForMe: process.env.OPENCODE_CODEX_APPROVAL === "never",
        maxOutputBytes: process.env.OPENCODE_CODEX_MAX_OUTPUT_BYTES
          ? Number.parseInt(process.env.OPENCODE_CODEX_MAX_OUTPUT_BYTES, 10)
          : undefined,
        signal: controller.signal,
        onLog: (log) => {
          logs.push(log)
        },
        onEvent: (event) => {
          events.push(mapCodexEvent({ jobID: input.context.session.id }, event, events.length + 1))
        },
      },
    ),
  ).pipe(
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        controller.abort()
      }),
    ),
  )

  if (result.status !== "completed") {
    yield* input.bus.publish(SessionEvent.Step.Failed, {
      sessionID: input.context.session.id,
      assistantMessageID: input.assistantMessageID,
      error: processError(result),
      rawFinish: result.timedOut ? "timeout" : undefined,
    })
    yield* Effect.logDebug("Codex process completed without success", {
      sessionID: input.context.session.id,
      status: result.status,
      outputBytes: result.outputBytes,
      logs: logs.length,
      events: events.length,
    })
    return yield* new StepFailedError({ error: processError(result) })
  }

  const finalMessage = result.finalMessage ?? ""
  yield* input.bus.publish(SessionEvent.Text.Started, {
    sessionID: input.context.session.id,
    assistantMessageID: input.assistantMessageID,
    ordinal: 0,
  })
  yield* input.bus.publish(SessionEvent.Text.Ended, {
    sessionID: input.context.session.id,
    assistantMessageID: input.assistantMessageID,
    ordinal: 0,
    text: finalMessage,
  })
  yield* input.bus.publish(SessionEvent.Step.Streamed, {
    sessionID: input.context.session.id,
    assistantMessageID: input.assistantMessageID,
  })
  yield* input.bus.publish(SessionEvent.Step.Ended, {
    sessionID: input.context.session.id,
    assistantMessageID: input.assistantMessageID,
    finish: "stop",
    cost: Money.USD.zero,
    tokens: zeroTokens,
  })
  yield* Effect.logDebug("Codex process completed", {
    sessionID: input.context.session.id,
    outputBytes: result.outputBytes,
    logs: logs.length,
    events: events.length,
  })
  return false
})

function processError(result: CodexProcessResult) {
  return {
    type: result.timedOut ? "codex.timeout" : "codex.process",
    message:
      result.timedOut
        ? "Codex execution timed out"
        : `Codex execution failed with ${result.signal ? `signal ${result.signal}` : `exit code ${result.exitCode ?? "unknown"}`}${result.stderr ? `: ${result.stderr}` : ""}`,
  }
}
