# Media processing worker

An isolated Node 22 ESM worker for Supabase-backed media processing. It claims token-leased jobs, streams private source objects to temporary disk, creates immutable derivatives, completes or fails jobs through RPCs, and periodically removes unreferenced variants and expired source originals selected for cleanup.

## Outputs

- Images: AVIF and WebP at every configured responsive width that is no larger than the orientation-corrected source. If every configured width is larger than the source, one source-width variant is emitted in each format.
- Videos: H.264 (`libx264`) video and AAC audio in a `yuv420p`, fast-start MP4, plus a WebP poster. Scaling preserves aspect ratio, produces dimensions divisible by two, and never upscales.
- Paths: `OUTPUT_PREFIX/<asset-id>/<job-id>/...`. Uploads use one-year immutable caching and `upsert: false`. A retry treats an already-existing deterministic object as successful; it never overwrites or cleanup-deletes it. If processing or completion-result preparation fails after this attempt created some outputs, the worker best-effort deletes only those newly uploaded objects.
- Result: `complete_media_processing_job` receives the variants JSON array and `{ "primary_url": "..." }` as `p_result`. The RPC adds the variants to the persisted result. Image primary format defaults to WebP; video primary URL is the MP4.

If the completion RPC reports an error, the worker queries `media_processing_jobs.status`, `result`, and lease ownership through the service-role client. A completed row is treated as success. Newly uploaded objects are deleted when the RPC response definitely rejected completion under the same active lease, or when authoritative state shows a terminally failed job with no committed variants. Lease-loss reconciliation never deletes for queued or processing rows. Unknown rows, ambiguous/network failures, changed claims, committed variants, and status-query failures retain deterministic outputs for a safe retry.

Each variant has this shape:

```json
{
  "variant_key": "image-1280w-webp",
  "bucket_id": "project-media",
  "object_path": "processed/asset-id/job-id/image/1280w.webp",
  "url": "https://...",
  "mime_type": "image/webp",
  "width": 1280,
  "height": 720,
  "size_bytes": 123456,
  "metadata": {
    "role": "responsive",
    "format": "webp"
  }
}
```

The MP4 variant stores `duration_seconds` in `metadata`. Images may output only to `project-media`; videos may output to `project-media` or `site-media`. The output bucket must be public, or `PUBLIC_STORAGE_BASE_URL` must point at a CDN/public gateway. Expiring signed URLs are deliberately not stored as result URLs.

## Database contract

The worker expects these Supabase RPC signatures. Parameter names are significant to PostgREST.

```sql
claim_media_processing_jobs(
  p_limit integer,
  p_lease_seconds integer
) returns table (
  job_id uuid,
  asset_id uuid,
  lease_token uuid,
  attempt_count integer,
  max_attempts integer,
  source_bucket text,
  source_path text,
  media_type text,
  mime_type text,
  source_size_bytes bigint,
  requested_variants jsonb,
  metadata jsonb
);

renew_media_processing_lease(
  p_job_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer
) returns timestamptz;

complete_media_processing_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_variants jsonb,
  p_result jsonb
);

fail_media_processing_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retryable boolean,
  p_retry_delay_seconds integer
) returns boolean;

get_media_cleanup_candidates(
  p_before timestamptz,
  p_limit integer
) returns table (
  variant_id uuid,
  asset_id uuid,
  bucket_id text,
  object_path text,
  url text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz,
  deleted_at timestamptz
);

tombstone_media_variants(p_variant_ids uuid[]) returns table (
  variant_id uuid,
  asset_id uuid,
  bucket_id text,
  object_path text,
  url text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz,
  deleted_at timestamptz
);

mark_media_variants_deleted(p_variant_ids uuid[]) returns integer;
```

The worker also expects these source-original cleanup RPCs once their migration is deployed:

```sql
get_media_source_cleanup_candidates(
  p_before timestamptz,
  p_limit integer
) returns table (
  asset_id uuid,
  source_bucket text,
  source_path text
);

mark_media_sources_deleted(p_asset_ids uuid[]) returns integer;
```

The processing and variant-cleanup signatures match `202607230001_media_processing.sql`. The worker omits `p_before` for public variant cleanup so that RPC uses its default. It passes an explicit ISO cutoff to source cleanup based on `SOURCE_RETENTION_DAYS`.

Every claimed row supplies:

- `job_id`, `asset_id`, and the ownership credential `lease_token`
- `source_bucket`, `source_path`, `source_size_bytes`, `media_type`, and `mime_type`
- `metadata` and `requested_variants`

The lease token is passed to renew, complete, and fail operations. The worker passes `p_retryable` explicitly. Retryable failures use a null retry delay so the database applies its exponential default; non-retryable failures become terminal immediately.

After a completion error, the worker also performs a service-role `select` of `status`, `result`, `lease_token`, and `lease_expires_at` from `media_processing_jobs`. This read is deliberately worker-only and requires no additional public RPC.

