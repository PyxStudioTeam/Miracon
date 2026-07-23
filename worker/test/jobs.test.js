import test from "node:test";
import assert from "node:assert/strict";
import { normalizeJob } from "../src/processors.js";
import { normalizeImageProfile } from "../src/profiles.js";

const config = {
  sourceBucket: "media-sources",
  outputBucket: "project-media",
  maxSourceBytes: 209_715_200,
};

test("normalizeJob reads the exact claimed row contract", () => {
  const job = normalizeJob({
    job_id: "11111111-1111-1111-1111-111111111111",
    asset_id: "22222222-2222-2222-2222-222222222222",
    lease_token: "33333333-3333-3333-3333-333333333333",
    source_bucket: "media-sources",
    source_path: "incoming/source.png",
    source_size_bytes: 1024,
    media_type: "image",
    mime_type: "image/png",
    metadata: { output_bucket: "project-media", profile: { settings: { image: { widths: [320] } } } },
    requested_variants: [{ type: "responsive", width: 640 }],
  }, config);

  assert.equal(job.id, "11111111-1111-1111-1111-111111111111");
  assert.equal(job.assetId, "22222222-2222-2222-2222-222222222222");
  assert.equal(job.leaseToken, "33333333-3333-3333-3333-333333333333");
  assert.equal(job.sourceBucket, "media-sources");
  assert.equal(job.outputBucket, "project-media");
  assert.equal(job.sourceMaxBytes, 20 * 1024 * 1024);
  assert.deepEqual(normalizeImageProfile(job.settings).widths, [640]);
});

test("normalizeJob requires a lease token and enforces the 20 MiB image source limit", () => {
  const base = {
    job_id: "job",
    asset_id: "asset",
    source_bucket: "media-sources",
    source_path: "incoming/source.png",
    media_type: "image",
    metadata: {},
    requested_variants: [],
  };
  assert.throws(() => normalizeJob(base, config), /lease token/);
  assert.throws(
    () => normalizeJob({ ...base, lease_token: "lease", source_size_bytes: 20 * 1024 * 1024 + 1 }, config),
    /image job limit/,
  );
});

test("normalizeJob keeps a lower configured source limit for images", () => {
  const job = normalizeJob({
    job_id: "job",
    asset_id: "asset",
    lease_token: "lease",
    source_path: "incoming/source.png",
    source_size_bytes: 10 * 1024 * 1024,
    media_type: "image",
    metadata: {},
    requested_variants: [],
  }, { ...config, maxSourceBytes: 10 * 1024 * 1024 });

  assert.equal(job.sourceMaxBytes, 10 * 1024 * 1024);
});

test("normalizeJob enforces output buckets and the 50 MiB video source limit", () => {
  const base = {
    job_id: "job",
    asset_id: "asset",
    lease_token: "lease",
    source_bucket: "media-sources",
    source_path: "incoming/source.mp4",
    media_type: "video",
    requested_variants: [],
  };

  const video = normalizeJob({
    ...base,
    source_size_bytes: 50 * 1024 * 1024,
    metadata: { output_bucket: "site-media" },
  }, config);
  assert.equal(video.outputBucket, "site-media");
  assert.equal(video.sourceMaxBytes, 50 * 1024 * 1024);

  assert.throws(
    () => normalizeJob({ ...base, source_size_bytes: 50 * 1024 * 1024 + 1, metadata: {} }, config),
    /video job limit/,
  );
  assert.throws(
    () => normalizeJob({ ...base, source_size_bytes: 1024, metadata: { output_bucket: "other-media" } }, config),
    /not allowed/,
  );
  assert.throws(
    () => normalizeJob({ ...base, media_type: "image", source_size_bytes: 1024, metadata: { output_bucket: "site-media" } }, config),
    /not allowed/,
  );
});
