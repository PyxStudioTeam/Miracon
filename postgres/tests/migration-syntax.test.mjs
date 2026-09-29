import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'libpg-query';

const directory = new URL('../migrations/', import.meta.url);

test('PostgreSQL migrations and SQL-language function bodies parse', async (suite) => {
  const filenames = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(filenames.length > 0);

  for (const filename of filenames) {
    await suite.test(filename, async () => {
      const source = await readFile(new URL(filename, directory), 'utf8');
      const migration = await parse(source);

      for (const { stmt } of migration.stmts ?? []) {
        const func = stmt?.CreateFunctionStmt;
        if (!func) continue;

        const options = func.options?.map(({ DefElem }) => DefElem) ?? [];
        const language = options.find(({ defname }) => defname === 'language')?.arg?.String?.sval?.toLowerCase();
        if (language !== 'sql') continue;

        const body = options.find(({ defname }) => defname === 'as')?.arg?.List?.items?.[0]?.String?.sval;
        assert.ok(body, `SQL function in ${filename} must have a body`);
        await parse(body);
      }
    });
  }
});