Each cleanup cycle handles public variants first. Candidate listing may return old unreferenced rows or tombstoned rows whose Storage deletion still needs retrying. Before deleting anything, the worker passes only candidate IDs to `tombstone_media_variants`; that RPC serializes against project/homepage saves, atomically rechecks current references, tombstones safe rows, and returns their authoritative paths. The worker deletes only returned rows and then idempotently finalizes successful batches with `mark_media_variants_deleted`. Storage failures leave tombstoned rows eligible for later listing. Project and homepage save RPCs reject incoming URLs for tracked tombstoned variants.

Source-original cleanup runs second. Candidates are grouped by `source_bucket` and deleted in batches of at most 100 objects. Only asset IDs from a successfully deleted batch are passed to `mark_media_sources_deleted`. A failed delete or mark operation leaves those assets eligible for a later retry and does not block independent batches.

## Profiles

Profile settings are resolved from claimed `metadata.profile`, `metadata.profile.settings`, and `metadata.settings`, in that order. Later settings override earlier ones. Settings can use camelCase or the shown snake-case equivalents.

```json
{
  "image": {
    "responsive_widths": [320, 640, 960, 1280, 1600, 1920],
    "avif": { "quality": 52, "effort": 5 },
    "webp_quality": 80,
    "primary_format": "webp"
  }
}
```

For example, the same image profile can be queued in metadata as:

```json
{
  "profile": {
    "settings": {
      "image": {
        "responsive_widths": [320, 640, 1280],
        "webp_quality": 82
      }
    }
  }
}
```

`requested_variants` can override responsive image widths and provide per-kind settings:

```json
[
  { "type": "responsive", "width": 480 },
  { "type": "responsive", "width": 960, "settings": { "avif_quality": 58 } }
]
```

Requested widths take precedence over profile widths. Video entries with `type: "video"` and poster entries with `type: "poster"` similarly merge their direct or nested `settings` into the relevant profile section.

Image safety limits are hard and cannot be relaxed by a profile. Image jobs use at most 20 MiB of source data, every Sharp input is limited to 40,000,000 pixels, and decoded source dimensions must be at most 10,000 px on each edge before orientation or resizing.

```json
{
  "video": {
    "max_source_width": 7680,
    "max_source_height": 4320,
    "max_duration_seconds": 300,
    "max_width": 1920,
    "max_height": 1080,
    "crf": 23,
    "preset": "medium",
    "audio_bitrate": "128k"
  },
  "poster": {
    "at_seconds": 1,
    "width": 1280,
    "quality": 82
  }
}
```

Before either FFmpeg command runs, ffprobe must report a video stream with positive dimensions and a readable, positive duration. `max_source_width`, `max_source_height`, and `max_duration_seconds` reject oversized or excessively long inputs; their defaults are 7680, 4320, and 300 seconds. Profile normalization permits safety ceilings up to 15360x8640 and 86400 seconds. These input limits are independent of the existing `max_width`/`max_height` output scaling settings.

## Configuration

Copy the values from `.env.example` into the deployment's secret/environment configuration. The required variables are:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`MEDIA_SOURCE_BUCKET` defaults to the migration's private `media-sources` bucket and `MEDIA_OUTPUT_BUCKET` defaults to the public `project-media` bucket. `MAX_SOURCE_BYTES` defaults to and cannot exceed the bucket's 200 MiB hard limit. Effective queued and downloaded limits are the lower of this setting and the media-specific ceiling: 20 MiB for images and 50 MiB for videos.

`SOURCE_RETENTION_DAYS` defaults to 7 and controls the `p_before` cutoff sent to `get_media_source_cleanup_candidates`. `WORKER_CONCURRENCY` bounds simultaneous processors. `CLAIM_BATCH_SIZE` must not exceed it so every claimed job starts a lease heartbeat immediately. `MAX_OUTPUT_BYTES` defaults to the public bucket limit of 50 MiB, so oversized encodes fail before upload. FFmpeg/ffprobe execution is bounded by `COMMAND_TIMEOUT_MS`.

The service-role key is backend-only. Put it in the container platform's secret manager, never in an image, source control, browser bundle, log field, or command argument. The worker logs structured JSON and does not log configuration, source signed URLs, or credentials.

## Run

Node 22 and system `ffmpeg`/`ffprobe` are required.

```sh
npm ci
npm test
npm start
```

The process handles `SIGINT` and `SIGTERM` by stopping new claims and cleanup work, retaining lease heartbeats while active jobs finish, cleaning temporary directories, and then exiting.

## Docker

From this directory:

```sh
docker build -t miracon-media-worker .
docker run --rm --env-file .env miracon-media-worker
```

The image installs Debian's system FFmpeg, installs production dependencies with `npm ci`, and runs as the unprivileged `node` user. It has no HTTP listener and is deploy-agnostic across container job/service platforms.
