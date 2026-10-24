import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { CodexProcessResult, ExecutionLog, ExecutionRequest, JSONValue } from "./contract.js"

export type CodexExecutorOptions = {
  readonly binary?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly approveForMe?: boolean
  readonly maxOutputBytes?: number
  readonly onLog?: (log: ExecutionLog) => void | Promise<void>
  readonly onEvent?: (event: JSONValue) => void | Promise<void>
  readonly signal?: AbortSignal
}

export class CodexOutputLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Codex output exceeded the ${limit} byte limit`)
    this.name = "CodexOutputLimitError"
  }
}

export async function executeCodex(
  request: ExecutionRequest,
  options: CodexExecutorOptions = {},
): Promise<CodexProcessResult> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-codex-"))
  const finalMessagePath = path.join(directory, "final-message.txt")
  const command = buildCodexCommand(request, options, finalMessagePath)
  const child = Bun.spawn(command, {
    cwd: request.workspaceDirectory,
    env: mergeEnvironment(options.environment),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024
  const state = {
    outputBytes: 0,
    sequence: 0,
    termination: undefined as "cancelled" | "timeout" | undefined,
  }
  const timeout =
    request.timeoutMs === undefined ? undefined : setTimeout(() => terminate(child, state, "timeout"), request.timeoutMs)
  const abort = () => terminate(child, state, "cancelled")
  options.signal?.addEventListener("abort", abort, { once: true })

  try {
    child.stdin.write(request.prompt)
    child.stdin.end()
    await Promise.all([
      readLines(child.stdout, "stdout", state, maxOutputBytes, options),
      readLines(child.stderr, "stderr", state, maxOutputBytes, options),
    ])
    const exitCode = await child.exited
    const finalMessage = await readFinalMessage(finalMessagePath)
    const status =
      state.termination === "timeout"
        ? "failed"
        : state.termination === "cancelled"
          ? "cancelled"
          : exitCode === 0
            ? "completed"
            : "failed"
    return {
      status,
      exitCode,
      ...(child.signalCode ? { signal: child.signalCode } : {}),
      timedOut: state.termination === "timeout",
      ...(finalMessage ? { finalMessage } : {}),
      outputBytes: state.outputBytes,
    }
  } catch (error) {
    terminate(child, state, state.termination ?? "cancelled")
    await child.exited
    throw error
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    options.signal?.removeEventListener("abort", abort)
    await rm(directory, { recursive: true, force: true })
  }
}

export function buildCodexCommand(
  request: Pick<ExecutionRequest, "sandbox">,
  options: Pick<CodexExecutorOptions, "binary" | "approveForMe"> = {},
  finalMessagePath = "/tmp/codex-final-message.txt",
) {
  return [
    options.binary ?? "codex",
    "exec",
    "--json",
    "--sandbox",
    request.sandbox,
    ...(options.approveForMe ? ["--ask-for-approval", "never"] : []),
    "--output-last-message",
    finalMessagePath,
    "-",
  ]
}

function mergeEnvironment(environment: Readonly<Record<string, string | undefined>> | undefined) {
  const merged = { ...process.env, ...environment }
  return Object.fromEntries(Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  logStream: ExecutionLog["stream"],
  state: { outputBytes: number; sequence: number; termination: "cancelled" | "timeout" | undefined },
  maxOutputBytes: number,
  options: CodexExecutorOptions,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.value !== undefined) {
        state.outputBytes += chunk.value.byteLength
        if (state.outputBytes > maxOutputBytes) throw new CodexOutputLimitError(maxOutputBytes)
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      }
      if (chunk.done) {
        buffer += decoder.decode()
        if (buffer.length > 0) await emitLine(buffer)
        return
      }
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ""
      for (const line of lines) await emitLine(line)
    }
  } finally {
    reader.releaseLock()
  }

  async function emitLine(line: string) {
    const log: ExecutionLog = {
      sequence: ++state.sequence,
      stream: logStream,
      text: line,
      createdAt: Date.now(),
    }
    await options.onLog?.(log)
    if (logStream !== "stdout" || line.length === 0) return
    try {
      await options.onEvent?.(JSON.parse(line) as JSONValue)
    } catch (error) {
      if (error instanceof SyntaxError) return
      throw error
    }
  }
}

async function readFinalMessage(file: string) {
  return (await readFile(file, "utf8").catch(() => "")).trim() || undefined
}

function terminate(
  child: Bun.Subprocess,
  state: { termination: "cancelled" | "timeout" | undefined },
  reason: "cancelled" | "timeout",
) {
  if (state.termination !== undefined) return
  state.termination = reason
  child.kill("SIGTERM")
}
