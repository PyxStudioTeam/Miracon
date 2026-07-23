export function buildVariant({
  variantKey,
  role,
  format,
  mimeType,
  width,
  height,
  bucketId,
  objectPath,
  url,
  sizeBytes,
  metadata = {},
}) {
  return {
    variant_key: variantKey,
    bucket_id: bucketId,
    object_path: objectPath,
    url,
    mime_type: mimeType,
    width,
    height,
    size_bytes: sizeBytes,
    metadata: { ...metadata, role, format },
  };
}

export function imageVariantKey(width, format) {
  return `image-${width}w-${format}`;
}

export function processingResult(primaryUrl) {
  return { primary_url: primaryUrl };
}
