import test from "node:test";
import assert from "node:assert/strict";
import { validateSourceVideo } from "../src/processors.js";
import { normalizeVideoProfile } from "../src/profiles.js";

const profile = normalizeVideoProfile({});

function probe({ width = 1920, height = 1080, duration = "60.5" } = {}) {
  return {
    streams: [{ codec_type: "video", width, height }],
    format: { duration },
  };
}

test("source video safety validation accepts readable dimensions and duration", () => {
  assert.deepEqual(validateSourceVideo(probe(), profile), {
    width: 1920,
    height: 1080,
    durationSeconds: 60.5,
  });
});

test("source video safety validation requires dimensions", () => {
  assert.throws(() => validateSourceVideo(probe({ width: null }), profile), /dimensions/);
  assert.throws(() => validateSourceVideo({ streams: [], format: { duration: 10 } }, profile), /video stream/);
});

test("source video safety validation rejects dimensions over profile limits", () => {
  assert.throws(() => validateSourceVideo(probe({ width: 7681 }), profile), /exceed profile maximum/);
  assert.throws(() => validateSourceVideo(probe({ height: 4321 }), profile), /exceed profile maximum/);
});

test("source video safety validation requires a positive readable duration", () => {
  assert.throws(() => validateSourceVideo(probe({ duration: "N/A" }), profile), /readable and positive/);
  assert.throws(() => validateSourceVideo(probe({ duration: 0 }), profile), /readable and positive/);
});

test("source video safety validation rejects duration over profile limit", () => {
  assert.throws(() => validateSourceVideo(probe({ duration: 300.01 }), profile), /exceeds profile maximum/);
});
