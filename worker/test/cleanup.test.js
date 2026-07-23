import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanupSourceCandidates,
  cleanupVariantCandidates,
  sourceCleanupBatches,
  sourceCleanupCutoff,
  variantCleanupBatches,
} from "../src/cleanup.js";

test("sourceCleanupCutoff returns an ISO retention cutoff", () => {
  assert.equal(sourceCleanupCutoff(7, Date.parse("2026-07-23T12:00:00.000Z")), "2026-07-16T12:00:00.000Z");
});

test("sourceCleanupBatches groups buckets and caps Storage batches at 100", () => {
  const candidates = Array.from({ length: 205 }, (_, index) => ({
    asset_id: `asset-${index}`,
    source_bucket: "media-sources",
    source_path: `incoming/source-${index}.jpg`,
  }));
  candidates.push({ asset_id: "other", source_bucket: "other-sources", source_path: "source.jpg" });

  const batches = sourceCleanupBatches(candidates);
  assert.deepEqual(batches.map((batch) => batch.paths.length), [100, 100, 5, 1]);
  assert.deepEqual(batches.map((batch) => batch.assetIds.length), [100, 100, 5, 1]);
});

test("source cleanup marks only batches whose Storage deletion succeeded", async () => {
  const marked = [];
  const api = {
    async deleteObjects(bucket) {
      if (bucket === "failed-sources") throw new Error("Storage unavailable");
    },
    async markSourcesDeleted(assetIds) {
      marked.push(...assetIds);
    },
  };
  const result = await cleanupSourceCandidates([
    { asset_id: "failed-asset", source_bucket: "failed-sources", source_path: "failed.jpg" },
    { asset_id: "deleted-asset", source_bucket: "media-sources", source_path: "deleted.jpg" },
  ], api);

  assert.deepEqual(marked, ["deleted-asset"]);
  assert.equal(result.marked, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].stage, "delete");
  assert.deepEqual(result.failures[0].assetIds, ["failed-asset"]);
});

test("source cleanup leaves deleted objects retryable when marking fails", async () => {
  const api = {
    async deleteObjects() {},
    async markSourcesDeleted() {
      throw new Error("Database unavailable");
    },
  };
  const result = await cleanupSourceCandidates([
    { asset_id: "asset", source_bucket: "media-sources", source_path: "source.jpg" },
  ], api);

  assert.equal(result.marked, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].stage, "mark");
});

test("variantCleanupBatches groups approved rows and caps Storage batches at 100", () => {
  const approved = Array.from({ length: 101 }, (_, index) => ({
    variant_id: `variant-${index}`,
    bucket_id: "project-media",
    object_path: `processed/${index}.webp`,
  }));

  const batches = variantCleanupBatches(approved);
  assert.deepEqual(batches.map((batch) => batch.paths.length), [100, 1]);
  assert.deepEqual(batches.map((batch) => batch.variantIds.length), [100, 1]);
});

test("variant cleanup deletes and finalizes only rows approved by tombstoning", async () => {
  const calls = [];
  const api = {
    async tombstoneVariants(ids) {
      calls.push(["tombstone", ids]);
      return [{
        variant_id: "approved",
        bucket_id: "project-media",
        object_path: "canonical/approved.webp",
      }];
    },
    async deleteObjects(bucket, paths) {
      calls.push(["delete", bucket, paths]);
    },
    async finalizeVariantsDeleted(ids) {
      calls.push(["finalize", ids]);
    },
  };

  const result = await cleanupVariantCandidates([
    { variant_id: "approved", bucket_id: "stale", object_path: "stale-path" },
    { variant_id: "newly-referenced", bucket_id: "project-media", object_path: "must-remain.webp" },
  ], api);

  assert.deepEqual(calls, [
    ["tombstone", ["approved", "newly-referenced"]],
    ["delete", "project-media", ["canonical/approved.webp"]],
    ["finalize", ["approved"]],
  ]);
  assert.deepEqual(result, { approved: 1, finalized: 1, failures: [] });
});

test("variant cleanup leaves tombstoned rows retryable after Storage failure", async () => {
  let finalized = false;
  const api = {
    async tombstoneVariants() {
      return [{ variant_id: "variant", bucket_id: "project-media", object_path: "variant.webp" }];
    },
    async deleteObjects() {
      throw new Error("Storage unavailable");
    },
    async finalizeVariantsDeleted() {
      finalized = true;
    },
  };

  const result = await cleanupVariantCandidates([{ variant_id: "variant" }], api);
  assert.equal(finalized, false);
  assert.equal(result.finalized, 0);
  assert.equal(result.failures[0].stage, "delete");
});
