import { join } from "node:path";
import sharp from "sharp";
import { runCommand, probeMedia } from "./command.js";
import { InvalidJobError, WorkerError } from "./errors.js";
import {
  dimensionsAfterOrientation,
  imageOutputPath,
  posterOutputPath,
  responsiveWidths,
  videoOutputPath,
} from "./paths.js";
import { normalizeImageProfile, normalizeVideoProfile, resolveProfileSettings } from "./profiles.js";
import { buildVariant, imageVariantKey, processingResult } from "./variants.js";

export const IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const IMAGE_MAX_INPUT_PIXELS = 40_000_000;
export const IMAGE_MAX_EDGE = 10_000;
const VIDEO_MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const SHARP_INPUT_OPTIONS = Object.freeze({ limitInputPixels: IMAGE_MAX_INPUT_PIXELS });

function safeSharp(input) {
  return sharp(input, SHARP_INPUT_OPTIONS);
}

function first(...values) {
  return values.find((entry) => entry !== undefined && entry !== null && entry !== "");
}

function mediaKind(row) {
  const raw = String(first(row.kind, row.job_type, row.media_type, row.type, row.mime_type) ?? "").toLowerCase();
  if (raw === "image" || raw.startsWith("image/")) return "image";
  if (raw === "video" || raw.startsWith("video/")) return "video";
  throw new InvalidJobError(`Unsupported media job kind: ${raw || "missing"}`);
}

export function normalizeJob(row, config) {
  if (!row || typeof row !== "object") throw new InvalidJobError("Claimed job is not an object");
  const source = row.source && typeof row.source === "object" ? row.source : {};
  const id = first(row.id, row.job_id);
  const assetId = first(row.media_asset_id, row.asset_id, row.media_id);
  const leaseToken = row.lease_token;
  const sourcePath = first(row.source_path, row.storage_path, row.source_storage_path, source.path, source.storage_path);
  if (!id) throw new InvalidJobError("Claimed job has no id");
  if (!assetId) throw new InvalidJobError(`Job ${id} has no media asset id`);
  if (!leaseToken) throw new InvalidJobError(`Job ${id} has no lease token`);
  if (!sourcePath || typeof sourcePath !== "string") throw new InvalidJobError(`Job ${id} has no source path`);
  const kind = mediaKind(row);
  const sourceMaxBytes = kind === "video"
    ? Math.min(config.maxSourceBytes, VIDEO_MAX_SOURCE_BYTES)
    : Math.min(config.maxSourceBytes, IMAGE_MAX_SOURCE_BYTES);
  const sourceSizeBytes = row.source_size_bytes == null ? null : Number(row.source_size_bytes);
  if (sourceSizeBytes != null && (!Number.isSafeInteger(sourceSizeBytes) || sourceSizeBytes < 1)) {
    throw new InvalidJobError(`Job ${id} has an invalid source size`);
  }
  if (sourceSizeBytes != null && sourceSizeBytes > sourceMaxBytes) {
    throw new InvalidJobError(`Source exceeds the ${kind} job limit (${sourceMaxBytes} bytes)`);
  }

  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
  const outputBucket = String(first(row.output_bucket, metadata.output_bucket, config.outputBucket));
  if ((kind === "image" && outputBucket !== "project-media")
    || (kind === "video" && outputBucket !== "project-media" && outputBucket !== "site-media")) {
    throw new InvalidJobError(`Output bucket ${outputBucket} is not allowed for ${kind} jobs`);
  }
  return {
    id: String(id),
    assetId: String(assetId),
    leaseToken: String(leaseToken),
    kind,
    sourceBucket: String(first(row.source_bucket, row.storage_bucket, source.bucket, config.sourceBucket)),
    sourcePath,
    sourceSizeBytes,
    sourceMaxBytes,
    outputBucket,
    settings: resolveProfileSettings(row.metadata, row.requested_variants),
  };
}

async function uploadTracked(api, uploaded, bucket, path, filePath, contentType) {
  const result = await api.uploadImmutable(bucket, path, filePath, contentType);
  if (result?.uploaded) uploaded.push({ bucket, path });
  if (!Number.isSafeInteger(result?.sizeBytes) || result.sizeBytes < 1) {
    throw new WorkerError("Immutable upload returned an invalid object size", { retryable: false });
  }
  return result.sizeBytes;
}

