import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transferSnapshotMedia } from './migration/media-transfer.mjs';
import { createSupabaseSourceClient } from './migration/supabase-source.mjs';
import { createSupabaseStorageDownloader } from './migration/supabase-storage-downloader.mjs';

const USAGE = 'Usage: node scripts/supabase-media-transfer.mjs --input=DIR --media-root=ABSOLUTE_DIR --state=ABSOLUTE_FILE [--dry-run] [--resume]';

export class SupabaseMediaTransferError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SupabaseMediaTransferError';
  }
}

export function parseMediaTransferArguments(argumentsList) {
  const options = { dryRun: false, resume: false };
  for (const argument of argumentsList) {
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--resume') options.resume = true;
    else if (argument.startsWith('--input=') && !options.input) options.input = argument.slice(8);
    else if (argument.startsWith('--media-root=') && !options.mediaRoot) options.mediaRoot = argument.slice(13);
    else if (argument.startsWith('--state=') && !options.statePath) options.statePath = argument.slice(8);
    else throw new SupabaseMediaTransferError(USAGE);
  }
  if (!options.input || !options.mediaRoot || !options.statePath) throw new SupabaseMediaTransferError(USAGE);
  if (!isAbsolute(options.mediaRoot) || !isAbsolute(options.statePath)) {
    throw new SupabaseMediaTransferError('--media-root and --state must be absolute paths');
  }
  return options;
}

function summarize(snapshot, result, options) {
  const completed = result.candidates.filter(({ status }) => status === 'completed').length;
  return {
    snapshotId: snapshot.snapshotId,
    dryRun: options.dryRun,
    resume: options.resume,
    candidates: result.candidates.length,
    completed,
    pending: result.candidates.length - completed,
    urlRewrites: Object.keys(result.urlRewriteMap).length,
  };
}

export async function runMediaTransferCli(argumentsList, environment, dependencies = {}) {
  const options = parseMediaTransferArguments(argumentsList);
  const snapshot = JSON.parse(await readFile(join(resolve(options.input), 'snapshot.json'), 'utf8'));
  if (options.dryRun) {
    const result = await transferSnapshotMedia({ snapshot, mediaRoot: options.mediaRoot, statePath: options.statePath, dryRun: true, resume: options.resume });
    return summarize(snapshot, result, options);
  }
  const sourceUrl = environment.SUPABASE_SOURCE_URL;
  const serviceRoleKey = environment.SUPABASE_SOURCE_SERVICE_ROLE_KEY;
  if (!sourceUrl || !serviceRoleKey) {
    throw new SupabaseMediaTransferError('SUPABASE_SOURCE_URL and SUPABASE_SOURCE_SERVICE_ROLE_KEY are required');
  }
  const createSourceClient = dependencies.createSourceClient ?? createSupabaseSourceClient;
  const client = createSourceClient(sourceUrl, serviceRoleKey);
  const downloader = createSupabaseStorageDownloader(client);
  const result = await transferSnapshotMedia({ snapshot, mediaRoot: options.mediaRoot, statePath: options.statePath, downloader, resume: options.resume });
  return summarize(snapshot, result, options);
}

async function main() {
  console.log(JSON.stringify(await runMediaTransferCli(process.argv.slice(2), process.env)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof SupabaseMediaTransferError ? error.message : 'Supabase media transfer failed');
    process.exitCode = 1;
  });
}
