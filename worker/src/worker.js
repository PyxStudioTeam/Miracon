import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupSourceCandidates, cleanupVariantCandidates, sourceCleanupCutoff } from "./cleanup.js";
import { LeaseLostError, errorDetails, isRetryable } from "./errors.js";
import { log } from "./logger.js";
import { discardUploaded, normalizeJob, processMediaJob } from "./processors.js";

function delay(milliseconds, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function startLeaseHeartbeat(jobId, leaseToken, api, config) {
  const controller = new AbortController();
  let renewing = false;
  let lastConfirmed = Date.now();
  const timer = setInterval(async () => {
    if (renewing || controller.signal.aborted) return;
    renewing = true;
    try {
      const renewed = await api.renewLease(jobId, leaseToken);
      if (!renewed) controller.abort(new LeaseLostError());
      else lastConfirmed = Date.now();
    } catch (error) {
      log.error("Lease renewal failed", error, { job_id: jobId });
      if (Date.now() - lastConfirmed >= config.leaseSeconds * 1000) {
        controller.abort(new LeaseLostError("Job lease could not be confirmed before expiry"));
      }
    } finally {
      renewing = false;
    }
  }, config.leaseRenewIntervalMs);
  timer.unref();
  return { signal: controller.signal, stop: () => clearInterval(timer) };
}

function hasCommittedVariants(state) {
  const result = state?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  if (result.variants == null) return false;
  if (!Array.isArray(result.variants)) return null;
  return result.variants.length > 0;
}

function isLeaseLoss(error, signal) {
  return error instanceof LeaseLostError || error?.code === "P0002" || signal.aborted;
}

export function completionFailureAction(
  state,
  leaseToken,
  completionDefinitelyFailed,
  now = Date.now(),
  { leaseLost = false } = {},
) {
  if (state?.status === "completed") return "completed";
  if (state?.status === "failed" && hasCommittedVariants(state) === false) return "delete-and-stop";
  const leaseExpiresAt = Date.parse(state?.lease_expires_at ?? "");
  const expiredFinalClaim = state?.status === "processing"
    && state.lease_token === leaseToken
    && Number.isFinite(leaseExpiresAt)
    && leaseExpiresAt <= now
    && Number(state.attempt_count) >= Number(state.max_attempts);
  if (leaseLost) return expiredFinalClaim ? "delete-and-stop" : "keep-and-stop";
  const activelyOwned = state?.status === "processing"
    && state.lease_token === leaseToken
    && Number.isFinite(leaseExpiresAt)
    && leaseExpiresAt > now;
  return completionDefinitelyFailed && activelyOwned ? "delete-and-fail" : "keep-and-fail";
}

export async function reconcileCompletionFailure(job, result, completionError, api, now, options) {
  let state;
  try {
    state = await api.getJobCompletionState(job.id);
  } catch (statusError) {
    return { action: options?.leaseLost ? "keep-and-stop" : "keep-and-fail", state: null, statusError };
  }

  const action = completionFailureAction(
    state,
    job.leaseToken,
    completionError?.completionDefinitelyFailed === true,
    now ?? Date.now(),
    options,
  );
  if (action === "delete-and-fail" || action === "delete-and-stop") {
    await discardUploaded(api, result.uploadedObjects ?? []);
  }
  return { action, state, statusError: null };
}

async function handleJob(row, api, config) {
  const rawId = row?.id ?? row?.job_id;
  const rawLeaseToken = row?.lease_token;
  let job;
  try {
    job = normalizeJob(row, config);
  } catch (error) {
    log.error("Claimed job is invalid", error, rawId ? { job_id: String(rawId) } : {});
    if (rawId && rawLeaseToken) {
      try {
        await api.failJob(String(rawId), String(rawLeaseToken), error.message, false, null);
      } catch (failureError) {
        log.error("Could not record invalid job failure", failureError, { job_id: String(rawId) });
      }
    }
    return;
  }

  const heartbeat = startLeaseHeartbeat(job.id, job.leaseToken, api, config);
  let tempDir;
  let processedResult;
  const startedAt = Date.now();
  log.info("Media job started", { job_id: job.id, asset_id: job.assetId, kind: job.kind });
  try {
    tempDir = await mkdtemp(join(tmpdir(), "media-worker-"));
    const sourceFile = join(tempDir, "source");
    await api.downloadPrivateObject(job.sourceBucket, job.sourcePath, sourceFile, heartbeat.signal, job.sourceMaxBytes);
    processedResult = await processMediaJob(job, sourceFile, tempDir, api, config, heartbeat.signal);
    heartbeat.signal.throwIfAborted();
    let reconciledCompletion = false;
    try {
      await api.completeJob(job.id, job.leaseToken, processedResult.variants, processedResult.result);
    } catch (completionError) {
      if (isLeaseLoss(completionError, heartbeat.signal)) throw completionError;
      const reconciliation = await reconcileCompletionFailure(job, processedResult, completionError, api);
      if (reconciliation.statusError) {
        log.error("Could not reconcile media job completion", reconciliation.statusError, { job_id: job.id });
      }
      if (reconciliation.action === "delete-and-stop") {
        log.warn("Media job was already terminally failed; new outputs were discarded", { job_id: job.id, asset_id: job.assetId });
        return;
      }
      if (reconciliation.action !== "completed") throw completionError;
      reconciledCompletion = true;
    }
    log.info("Media job completed", {
      job_id: job.id,
      asset_id: job.assetId,
      variants: processedResult.variants.length,
      reconciled: reconciledCompletion,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    if (isLeaseLoss(error, heartbeat.signal)) {
      if (processedResult) {
        const reconciliation = await reconcileCompletionFailure(
          job,
          processedResult,
          error,
          api,
          undefined,
          { leaseLost: true },
        );
        if (reconciliation.statusError) {
          log.error("Could not reconcile media job after lease loss", reconciliation.statusError, { job_id: job.id });
        }
        if (reconciliation.action === "completed") {
          log.info("Media job completed", {
            job_id: job.id,
            asset_id: job.assetId,
            variants: processedResult.variants.length,
            reconciled: true,
            duration_ms: Date.now() - startedAt,
          });
          return;
        }
        if (reconciliation.action === "delete-and-stop") {
          log.warn("Terminally failed media job outputs were discarded after lease loss", {
            job_id: job.id,
            asset_id: job.assetId,
          });
          return;
        }
      }
      log.warn("Media job stopped after lease loss", { job_id: job.id, asset_id: job.assetId });
      return;
    }
    const details = errorDetails(error);
    log.error("Media job failed", error, { job_id: job.id, asset_id: job.assetId });
    try {
      const retryable = isRetryable(error);
      await api.failJob(
        job.id,
        job.leaseToken,
        `${details.error_name ?? "Error"}: ${details.error}`,
        retryable,
        null,
      );
    } catch (failureError) {
      log.error("Could not record media job failure", failureError, { job_id: job.id });
    }
  } finally {
    heartbeat.stop();
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) {
        log.error("Could not remove job temporary directory", error, { job_id: job.id });
      }
    }
  }
}

export async function runJobLoop(api, config, shutdownSignal) {
  while (!shutdownSignal.aborted) {
    let jobs = [];
    try {
      jobs = await api.claimJobs();
    } catch (error) {
      log.error("Media job claim failed", error);
    }
    if (jobs.length > config.claimBatchSize) {
      log.warn("Claim RPC returned more rows than requested; extra rows will still be handled", { jobs: jobs.length });
    }
    let nextJob = 0;
    await Promise.all(
      Array.from({ length: Math.min(config.concurrency, jobs.length) }, async () => {
        while (nextJob < jobs.length) {
          const job = jobs[nextJob++];
          await handleJob(job, api, config);
        }
      }),
    );
    if (!shutdownSignal.aborted && jobs.length === 0) await delay(config.pollIntervalMs, shutdownSignal);
  }
}

export async function runCleanupLoop(api, config, shutdownSignal) {
  while (!shutdownSignal.aborted) {
    try {
      const candidates = await api.listCleanupCandidates();
      if (candidates.length > 0 && !shutdownSignal.aborted) {
        const result = await cleanupVariantCandidates(candidates, api);
        if (result.finalized > 0) log.info("Media variant cleanup completed", { variants: result.finalized });
        for (const failure of result.failures) {
          log.error("Media variant cleanup batch failed", failure.error, {
            stage: failure.stage,
            bucket: failure.bucket,
            variants: failure.variantIds.length,
          });
        }
      }
    } catch (error) {
      log.error("Media variant cleanup failed", error);
    }

    if (!shutdownSignal.aborted) {
      try {
        const before = sourceCleanupCutoff(config.sourceRetentionDays);
        const candidates = await api.listSourceCleanupCandidates(before);
        if (candidates.length > 0 && !shutdownSignal.aborted) {
          const result = await cleanupSourceCandidates(candidates, api);
          if (result.marked > 0) log.info("Media source cleanup completed", { assets: result.marked });
          for (const failure of result.failures) {
            log.error("Media source cleanup batch failed", failure.error, {
              stage: failure.stage,
              bucket: failure.bucket,
              assets: failure.assetIds.length,
            });
          }
        }
      } catch (error) {
        log.error("Media source cleanup failed", error);
      }
    }
    if (!shutdownSignal.aborted) await delay(config.cleanupIntervalMs, shutdownSignal);
  }
}
