import { createMediaApi } from "./api.js";
import { verifyMediaTools } from "./command.js";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { runCleanupLoop, runJobLoop } from "./worker.js";

async function main() {
  const config = loadConfig();
  await verifyMediaTools(config);
  const api = createMediaApi(config);
  const shutdown = new AbortController();

  const stop = (signal) => {
    if (shutdown.signal.aborted) return;
    log.info("Shutdown requested; waiting for active work", { signal });
    shutdown.abort();
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  log.info("Media worker started", {
    worker_id: config.workerId,
    concurrency: config.concurrency,
    claim_batch_size: config.claimBatchSize,
  });
  await Promise.all([runJobLoop(api, config, shutdown.signal), runCleanupLoop(api, config, shutdown.signal)]);
  log.info("Media worker stopped", { worker_id: config.workerId });
}

main().catch((error) => {
  log.error("Media worker could not start", error);
  process.exitCode = 1;
});