export async function discardUploaded(api, uploaded) {
  const groups = new Map();
  for (const { bucket, path } of uploaded) {
    const paths = groups.get(bucket) ?? [];
    paths.push(path);
    groups.set(bucket, paths);
  }
  for (const [bucket, paths] of groups) {
    try {
      await api.deleteObjects(bucket, paths);
    } catch {
      // The original job error is authoritative; cleanup is retry-safe and best effort.
    }
  }
}

export function validateSourceImage(metadata) {
  const width = Number(metadata?.width);
  const height = Number(metadata?.height);
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new InvalidJobError("Source image dimensions are missing or invalid");
  }
  if (width > IMAGE_MAX_EDGE || height > IMAGE_MAX_EDGE || width * height > IMAGE_MAX_INPUT_PIXELS) {
    throw new InvalidJobError("Image resolution must not exceed 10,000 px per side or 40 megapixels");
  }
  return dimensionsAfterOrientation(width, height, metadata.orientation);
}

async function processImage(job, sourceFile, tempDir, api, config, signal) {
  const profile = normalizeImageProfile(job.settings);
  let metadata;
  try {
    metadata = await safeSharp(sourceFile).metadata();
  } catch (error) {
    throw new InvalidJobError(`Could not decode source image: ${error.message}`, { cause: error });
  }
  const source = validateSourceImage(metadata);
  const widths = responsiveWidths(profile.widths, source.width);
  const variants = [];
  const uploaded = [];

  try {
    for (const width of widths) {
      for (const format of ["avif", "webp"]) {
        signal.throwIfAborted();
        const localFile = join(tempDir, `image-${width}.${format}`);
        let info;
        try {
          let output = safeSharp(sourceFile).rotate().resize({ width, withoutEnlargement: true });
          output = format === "avif"
            ? output.avif({ quality: profile.avifQuality, effort: profile.avifEffort })
            : output.webp({ quality: profile.webpQuality, effort: 5 });
          info = await output.toFile(localFile);
        } catch (error) {
          throw new InvalidJobError(`Could not encode ${format} image: ${error.message}`, { cause: error });
        }

        signal.throwIfAborted();
        const path = imageOutputPath(config.outputPrefix, job.assetId, job.id, width, format);
        const bytes = await uploadTracked(api, uploaded, job.outputBucket, path, localFile, `image/${format}`);
        variants.push(
          buildVariant({
            variantKey: imageVariantKey(info.width, format),
            role: "responsive",
            format,
            mimeType: `image/${format}`,
            width: info.width,
            height: info.height,
            bucketId: job.outputBucket,
            objectPath: path,
            url: api.publicUrl(job.outputBucket, path),
            sizeBytes: bytes,
          }),
        );
      }
    }

    const primary = variants
      .filter((item) => item.metadata.format === profile.primaryFormat)
      .sort((a, b) => b.width - a.width)[0];
    const completion = { variants, result: processingResult(primary.url), uploadedObjects: [...uploaded] };
    signal.throwIfAborted();
    return completion;
  } catch (error) {
    await discardUploaded(api, uploaded);
    throw error;
  }
}

