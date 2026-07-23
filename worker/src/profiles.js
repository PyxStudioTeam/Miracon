import { InvalidJobError } from "./errors.js";

const IMAGE_DEFAULTS = Object.freeze({
  widths: [320, 640, 960, 1280, 1600, 1920],
  avifQuality: 52,
  avifEffort: 5,
  webpQuality: 80,
  primaryFormat: "webp",
});

const VIDEO_DEFAULTS = Object.freeze({
  maxSourceWidth: 7680,
  maxSourceHeight: 4320,
  maxDurationSeconds: 300,
  maxWidth: 1920,
  maxHeight: 1080,
  crf: 23,
  preset: "medium",
  audioBitrate: "128k",
  posterAtSeconds: 1,
  posterWidth: 1280,
  posterQuality: 82,
});

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function value(source, camel, snake = camel) {
  return source[camel] ?? source[snake];
}

function integer(input, fallback, name, min, max) {
  const result = input ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new InvalidJobError(`${name} must be an integer from ${min} to ${max}`);
  }
  return result;
}

function number(input, fallback, name, min, max) {
  const result = input ?? fallback;
  if (typeof result !== "number" || !Number.isFinite(result) || result < min || result > max) {
    throw new InvalidJobError(`${name} must be a number from ${min} to ${max}`);
  }
  return result;
}

export function parseProfileSettings(input) {
  if (input == null || input === "") return {};
  if (typeof input === "string") {
    try {
      return object(JSON.parse(input));
    } catch (error) {
      throw new InvalidJobError("Profile settings are not valid JSON", { cause: error });
    }
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidJobError("Profile settings must be an object");
  }
  return input;
}

export function parseRequestedVariants(input) {
  if (input == null || input === "") return [];
  let variants = input;
  if (typeof input === "string") {
    try {
      variants = JSON.parse(input);
    } catch (error) {
      throw new InvalidJobError("Requested variants are not valid JSON", { cause: error });
    }
  }
  if (!Array.isArray(variants)) throw new InvalidJobError("Requested variants must be an array");
  if (variants.length > 100) throw new InvalidJobError("Requested variants cannot contain more than 100 entries");
  return variants;
}

export function resolveProfileSettings(metadataInput, requestedVariantsInput) {
  const metadata = parseProfileSettings(metadataInput);
  const profile = parseProfileSettings(metadata.profile);
  const profileSettings = parseProfileSettings(profile.settings);
  const settings = parseProfileSettings(metadata.settings);

  return {
    ...profile,
    ...profileSettings,
    ...settings,
    image: { ...object(profile.image), ...object(profileSettings.image), ...object(settings.image) },
    video: { ...object(profile.video), ...object(profileSettings.video), ...object(settings.video) },
    poster: { ...object(profile.poster), ...object(profileSettings.poster), ...object(settings.poster) },
    requestedVariants: parseRequestedVariants(requestedVariantsInput),
  };
}

function requestedSettings(variants, section) {
  let result = {};
  for (const entry of variants) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const settings = object(entry.settings);
    result = { ...result, ...object(entry[section]), ...object(settings[section]) };
    const type = String(entry.type ?? entry.kind ?? entry.role ?? entry.variant_key ?? "").toLowerCase();
    const matches = section === "image"
      ? type === "" || type === "image" || type === "responsive"
      : section === "video"
        ? type === "" || type === "video" || type === "primary" || type === "video-mp4"
        : type === "poster";
    if (matches) result = { ...result, ...entry, ...settings };
  }
  return result;
}

