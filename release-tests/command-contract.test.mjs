import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('keeps default tests deterministic and separates Vitest from Node discovery', () => {
  // Given / When
  const scripts = packageJson.scripts;

  // Then
  assert.equal(scripts.test, 'npm run test:vitest && npm run test:node');
  assert.equal(scripts['test:vitest'], 'npm run admin:test && npm run auth:test && npm run server:test && npm run media:test');
  assert.equal(scripts['test:node'], 'npm run postgres:test:contract && npm run migration:test && npm run release:test');
  assert.match(scripts['auth:test'], /auth-tests\/authorization\.test\.ts/u);
  assert.match(scripts['server:test'], /server-tests\/revision-contracts\.test\.ts/u);
  assert.match(scripts['server:test'], /server-tests\/revisions\.test\.ts/u);
  assert.doesNotMatch(`${scripts.test} ${scripts['test:vitest']} ${scripts['test:node']}`, /DATABASE_TEST_URL/u);
  assert.doesNotMatch(`${scripts['auth:test']} ${scripts['server:test']} ${scripts['media:test']}`, /(?:auth-database|postgres-repositories|local-media\.test|local-media-cleanup\.test|local-media-cleanup-apply)/u);
  assert.doesNotMatch(`${scripts['auth:test']} ${scripts['server:test']} ${scripts['media:test']}`, /(?:auth-tests|server-tests|media-tests)(?:\s|$)/u);
});

test('names every destructive database suite explicitly', () => {
  // Given / When
  const databaseScripts = Object.entries(packageJson.scripts)
    .filter(([name]) => name.endsWith(':db'));

  // Then
  assert.deepEqual(databaseScripts.map(([name]) => name).sort(), [
    'api:test:db',
    'api:test:http:db',
    'auth:test:db',
    'browser:test:db',
    'media:test:db',
    'migration:import:test:db',
    'postgres:test:db',
    'server:test:db',
    'standalone:test:db',
    'test:db',
  ]);
  assert.match(packageJson.scripts['server:test:db'], /server-tests\/revisions-postgres\.test\.ts/u);
});

test('database commands fail loudly when guarded test configuration is absent', async () => {
  // Given
  const environment = { ...process.env };
  delete environment.DATABASE_TEST_URL;
  delete environment.DATABASE_TEST_ALLOW_RESET;

  // When / Then
  for (const command of ['postgres:test:db', 'api:test:http:db']) {
    const result = await runNpm(command, environment);
    assert.notEqual(result.code, 0, `${command} must fail without guarded database configuration`);
    assert.match(result.output, /DATABASE_TEST_URL is required/u);
  }
});

test('defines one safe release verification command', () => {
  // Given / When
  const command = packageJson.scripts['release:verify'];

  // Then
  assert.equal(command, 'npm run check && npm run build && npm test');
  assert.doesNotMatch(command, /:db\b/u);
});

async function runNpm(command, environment) {
  const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const argumentsList = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run ${command}`]
    : ['run', command];
  const child = spawn(executable, argumentsList, {
    cwd: projectRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  return { code, output };
}