function scaleFilter(maxWidth, maxHeight) {
  return `scale=w='min(iw,${maxWidth})':h='min(ih,${maxHeight})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
}

function videoStream(probe) {
  return probe.streams?.find((stream) => stream.codec_type === "video");
}

function duration(probe) {
  for (const value of [probe.format?.duration, videoStream(probe)?.duration]) {
    const raw = Number(value);
    if (Number.isFinite(raw) && raw >= 0) return raw;
  }
  return null;
}

export function validateSourceVideo(probe, profile) {
  const stream = videoStream(probe);
  if (!stream) throw new InvalidJobError("Source has no video stream");
  const width = Number(stream.width);
  const height = Number(stream.height);
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new InvalidJobError("Source video dimensions are missing or invalid");
  }
  if (width > profile.maxSourceWidth || height > profile.maxSourceHeight) {
    throw new InvalidJobError(
      `Source video dimensions ${width}x${height} exceed profile maximum ${profile.maxSourceWidth}x${profile.maxSourceHeight}`,
    );
  }
  const durationSeconds = duration(probe);
  if (durationSeconds == null || durationSeconds <= 0) {
    throw new InvalidJobError("Source video duration must be readable and positive");
  }
  if (durationSeconds > profile.maxDurationSeconds) {
    throw new InvalidJobError(
      `Source video duration ${durationSeconds}s exceeds profile maximum ${profile.maxDurationSeconds}s`,
    );
  }
  return { width, height, durationSeconds };
}

async function processVideo(job, sourceFile, tempDir, api, config, signal) {
  const profile = normalizeVideoProfile(job.settings);
  const sourceProbe = await probeMedia(sourceFile, config, signal);
  const source = validateSourceVideo(sourceProbe, profile);

  const mp4File = join(tempDir, "video.mp4");
  const posterFile = join(tempDir, "poster.webp");
  await runCommand(
    config.ffmpegPath,
    [
      "-hide_banner", "-loglevel", "error", "-y", "-i", sourceFile,
      "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
      "-vf", scaleFilter(profile.maxWidth, profile.maxHeight),
      "-c:v", "libx264", "-preset", profile.preset, "-crf", String(profile.crf), "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", profile.audioBitrate, "-movflags", "+faststart", mp4File,
    ],
    { timeoutMs: config.commandTimeoutMs, signal },
  );

  const posterAt = Math.min(profile.posterAtSeconds, Math.max(0, source.durationSeconds - 0.05));
  await runCommand(
    config.ffmpegPath,
    [
      "-hide_banner", "-loglevel", "error", "-y", "-ss", String(posterAt), "-i", sourceFile,
      "-map", "0:v:0", "-an", "-frames:v", "1",
      "-vf", scaleFilter(Math.min(profile.posterWidth, profile.maxWidth), profile.maxHeight),
      "-c:v", "libwebp", "-quality", String(profile.posterQuality), "-compression_level", "6", posterFile,
    ],
    { timeoutMs: config.commandTimeoutMs, signal },
  );

  const outputProbe = await probeMedia(mp4File, config, signal);
  const outputVideo = videoStream(outputProbe);
  if (!outputVideo?.width || !outputVideo?.height) throw new WorkerError("Encoded video has no dimensions", { retryable: false });
  let posterMetadata;
  try {
    posterMetadata = await safeSharp(posterFile).metadata();
  } catch (error) {
    throw new WorkerError("Could not inspect encoded poster", { retryable: false, cause: error });
  }
  if (!posterMetadata.width || !posterMetadata.height) throw new WorkerError("Encoded poster has no dimensions", { retryable: false });

  const uploaded = [];
  try {
    signal.throwIfAborted();
    const mp4Path = videoOutputPath(config.outputPrefix, job.assetId, job.id);
    const mp4Bytes = await uploadTracked(api, uploaded, job.outputBucket, mp4Path, mp4File, "video/mp4");
    signal.throwIfAborted();
    const posterPath = posterOutputPath(config.outputPrefix, job.assetId, job.id);
    const posterBytes = await uploadTracked(api, uploaded, job.outputBucket, posterPath, posterFile, "image/webp");
    const videoDuration = duration(outputProbe);
    const mp4Url = api.publicUrl(job.outputBucket, mp4Path);
    const posterUrl = api.publicUrl(job.outputBucket, posterPath);

    const completion = {
      variants: [
        buildVariant({
          variantKey: "video-mp4",
          role: "primary",
          format: "mp4",
          mimeType: "video/mp4",
          width: outputVideo.width,
          height: outputVideo.height,
          metadata: videoDuration == null ? {} : { duration_seconds: videoDuration },
          bucketId: job.outputBucket,
          objectPath: mp4Path,
          url: mp4Url,
          sizeBytes: mp4Bytes,
        }),
        buildVariant({
          variantKey: "poster-webp",
          role: "poster",
          format: "webp",
          mimeType: "image/webp",
          width: posterMetadata.width,
          height: posterMetadata.height,
          bucketId: job.outputBucket,
          objectPath: posterPath,
          url: posterUrl,
          sizeBytes: posterBytes,
        }),
      ],
      result: processingResult(mp4Url),
      uploadedObjects: [...uploaded],
    };
    signal.throwIfAborted();
    return completion;
  } catch (error) {
    await discardUploaded(api, uploaded);
    throw error;
  }
}

export async function processMediaJob(job, sourceFile, tempDir, api, config, signal) {
  if (job.kind === "image") return processImage(job, sourceFile, tempDir, api, config, signal);
  if (job.kind === "video") return processVideo(job, sourceFile, tempDir, api, config, signal);
  throw new InvalidJobError(`Unsupported job kind: ${job.kind}`);
}
