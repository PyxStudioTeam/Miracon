import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IMAGE_MAX_EDGE,
  IMAGE_MAX_INPUT_PIXELS,
  processMediaJob,
  validateSourceImage,
} from "../src/processors.js";

test("source image validation enforces browser dimension limits before orientation", () => {
  assert.deepEqual(validateSourceImage({ width: 8000, height: 5000, orientation: 6 }), {
    width: 5000,
    height: 8000,
  });
  assert.throws(
    () => validateSourceImage({ width: IMAGE_MAX_EDGE + 1, height: 1 }),
    /10,000 px per side or 40 megapixels/,
  );
  assert.throws(
    () => validateSourceImage({ width: 8001, height: 5000 }),
    /10,000 px per side or 40 megapixels/,
  );
  assert.equal(IMAGE_MAX_INPUT_PIXELS, 40_000_000);
});

test("Sharp metadata decode applies the 40 megapixel input limit", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "media-worker-image-limit-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "oversized.svg");
  await writeFile(source, '<svg xmlns="http://www.w3.org/2000/svg" width="7000" height="6000"></svg>');

  const api = {
    async uploadImmutable() {
      throw new Error("Upload must not be reached");
    },
  };
  const job = {
    id: "job-id",
    assetId: "asset-id",
    kind: "image",
    outputBucket: "project-media",
    settings: { image: { widths: [320] }, requestedVariants: [] },
  };

  await assert.rejects(
    processMediaJob(job, source, directory, api, { outputPrefix: "processed" }, new AbortController().signal),
    /pixel limit/,
  );
});
