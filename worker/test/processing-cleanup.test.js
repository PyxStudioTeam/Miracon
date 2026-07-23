import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { processMediaJob } from "../src/processors.js";

async function imageFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "media-worker-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source.png");
  await sharp({
    create: { width: 16, height: 16, channels: 4, background: { r: 25, g: 50, b: 75, alpha: 1 } },
  }).png().toFile(source);
  return { directory, source };
}

const job = {
  id: "job-id",
  assetId: "asset-id",
  kind: "image",
  outputBucket: "project-media",
  settings: { image: { widths: [8] }, requestedVariants: [] },
};
const config = { outputPrefix: "processed" };

test("image processing deletes objects uploaded before a later upload fails", async (t) => {
  const fixture = await imageFixture(t);
  const deleted = [];
  let uploadCount = 0;
  const api = {
    async uploadImmutable() {
      uploadCount += 1;
      if (uploadCount === 2) throw new Error("Upload failed");
      return { sizeBytes: 123, uploaded: true };
    },
    publicUrl(_bucket, path) {
      return `https://example.test/${path}`;
    },
    async deleteObjects(bucket, paths) {
      deleted.push({ bucket, paths });
    },
  };

  await assert.rejects(
    processMediaJob(job, fixture.source, fixture.directory, api, config, new AbortController().signal),
    /Upload failed/,
  );
  assert.deepEqual(deleted, [{
    bucket: "project-media",
    paths: ["processed/asset-id/job-id/image/8w.avif"],
  }]);
});

test("processing never deletes a deterministic object that already existed", async (t) => {
  const fixture = await imageFixture(t);
  let deleted = false;
  const api = {
    async uploadImmutable() {
      return { sizeBytes: 123, uploaded: false };
    },
    publicUrl() {
      throw new Error("Could not prepare completion URL");
    },
    async deleteObjects() {
      deleted = true;
    },
  };

  await assert.rejects(
    processMediaJob(job, fixture.source, fixture.directory, api, config, new AbortController().signal),
    /Could not prepare completion URL/,
  );
  assert.equal(deleted, false);
});