function requestedImageWidths(variants) {
  const widths = [];
  for (const entry of variants) {
    if (Number.isInteger(entry)) {
      widths.push(entry);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const type = String(entry.type ?? entry.kind ?? entry.role ?? entry.variant_key ?? "").toLowerCase();
    if (type === "poster" || type === "video") continue;
    const settings = object(entry.settings);
    const image = { ...object(entry.image), ...object(settings.image) };
    for (const width of [entry.width, settings.width, image.width]) {
      if (width != null) widths.push(width);
    }
    for (const list of [entry.widths, entry.responsive_widths, settings.widths, settings.responsive_widths, image.widths, image.responsive_widths]) {
      if (Array.isArray(list)) widths.push(...list);
    }
  }
  return widths;
}

export function normalizeImageProfile(input) {
  const root = parseProfileSettings(input);
  const requested = requestedSettings(root.requestedVariants ?? [], "image");
  const settings = { ...root, ...object(root.image), ...requested };
  const avif = object(settings.avif);
  const webp = object(settings.webp);
  const requestedWidths = requestedImageWidths(root.requestedVariants ?? []);
  const rawWidths = requestedWidths.length > 0
    ? requestedWidths
    : value(settings, "widths", "responsive_widths") ?? IMAGE_DEFAULTS.widths;
  if (!Array.isArray(rawWidths) || rawWidths.length === 0 || rawWidths.length > 20) {
    throw new InvalidJobError("Image widths must contain 1 to 20 values");
  }
  const widths = [...new Set(rawWidths.map((width) => integer(width, 0, "Image width", 1, 16384)))]
    .sort((a, b) => a - b);
  const primaryFormat = value(settings, "primaryFormat", "primary_format") ?? IMAGE_DEFAULTS.primaryFormat;
  if (primaryFormat !== "avif" && primaryFormat !== "webp") {
    throw new InvalidJobError("Image primaryFormat must be avif or webp");
  }

  return {
    widths,
    avifQuality: integer(
      value(settings, "avifQuality", "avif_quality") ?? avif.quality,
      IMAGE_DEFAULTS.avifQuality,
      "AVIF quality",
      1,
      100,
    ),
    avifEffort: integer(
      value(settings, "avifEffort", "avif_effort") ?? avif.effort,
      IMAGE_DEFAULTS.avifEffort,
      "AVIF effort",
      0,
      9,
    ),
    webpQuality: integer(
      value(settings, "webpQuality", "webp_quality") ?? webp.quality,
      IMAGE_DEFAULTS.webpQuality,
      "WebP quality",
      1,
      100,
    ),
    primaryFormat,
  };
}

export function normalizeVideoProfile(input) {
  const root = parseProfileSettings(input);
  const settings = { ...root, ...object(root.video), ...requestedSettings(root.requestedVariants ?? [], "video") };
  const poster = {
    ...object(root.poster),
    ...object(settings.poster),
    ...requestedSettings(root.requestedVariants ?? [], "poster"),
  };
  const preset = value(settings, "preset") ?? VIDEO_DEFAULTS.preset;
  const presets = new Set(["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"]);
  if (!presets.has(preset)) throw new InvalidJobError("Video preset is invalid");

  const audioBitrate = value(settings, "audioBitrate", "audio_bitrate") ?? VIDEO_DEFAULTS.audioBitrate;
  if (typeof audioBitrate !== "string" || !/^\d{2,4}k$/.test(audioBitrate)) {
    throw new InvalidJobError("Video audioBitrate must look like 128k");
  }

  return {
    maxSourceWidth: integer(
      value(settings, "maxSourceWidth", "max_source_width"),
      VIDEO_DEFAULTS.maxSourceWidth,
      "Video maxSourceWidth",
      2,
      15360,
    ),
    maxSourceHeight: integer(
      value(settings, "maxSourceHeight", "max_source_height"),
      VIDEO_DEFAULTS.maxSourceHeight,
      "Video maxSourceHeight",
      2,
      8640,
    ),
    maxDurationSeconds: number(
      value(settings, "maxDurationSeconds", "max_duration_seconds"),
      VIDEO_DEFAULTS.maxDurationSeconds,
      "Video maxDurationSeconds",
      0.1,
      86400,
    ),
    maxWidth: integer(value(settings, "maxWidth", "max_width"), VIDEO_DEFAULTS.maxWidth, "Video maxWidth", 2, 7680),
    maxHeight: integer(value(settings, "maxHeight", "max_height"), VIDEO_DEFAULTS.maxHeight, "Video maxHeight", 2, 4320),
    crf: integer(value(settings, "crf"), VIDEO_DEFAULTS.crf, "Video CRF", 0, 51),
    preset,
    audioBitrate,
    posterAtSeconds: number(
      value(settings, "posterAtSeconds", "poster_at_seconds") ?? value(poster, "atSeconds", "at_seconds"),
      VIDEO_DEFAULTS.posterAtSeconds,
      "Poster timestamp",
      0,
      86400,
    ),
    posterWidth: integer(
      value(settings, "posterWidth", "poster_width") ?? value(poster, "width"),
      VIDEO_DEFAULTS.posterWidth,
      "Poster width",
      2,
      7680,
    ),
    posterQuality: integer(
      value(settings, "posterQuality", "poster_quality") ?? value(poster, "quality"),
      VIDEO_DEFAULTS.posterQuality,
      "Poster quality",
      1,
      100,
    ),
  };
}
