const STORAGE_DELETE_BATCH_SIZE = 100;
const DAY_MS = 86_400_000;

export function sourceCleanupCutoff(retentionDays, now = Date.now()) {
  return new Date(Number(now) - retentionDays * DAY_MS).toISOString();
}

function cleanupBatches(candidates, fields, label) {
  const groups = new Map();
  for (const candidate of candidates) {
    if (!candidate?.[fields.id] || !candidate[fields.bucket] || !candidate[fields.path]) {
      throw new Error(`${label} cleanup candidate is missing ${fields.id}, ${fields.bucket}, or ${fields.path}`);
    }
    const bucket = String(candidate[fields.bucket]);
    const entries = groups.get(bucket) ?? [];
    entries.push({ id: String(candidate[fields.id]), path: String(candidate[fields.path]) });
    groups.set(bucket, entries);
  }

  const batches = [];
  for (const [bucket, entries] of groups) {
    for (let offset = 0; offset < entries.length; offset += STORAGE_DELETE_BATCH_SIZE) {
      const batch = entries.slice(offset, offset + STORAGE_DELETE_BATCH_SIZE);
      batches.push({
        bucket,
        paths: [...new Set(batch.map((entry) => entry.path))],
        ids: [...new Set(batch.map((entry) => entry.id))],
      });
    }
  }
  return batches;
}

export function variantCleanupBatches(candidates) {
  return cleanupBatches(candidates, {
    id: "variant_id",
    bucket: "bucket_id",
    path: "object_path",
  }, "Media variant").map(({ ids, ...batch }) => ({ ...batch, variantIds: ids }));
}

export async function cleanupVariantCandidates(candidates, api) {
  const candidateIds = [...new Set(candidates.map((candidate) => {
    if (!candidate?.variant_id) throw new Error("Media variant cleanup candidate is missing variant_id");
    return String(candidate.variant_id);
  }))];
  if (candidateIds.length === 0) return { approved: 0, finalized: 0, failures: [] };

  const approved = await api.tombstoneVariants(candidateIds);
  const failures = [];
  let finalized = 0;
  for (const batch of variantCleanupBatches(approved)) {
    try {
      await api.deleteObjects(batch.bucket, batch.paths);
    } catch (error) {
      failures.push({ ...batch, stage: "delete", error });
      continue;
    }

    try {
      await api.finalizeVariantsDeleted(batch.variantIds);
      finalized += batch.variantIds.length;
    } catch (error) {
      failures.push({ ...batch, stage: "finalize", error });
    }
  }
  return { approved: approved.length, finalized, failures };
}

export function sourceCleanupBatches(candidates) {
  return cleanupBatches(candidates, {
    id: "asset_id",
    bucket: "source_bucket",
    path: "source_path",
  }, "Source").map(({ ids, ...batch }) => ({ ...batch, assetIds: ids }));
}

export async function cleanupSourceCandidates(candidates, api) {
  const failures = [];
  let marked = 0;
  for (const batch of sourceCleanupBatches(candidates)) {
    try {
      await api.deleteObjects(batch.bucket, batch.paths);
    } catch (error) {
      failures.push({ ...batch, stage: "delete", error });
      continue;
    }

    try {
      await api.markSourcesDeleted(batch.assetIds);
      marked += batch.assetIds.length;
    } catch (error) {
      failures.push({ ...batch, stage: "mark", error });
    }
  }
  return { marked, failures };
}
