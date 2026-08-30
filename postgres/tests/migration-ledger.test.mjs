import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMigrationLedger } from '../../scripts/postgres-migrate.mjs';

const migrations = [
  { filename: '0001_first.sql', checksum: 'a', sql: 'select 1' },
  { filename: '0002_second.sql', checksum: 'b', sql: 'select 2' },
  { filename: '0003_third.sql', checksum: 'c', sql: 'select 3' },
];

test('returns only the unapplied suffix when the ledger is an exact prefix', () => {
  // Given
  const ledger = [
    { filename: '0001_first.sql', checksum: 'a' },
    { filename: '0002_second.sql', checksum: 'b' },
  ];

  // When
  const pending = validateMigrationLedger(migrations, ledger);

  // Then
  assert.deepEqual(pending, [migrations[2]]);
});

test('returns no work when every migration is already applied', () => {
  // Given
  const ledger = migrations.map(({ filename, checksum }) => ({ filename, checksum }));

  // When
  const pending = validateMigrationLedger(migrations, ledger);

  // Then
  assert.deepEqual(pending, []);
});

test('rejects checksum drift before selecting pending migrations', () => {
  // Given
  const ledger = [{ filename: '0001_first.sql', checksum: 'changed' }];

  // When / Then
  assert.throws(() => validateMigrationLedger(migrations, ledger), { name: 'MigrationDriftError' });
});

test('rejects a ledger migration missing from the filesystem', () => {
  // Given
  const ledger = [{ filename: '0000_removed.sql', checksum: 'removed' }];

  // When / Then
  assert.throws(() => validateMigrationLedger(migrations, ledger), { name: 'MigrationHistoryError' });
});

test('rejects a newly introduced migration before an applied migration', () => {
  // Given
  const ledger = [
    { filename: '0001_first.sql', checksum: 'a' },
    { filename: '0003_third.sql', checksum: 'c' },
  ];

  // When / Then
  assert.throws(() => validateMigrationLedger(migrations, ledger), { name: 'MigrationOrderError' });
});
