import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";
import { InvalidJobError, WorkerError } from "./errors.js";

function externalError(action, error, responseStatus = null) {
  const status = typeof responseStatus === "number" && responseStatus > 0
    ? responseStatus
    : typeof error?.status === "number" ? error.status : null;
  const wrapped = new WorkerError(`${action}: ${error?.message ?? "unknown Supabase error"}`, {
    retryable: status == null || status === 408 || status === 429 || status >= 500,
    cause: error,
  });
  if (status != null) wrapped.status = status;
  if (typeof error?.code === "string") wrapped.code = error.code;
  return wrapped;
}

function rpcRows(data, property) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[property])) return data[property];
  return [];
}

function duplicateObject(error) {
  return error?.status === 409 || /already exists|duplicate/i.test(error?.message ?? "");
}

function encodeStoragePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function createMediaApi(config) {
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-client-info": "miracon-media-worker/1.0" } },
  });

  return {
    async claimJobs() {
      const { data, error } = await client.rpc("claim_media_processing_jobs", {
        p_limit: config.claimBatchSize,
        p_lease_seconds: config.leaseSeconds,
      });
      if (error) throw externalError("Could not claim media jobs", error);
      return rpcRows(data, "jobs");
    },

    async renewLease(jobId, leaseToken) {
      const { data, error } = await client.rpc("renew_media_processing_lease", {
        p_job_id: jobId,
        p_lease_token: leaseToken,
        p_lease_seconds: config.leaseSeconds,
      });
      if (error?.code === "P0002") return false;
      if (error) throw externalError("Could not renew media job lease", error);
      return data != null;
    },

    async completeJob(jobId, leaseToken, variants, result) {
      const { error, status } = await client.rpc("complete_media_processing_job", {
        p_job_id: jobId,
        p_lease_token: leaseToken,
        p_variants: variants,
        p_result: result,
      });
      if (error) {
        const wrapped = externalError("Could not complete media job", error, status);
        wrapped.completionDefinitelyFailed = status >= 400 && status < 500 && status !== 408 && status !== 429;
        throw wrapped;
      }
    },

    async getJobCompletionState(jobId) {
      const { data, error, status } = await client
        .from("media_processing_jobs")
        .select("status,lease_token,lease_expires_at,attempt_count,max_attempts,result")
        .eq("id", jobId)
        .maybeSingle();
      if (error) throw externalError("Could not query media job completion state", error, status);
      return data;
    },

    async failJob(jobId, leaseToken, errorMessage, retryable, retryDelaySeconds) {
      const { error } = await client.rpc("fail_media_processing_job", {
        p_job_id: jobId,
        p_lease_token: leaseToken,
        p_error: errorMessage.slice(0, 4000),
        p_retryable: retryable,
        p_retry_delay_seconds: retryDelaySeconds,
      });
      if (error) throw externalError("Could not fail media job", error);
    },

    async listCleanupCandidates() {
      const { data, error } = await client.rpc("get_media_cleanup_candidates", {
        p_limit: config.cleanupBatchSize,
      });
      if (error) throw externalError("Could not list media cleanup candidates", error);
      return rpcRows(data, "candidates");
    },

    async tombstoneVariants(variantIds) {
      const { data, error } = await client.rpc("tombstone_media_variants", { p_variant_ids: variantIds });
      if (error) throw externalError("Could not tombstone media variants", error);
      return rpcRows(data, "variants");
    },

    async finalizeVariantsDeleted(variantIds) {
      const { error } = await client.rpc("mark_media_variants_deleted", { p_variant_ids: variantIds });
      if (error) throw externalError("Could not finalize deleted media variants", error);
    },

    async listSourceCleanupCandidates(before) {
      const { data, error } = await client.rpc("get_media_source_cleanup_candidates", {
        p_before: before,
        p_limit: config.cleanupBatchSize,
      });
      if (error) throw externalError("Could not list media source cleanup candidates", error);
      return rpcRows(data, "candidates");
    },

    async markSourcesDeleted(assetIds) {
      const { error } = await client.rpc("mark_media_sources_deleted", { p_asset_ids: assetIds });
      if (error) throw externalError("Could not mark media sources deleted", error);
    },

    async downloadPrivateObject(bucket, path, destination, signal, maxBytes = config.maxSourceBytes) {
      const { data, error } = await client.storage.from(bucket).createSignedUrl(path, config.signedUrlTtlSeconds);
      if (error || !data?.signedUrl) throw externalError("Could not authorize private source download", error);

      let response;
      try {
        response = await fetch(data.signedUrl, { signal });
      } catch (error) {
        throw new WorkerError(`Could not download private source: ${error.message}`, { retryable: true, cause: error });
      }
      if (!response.ok || !response.body) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new WorkerError(`Private source download returned HTTP ${response.status}`, { retryable });
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new InvalidJobError(`Source exceeds the job limit (${maxBytes} bytes)`);
      }

      let received = 0;
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (received > maxBytes) {
            callback(new InvalidJobError(`Source exceeds the job limit (${maxBytes} bytes)`));
          } else {
            callback(null, chunk);
          }
        },
      });
      await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(destination));
    },

    async uploadImmutable(bucket, path, filePath, contentType) {
      const file = await stat(filePath);
      if (file.size > config.maxOutputBytes) {
        throw new InvalidJobError(`Processed output exceeds MAX_OUTPUT_BYTES (${config.maxOutputBytes})`);
      }
      const { error } = await client.storage.from(bucket).upload(path, createReadStream(filePath), {
        contentType,
        cacheControl: "31536000, immutable",
        upsert: false,
        duplex: "half",
      });
      if (error && !duplicateObject(error)) throw externalError("Could not upload processed media", error);
      return { sizeBytes: file.size, uploaded: !error };
    },

    publicUrl(bucket, path) {
      if (config.publicStorageBaseUrl) {
        return `${config.publicStorageBaseUrl}/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`;
      }
      return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    },

    async deleteObjects(bucket, paths) {
      for (let offset = 0; offset < paths.length; offset += 100) {
        const { error } = await client.storage.from(bucket).remove(paths.slice(offset, offset + 100));
        if (error) throw externalError("Could not delete media objects", error);
      }
    },
  };
}
