import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanPrefix,
  dimensionsAfterOrientation,
  imageOutputPath,
  outputBasePath,
  posterOutputPath,
  responsiveWidths,
  safeSegment,
  videoOutputPath,
} from "../src/paths.js";

test("cleanPrefix normalizes separators and rejects traversal", () => {
  assert.equal(cleanPrefix("/processed\\media/"), "processed/media");
  assert.throws(() => cleanPrefix("processed/../private"), /traversal/);
});

test("safeSegment creates storage-safe identifiers", () => {
  assert.equal(safeSegment(" job id:123 "), "job-id-123");
  assert.throws(() => safeSegment("..."), /Invalid/);
});

test("output helpers produce deterministic job-scoped paths", () => {
  assert.equal(outputBasePath("processed", "asset-1", "job-2"), "processed/asset-1/job-2");
  assert.equal(imageOutputPath("processed", "asset-1", "job-2", 640, "avif"), "processed/asset-1/job-2/image/640w.avif");
  assert.equal(videoOutputPath("processed", "asset-1", "job-2"), "processed/asset-1/job-2/video/video.mp4");
  assert.equal(posterOutputPath("processed", "asset-1", "job-2"), "processed/asset-1/job-2/video/poster.webp");
});

test("imageOutputPath rejects unsupported formats", () => {
  assert.throws(() => imageOutputPath("processed", "asset", "job", 640, "jpeg"), /Unsupported/);
});

test("responsiveWidths deduplicates, sorts, and never upscales", () => {
  assert.deepEqual(responsiveWidths([1280, 320, 640, 640, 1920], 1000), [320, 640]);
  assert.deepEqual(responsiveWidths([1280, 1920], 900), [900]);
});

test("dimensionsAfterOrientation accounts for rotated EXIF dimensions", () => {
  assert.deepEqual(dimensionsAfterOrientation(1200, 800, 1), { width: 1200, height: 800 });
  assert.deepEqual(dimensionsAfterOrientation(1200, 800, 6), { width: 800, height: 1200 });
});
