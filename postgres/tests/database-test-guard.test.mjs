import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { requireSafeDatabaseTestUrl } from './database-test-helpers.mjs';

const originalUrl = process.env.DATABASE_TEST_URL;
const originalOptIn = process.env.DATABASE_TEST_ALLOW_RESET;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.DATABASE_TEST_URL;
  else process.env.DATABASE_TEST_URL = originalUrl;
  if (originalOptIn === undefined) delete process.env.DATABASE_TEST_ALLOW_RESET;
  else process.env.DATABASE_TEST_ALLOW_RESET = originalOptIn;
});

test('rejects destructive database tests without explicit reset opt-in', () => {
  // Given
  process.env.DATABASE_TEST_URL = 'postgresql://localhost/miracon_test';
  delete process.env.DATABASE_TEST_ALLOW_RESET;

  // When / Then
  assert.throws(requireSafeDatabaseTestUrl, { name: 'DatabaseTestSafetyError' });
});

test('rejects a database name that is not explicitly disposable', () => {
  // Given
  process.env.DATABASE_TEST_URL = 'postgresql://localhost/miracon';
  process.env.DATABASE_TEST_ALLOW_RESET = '1';

  // When / Then
  assert.throws(requireSafeDatabaseTestUrl, { name: 'DatabaseTestSafetyError' });
});

test('accepts explicit reset opt-in for a test-segment database name', () => {
  // Given
  process.env.DATABASE_TEST_URL = 'postgresql://localhost/miracon_test';
  process.env.DATABASE_TEST_ALLOW_RESET = '1';

  // When
  const databaseUrl = requireSafeDatabaseTestUrl();

  // Then
  assert.equal(databaseUrl, process.env.DATABASE_TEST_URL);
});
