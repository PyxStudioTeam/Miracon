import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoSymlinks } from './migration/media-filesystem.mjs';
import { verifyMediaState } from './migration/media-state-verifier.mjs';

const USAGE = 'Usage: node scripts/verify-media-state.mjs --media-root=ABSOLUTE_DIR --state=ABSOLUTE_FILE';

export class MediaStateVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MediaStateVerificationError';
  }
}

export function parseVerifyMediaArguments(argumentsList) {
  const options = {};
  for (const argument of argumentsList) {
    if (argument.startsWith('--media-root=') && !options.mediaRoot) options.mediaRoot = argument.slice(13);
    else if (argument.startsWith('--state=') && !options.statePath) options.statePath = argument.slice(8);
    else throw new MediaStateVerificationError(USAGE);
  }
  if (!options.mediaRoot || !options.statePath) throw new MediaStateVerificationError(USAGE);
  if (!isAbsolute(options.mediaRoot) || !isAbsolute(options.statePath)) throw new MediaStateVerificationError('--media-root and --state must be absolute paths');
  return options;
}

async function readState(path) {
  await assertNoSymlinks(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return JSON.parse(await handle.readFile('utf8'));
  } finally {
    await handle.close();
  }
}

export async function runVerifyMediaCli(argumentsList) {
  const options = parseVerifyMediaArguments(argumentsList);
  return verifyMediaState({ mediaRoot: options.mediaRoot, mediaState: await readState(options.statePath) });
}

async function main() {
  console.log(JSON.stringify(await runVerifyMediaCli(process.argv.slice(2))));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Media state verification failed');
    process.exitCode = 1;
  });
}
