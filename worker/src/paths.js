import { InvalidJobError } from "./errors.js";

export function cleanPrefix(value) {
  const parts = String(value ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);

  if (parts.some((part) => part === "." || part === "..")) {
    throw new InvalidJobError("Storage prefix cannot contain traversal segments");
  }
  return parts.join("/");
}

export function safeSegment(value, name = "path segment") {
  const result = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!result || /^\.+$/.test(result)) {
    throw new InvalidJobError(`Invalid ${name}`);
  }
  return result;
}

export function outputBasePath(prefix, assetId, jobId) {
  return [
    cleanPrefix(prefix),
    safeSegment(assetId, "asset id"),
    safeSegment(jobId, "job id"),
  ]
    .filter(Boolean)
    .join("/");
}

export function imageOutputPath(prefix, assetId, jobId, width, format) {
  if (!Number.isInteger(width) || width < 1) {
    throw new InvalidJobError("Image output width must be a positive integer");
  }
  if (format !== "avif" && format !== "webp") {
    throw new InvalidJobError(`Unsupported image format: ${format}`);
  }
  return `${outputBasePath(prefix, assetId, jobId)}/image/${width}w.${format}`;
}

export function videoOutputPath(prefix, assetId, jobId) {
  return `${outputBasePath(prefix, assetId, jobId)}/video/video.mp4`;
}

export function posterOutputPath(prefix, assetId, jobId) {
  return `${outputBasePath(prefix, assetId, jobId)}/video/poster.webp`;
}

export function dimensionsAfterOrientation(width, height, orientation) {
  return orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

export function responsiveWidths(requestedWidths, sourceWidth) {
  if (!Number.isInteger(sourceWidth) || sourceWidth < 1) {
    throw new InvalidJobError("Source image width is invalid");
  }
  const widths = [...new Set(requestedWidths)]
    .filter((width) => Number.isInteger(width) && width > 0 && width <= sourceWidth)
    .sort((a, b) => a - b);
  return widths.length > 0 ? widths : [sourceWidth];
}
