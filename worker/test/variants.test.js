import test from "node:test";
import assert from "node:assert/strict";
import { buildVariant, imageVariantKey, processingResult } from "../src/variants.js";

test("buildVariant emits the exact completion RPC record shape", () => {
  const variant = buildVariant({
    variantKey: imageVariantKey(640, "webp"),
    role: "responsive",
    format: "webp",
    mimeType: "image/webp",
    width: 640,
    height: 360,
    bucketId: "project-media",
    objectPath: "processed/asset/job/image/640w.webp",
    url: "https://example.test/640w.webp",
    sizeBytes: 1234,
  });

  assert.deepEqual(variant, {
    variant_key: "image-640w-webp",
    bucket_id: "project-media",
    object_path: "processed/asset/job/image/640w.webp",
    url: "https://example.test/640w.webp",
    mime_type: "image/webp",
    width: 640,
    height: 360,
    size_bytes: 1234,
    metadata: { role: "responsive", format: "webp" },
  });
});

test("processingResult emits primary_url for p_result", () => {
  assert.deepEqual(processingResult("https://example.test/video.mp4"), {
    primary_url: "https://example.test/video.mp4",
  });
});
