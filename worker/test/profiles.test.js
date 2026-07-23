import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeImageProfile,
  normalizeVideoProfile,
  parseProfileSettings,
  parseRequestedVariants,
  resolveProfileSettings,
} from "../src/profiles.js";

test("image profile applies defaults", () => {
  assert.deepEqual(normalizeImageProfile({}), {
    widths: [320, 640, 960, 1280, 1600, 1920],
    avifQuality: 52,
    avifEffort: 5,
    webpQuality: 80,
    primaryFormat: "webp",
  });
});

test("image profile accepts nested and snake-case settings", () => {
  assert.deepEqual(
    normalizeImageProfile({
      image: {
        responsive_widths: [1200, 400, 400],
        avif: { quality: 60, effort: 7 },
        webp_quality: 85,
        primary_format: "avif",
      },
    }),
    { widths: [400, 1200], avifQuality: 60, avifEffort: 7, webpQuality: 85, primaryFormat: "avif" },
  );
});

test("image profile rejects unsafe width sets", () => {
  assert.throws(() => normalizeImageProfile({ widths: [] }), /1 to 20/);
  assert.throws(() => normalizeImageProfile({ widths: [0, 640] }), /Image width/);
});

test("video profile accepts nested poster and encoding settings", () => {
  assert.deepEqual(
    normalizeVideoProfile({
      video: { max_width: 1280, max_height: 720, crf: 21, preset: "slow", audio_bitrate: "192k" },
      poster: { at_seconds: 2.5, width: 960, quality: 88 },
    }),
    {
      maxSourceWidth: 7680,
      maxSourceHeight: 4320,
      maxDurationSeconds: 300,
      maxWidth: 1280,
      maxHeight: 720,
      crf: 21,
      preset: "slow",
      audioBitrate: "192k",
      posterAtSeconds: 2.5,
      posterWidth: 960,
      posterQuality: 88,
    },
  );
});

test("video profile validates ffmpeg arguments", () => {
  assert.throws(() => normalizeVideoProfile({ preset: "surprise" }), /preset/);
  assert.throws(() => normalizeVideoProfile({ audioBitrate: "unlimited" }), /audioBitrate/);
  assert.throws(() => normalizeVideoProfile({ crf: 52 }), /CRF/);
});

test("video profile normalizes configurable source safety limits", () => {
  const profile = normalizeVideoProfile({
    max_source_width: 4096,
    max_source_height: 2160,
    max_duration_seconds: 120.5,
  });
  assert.equal(profile.maxSourceWidth, 4096);
  assert.equal(profile.maxSourceHeight, 2160);
  assert.equal(profile.maxDurationSeconds, 120.5);
});

test("video profile rejects source safety limits outside hard bounds", () => {
  assert.throws(() => normalizeVideoProfile({ maxSourceWidth: 1 }), /maxSourceWidth/);
  assert.throws(() => normalizeVideoProfile({ maxSourceWidth: 15361 }), /maxSourceWidth/);
  assert.throws(() => normalizeVideoProfile({ maxSourceHeight: 8641 }), /maxSourceHeight/);
  assert.throws(() => normalizeVideoProfile({ maxDurationSeconds: 0 }), /maxDurationSeconds/);
  assert.throws(() => normalizeVideoProfile({ maxDurationSeconds: 86401 }), /maxDurationSeconds/);
});

test("parseProfileSettings parses JSON without accepting arrays", () => {
  assert.deepEqual(parseProfileSettings('{"widths":[640]}'), { widths: [640] });
  assert.throws(() => parseProfileSettings("not-json"), /valid JSON/);
  assert.throws(() => parseProfileSettings([]), /object/);
});

test("claimed metadata and requested variants resolve into image settings", () => {
  const settings = resolveProfileSettings(
    {
      profile: {
        image: { widths: [300, 600] },
        settings: { image: { avif_quality: 60 } },
      },
      settings: { image: { webp_quality: 86 } },
    },
    [{ type: "responsive", width: 480, settings: { avif_quality: 62 } }],
  );

  assert.deepEqual(normalizeImageProfile(settings), {
    widths: [480],
    avifQuality: 62,
    avifEffort: 5,
    webpQuality: 86,
    primaryFormat: "webp",
  });
});

test("requested video and poster settings override metadata profile settings", () => {
  const settings = resolveProfileSettings(
    { profile: { video: { max_width: 1920 }, poster: { width: 1280 } } },
    [
      { type: "video", settings: { max_width: 1024, crf: 20 } },
      { type: "poster", settings: { width: 800, quality: 90 } },
    ],
  );
  const profile = normalizeVideoProfile(settings);
  assert.equal(profile.maxWidth, 1024);
  assert.equal(profile.crf, 20);
  assert.equal(profile.posterWidth, 800);
  assert.equal(profile.posterQuality, 90);
});

test("parseRequestedVariants validates JSON arrays", () => {
  assert.deepEqual(parseRequestedVariants('[{"width":640}]'), [{ width: 640 }]);
  assert.throws(() => parseRequestedVariants("{}"), /must be an array/);
  assert.throws(() => parseRequestedVariants("not-json"), /valid JSON/);
});
