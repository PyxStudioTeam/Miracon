import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { cleanPrefix } from "./paths.js";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function text(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function integer(name, fallback, { min, max }) {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function url(name, fallback = "") {
  const value = text(name, fallback);
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
}

export function loadConfig() {
  const leaseSeconds = integer("LEASE_SECONDS", 300, { min: 30, max: 3600 });
  const leaseRenewIntervalMs = integer("LEASE_RENEW_INTERVAL_MS", Math.floor((leaseSeconds * 1000) / 3), {
    min: 5000,
    max: 3_000_000,
  });
  if (leaseRenewIntervalMs >= leaseSeconds * 1000) {
    throw new Error("LEASE_RENEW_INTERVAL_MS must be shorter than LEASE_SECONDS");
  }

  const concurrency = integer("WORKER_CONCURRENCY", 2, { min: 1, max: 32 });
  const claimBatchSize = integer("CLAIM_BATCH_SIZE", concurrency, { min: 1, max: 100 });
  if (claimBatchSize > concurrency) {
    throw new Error("CLAIM_BATCH_SIZE cannot exceed WORKER_CONCURRENCY, so claimed jobs never wait without a heartbeat");
  }

  const supabaseUrl = url("SUPABASE_URL", required("SUPABASE_URL"));
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey.length < 20) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not valid");

  return Object.freeze({
    supabaseUrl,
    serviceRoleKey,
    workerId: text("WORKER_ID", `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`),
    sourceBucket: text("MEDIA_SOURCE_BUCKET", "media-sources"),
    outputBucket: text("MEDIA_OUTPUT_BUCKET", "project-media"),
    outputPrefix: cleanPrefix(text("OUTPUT_PREFIX", "processed")),
    publicStorageBaseUrl: url("PUBLIC_STORAGE_BASE_URL"),
    concurrency,
    claimBatchSize,
    pollIntervalMs: integer("POLL_INTERVAL_MS", 3000, { min: 250, max: 300_000 }),
    leaseSeconds,
    leaseRenewIntervalMs,
    cleanupIntervalMs: integer("CLEANUP_INTERVAL_MS", 300_000, { min: 10_000, max: 86_400_000 }),
    cleanupBatchSize: integer("CLEANUP_BATCH_SIZE", 100, { min: 1, max: 1000 }),
    sourceRetentionDays: integer("SOURCE_RETENTION_DAYS", 7, { min: 1, max: 3650 }),
    signedUrlTtlSeconds: integer("SIGNED_URL_TTL_SECONDS", 3600, { min: 60, max: 86_400 }),
    maxSourceBytes: integer("MAX_SOURCE_BYTES", 209_715_200, { min: 1_048_576, max: 209_715_200 }),
    maxOutputBytes: integer("MAX_OUTPUT_BYTES", 52_428_800, { min: 1_048_576, max: 52_428_800 }),
    commandTimeoutMs: integer("COMMAND_TIMEOUT_MS", 7_200_000, { min: 10_000, max: 86_400_000 }),
    ffmpegPath: text("FFMPEG_PATH", "ffmpeg"),
    ffprobePath: text("FFPROBE_PATH", "ffprobe"),
  });
}
