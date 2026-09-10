import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const publicDocumentPaths = [
  'src/pages/index.astro',
  'src/pages/golden-visa.astro',
  'src/components/ProjectPage.astro',
  'src/pages/404.astro',
];

test('paints the public canvas before the external stylesheet loads', async () => {
  const [seoHead, ...publicDocuments] = await Promise.all([
    readFile(new URL('../src/components/SeoHead.astro', import.meta.url), 'utf8'),
    ...publicDocumentPaths.map((path) => readFile(`${projectRoot}${path}`, 'utf8')),
  ]);

  assert.match(seoHead, /<style\s+is:inline>html,\s*body\s*\{\s*background:\s*#F7F4EE;\s*\}<\/style>/u);
  for (const [index, document] of publicDocuments.entries()) {
    const documentPath = publicDocumentPaths[index];
    const headStart = document.indexOf('<head>');
    const seoHeadStart = document.indexOf('<SeoHead');
    const stylesheetStart = document.indexOf('href="/style.css"');
    assert.ok(headStart >= 0, `${documentPath} must define a document head`);
    assert.ok(seoHeadStart > headStart, `${documentPath} must render the shared public head`);
    assert.ok(stylesheetStart > seoHeadStart, `${documentPath} must render the critical canvas before external CSS`);
  }
});
