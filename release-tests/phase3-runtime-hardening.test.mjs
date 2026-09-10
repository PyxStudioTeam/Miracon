import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public consultation forms use only the same-origin contact challenge flow', async () => {
  const [home, goldenVisa, contactSection, projectPage, siteScript] = await Promise.all([
    readProjectFile('src/pages/index.astro'),
    readProjectFile('src/pages/golden-visa.astro'),
    readProjectFile('src/components/ContactSection.astro'),
    readProjectFile('src/components/ProjectPage.astro'),
    readProjectFile('public/site.js'),
  ]);

  for (const source of [home, goldenVisa, contactSection]) {
    assert.match(source, /data-consultation-form/u);
    assert.doesNotMatch(source, /data-web3forms-key|h-captcha|data-captcha/u);
  }
  for (const source of [home, goldenVisa, projectPage, siteScript]) {
    assert.doesNotMatch(source, /web3forms|hcaptcha/iu);
  }
  assert.match(siteScript, /fetch\('\/api\/contact\/challenge'/u);
  assert.match(siteScript, /fetch\('\/api\/contact'/u);
  for (const field of ['name', 'email', 'phone', 'message', 'consent', 'locale', 'sourcePath', 'website', 'challenge']) {
    assert.match(siteScript, new RegExp(`\\b${field}\\b`, 'u'));
  }
});

test('active CSP removes obsolete contact and Supabase browser allowlists', async () => {
  const middleware = await readProjectFile('src/middleware.ts');
  assert.match(middleware, /"form-action 'self'"/u);
  assert.match(middleware, /`connect-src 'self'\$\{developmentConnections\}`/u);
  assert.match(middleware, /"img-src 'self' data: blob:"/u);
  assert.match(middleware, /"media-src 'self' blob:"/u);
  assert.doesNotMatch(middleware, /web3forms|hcaptcha|supabase\.co/iu);
});

test('repository-local GitHub hygiene and production release checklist are present', async () => {
  const [workflow, pullRequest, bugReport, featureRequest, runbook] = await Promise.all([
    readProjectFile('.github/workflows/ci.yml'),
    readProjectFile('.github/pull_request_template.md'),
    readProjectFile('.github/ISSUE_TEMPLATE/bug_report.yml'),
    readProjectFile('.github/ISSUE_TEMPLATE/feature_request.yml'),
    readProjectFile('docs/production-release-runbook.md'),
  ]);

  assert.match(workflow, /npm ci/u);
  assert.match(workflow, /npm run release:verify/u);
  assert.doesNotMatch(workflow, /DATABASE_URL|DATABASE_TEST_URL|deploy|push/u);
  assert.match(pullRequest, /release:verify/u);
  assert.match(bugReport, /reproduction/iu);
  assert.match(featureRequest, /problem/iu);
  for (const prerequisite of ['Node 22', 'DATABASE_URL', 'MEDIA_ROOT', 'PUBLIC_SITE_URL', 'CONTACT_DIGEST_SECRET', 'cPanel', 'Passenger', 'Cron', 'proxy', 'rollback']) {
    assert.match(runbook, new RegExp(prerequisite, 'iu'));
  }
});

test('repository-local agent state is ignored', async () => {
  const gitignore = await readProjectFile('.gitignore');

  for (const directory of ['.agents/', '.codegraph/', '.opencode/']) {
    assert.match(gitignore, new RegExp(`^${directory.replace('.', '\\.')}$`, 'mu'));
  }
});
