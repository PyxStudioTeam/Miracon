import { spawn } from "node:child_process";
import { WorkerError } from "./errors.js";

const OUTPUT_LIMIT = 2 * 1024 * 1024;

function appendLimited(current, chunk) {
  if (current.length >= OUTPUT_LIMIT) return current;
  return current + chunk.toString("utf8").slice(0, OUTPUT_LIMIT - current.length);
}

export function runCommand(command, args, { timeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const terminate = () => {
      child.kill("SIGKILL");
    };
    const onAbort = () => {
      terminate();
      finish(reject, signal.reason ?? new WorkerError("Command aborted", { retryable: true }));
    };
    const timer = timeoutMs
      ? setTimeout(() => {
          terminate();
          finish(reject, new WorkerError(`${command} timed out`, { retryable: true }));
        }, timeoutMs)
      : undefined;

    timer?.unref();
    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", (error) => {
      finish(reject, new WorkerError(`Could not start ${command}: ${error.message}`, { retryable: false, cause: error }));
    });
    child.on("close", (code, childSignal) => {
      if (code === 0) return finish(resolve, { stdout, stderr });
      const detail = stderr.trim().slice(-4000);
      finish(
        reject,
        new WorkerError(
          `${command} exited with ${code ?? childSignal}${detail ? `: ${detail}` : ""}`,
          { retryable: false },
        ),
      );
    });

    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function verifyMediaTools(config) {
  await Promise.all([
    runCommand(config.ffmpegPath, ["-version"], { timeoutMs: 10_000 }),
    runCommand(config.ffprobePath, ["-version"], { timeoutMs: 10_000 }),
  ]);
}

export async function probeMedia(filePath, config, signal) {
  const { stdout } = await runCommand(
    config.ffprobePath,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath],
    { timeoutMs: Math.min(config.commandTimeoutMs, 60_000), signal },
  );
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new WorkerError("ffprobe returned invalid JSON", { retryable: false, cause: error });
  }
}
