// allow: SIZE_OK - One self-contained Node acceptance fixture owns its disposable resources.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { openClient, requireSafeDatabaseTestUrl, resetSchemas } from '../postgres/tests/database-test-helpers.mjs';
import { migrate } from '../scripts/postgres-migrate.mjs';
import { provisionSingletonAdmin } from '../scripts/provision-admin.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const standaloneEntry = fileURLToPath(new URL('../dist/server/entry.mjs', import.meta.url));
const artifactSchemaVersion = 1;
const actionEnum = new Set([
  'continue-same-origin',
  'fulfill-empty-css',
  'fulfill-empty-js',
  'fulfill-no-content',
  'reject-unknown-external',
]);
const routes = [
  { key: 'home-en', path: '/' },
  { key: 'home-el', path: '/el/' },
  { key: 'golden-visa-en', path: '/golden-visa' },
  { key: 'golden-visa-el', path: '/el/golden-visa' },
  { key: 'project-en', path: '/projects/browser-coastal-golden' },
  { key: 'project-el', path: '/el/projects/browser-coastal-golden' },
];
const viewports = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1279, height: 800 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];
const greekHeroViewport = { width: 400, height: 842 };
const filterViewports = [viewports[1], viewports[6]];
const mobileNavigationViewports = [viewports[1], viewports[4]];
const casePlan = [
  ...routes.flatMap((route) => viewports.map((viewport) => ({ route, viewport }))),
  { route: routes[1], viewport: greekHeroViewport },
];
const filterLabels = {
  en: { all: 'All', coastal: 'Coastal', city: 'City', 'golden-visa': 'Golden Visa' },
  el: { all: 'Όλα', coastal: 'Παραθαλάσσια', city: 'Πόλη', 'golden-visa': 'Golden Visa' },
};
const homeHeroByLocale = {
  en: {
    subtitle: 'Thessaloniki · Halkidiki · Greece',
    titleLines: ['Premium Residences', 'Prime Locations'],
    cta: { href: '/#projects', label: 'Explore projects' },
    badge: { href: '/golden-visa', label: 'Golden Visa from €250k' },
  },
  el: {
    subtitle: 'Θεσσαλονίκη · Χαλκιδική · Ελλάδα',
    titleLines: ['Πολυτελείς Κατοικίες', 'Προνομιακές Τοποθεσίες'],
    cta: { href: '/el/#projects', label: 'Εξερευνήστε τα έργα' },
    badge: { href: '/el/golden-visa', label: 'Golden Visa από €250k' },
  },
};
const filterOracle = [
  { filter: 'all', visibleSlugs: ['browser-coastal-golden', 'browser-city', 'browser-city-seven'], pressed: true },
  { filter: 'coastal', visibleSlugs: ['browser-coastal-golden'], pressed: false },
  { filter: 'city', visibleSlugs: ['browser-city', 'browser-city-seven'], pressed: false },
  { filter: 'golden-visa', visibleSlugs: ['browser-coastal-golden'], pressed: false },
];
const availabilityProjects = [
  {
    slug: 'browser-coastal-golden',
    title: 'Browser availability unknown',
    greekTitle: 'Δοκιμαστικό έργο άγνωστης διαθεσιμότητας',
    categories: ['coastal', 'golden-visa'],
    sortOrder: 0,
    remainingUnits: null,
    availability: { en: null, el: null },
  },
  {
    slug: 'browser-city',
    title: 'Browser sold out',
    greekTitle: 'Δοκιμαστικό εξαντλημένο έργο',
    categories: ['city'],
    sortOrder: 1,
    remainingUnits: 0,
    availability: {
      en: { dataAvailability: 'sold-out', text: 'Sold out' },
      el: { dataAvailability: 'sold-out', text: 'Εξαντλήθηκε' },
    },
  },
  {
    slug: 'browser-city-seven',
    title: 'Browser seven available',
    greekTitle: 'Δοκιμαστικό έργο επτά κατοικιών',
    categories: ['city'],
    sortOrder: 2,
    remainingUnits: 7,
    availability: {
      en: { dataAvailability: 'available', text: '7 units available' },
      el: { dataAvailability: 'available', text: '7 διαθέσιμες κατοικίες' },
    },
  },
];
const availabilityDetailViewports = [viewports[0], viewports[2], viewports[5]];
const fixtureAdmin = {
  email: 'browser-preview-admin@example.test',
  password: 'browser-preview-password-1234',
};
const inactiveFilterTextColor = 'rgb(0, 48, 117)';
const activeFilterTextColor = 'rgb(255, 255, 255)';
const pageReadyTimeoutMilliseconds = 10_000;
const heroTextGeometryTolerance = .75;
const chromeByRoute = {
  'home-en': { links: [['/#projects', 'Projects'], ['/golden-visa', 'Golden Visa'], ['/#about', 'About us'], ['/#contacts', 'Contacts']], languageHref: '/el/', language: 'Ελληνικά', languageCode: 'EN' },
  'home-el': { links: [['/el/#projects', 'Έργα'], ['/el/golden-visa', 'Golden Visa'], ['/el/#about', 'Σχετικά με εμάς'], ['/el/#contacts', 'Επικοινωνία']], languageHref: '/', language: 'English', languageCode: 'EL' },
  'golden-visa-en': { links: [['/#projects', 'Projects'], ['/golden-visa#top', 'Golden Visa'], ['/#about', 'About us'], ['/golden-visa#contacts', 'Contacts']], languageHref: '/el/golden-visa', language: 'Ελληνικά', languageCode: 'EN' },
  'golden-visa-el': { links: [['/el/#projects', 'Έργα'], ['/el/golden-visa#top', 'Golden Visa'], ['/el/#about', 'Σχετικά με εμάς'], ['/el/golden-visa#contacts', 'Επικοινωνία']], languageHref: '/golden-visa', language: 'English', languageCode: 'EL' },
  'project-en': { links: [['/?filter=coastal#projects', 'Projects'], ['/golden-visa', 'Golden Visa'], ['/#about', 'About us'], ['/projects/browser-coastal-golden#contacts', 'Contacts']], languageHref: '/el/projects/browser-coastal-golden', language: 'Ελληνικά', languageCode: 'EN' },
  'project-el': { links: [['/el/?filter=coastal#projects', 'Έργα'], ['/el/golden-visa', 'Golden Visa'], ['/el/#about', 'Σχετικά με εμάς'], ['/el/projects/browser-coastal-golden#contacts', 'Επικοινωνία']], languageHref: '/projects/browser-coastal-golden', language: 'English', languageCode: 'EL' },
};
const availabilityDetailCasePlan = availabilityProjects.flatMap((project) => ['en', 'el'].flatMap((locale) => availabilityDetailViewports.map((viewport) => ({
  route: {
    key: `availability-${project.slug}-${locale}`,
    path: `${locale === 'el' ? '/el' : ''}/projects/${project.slug}`,
    locale,
    chrome: projectChrome(locale, project.slug, project.categories[0], 'preview'),
    editorialRoot: '.project-intro-copy',
    title: locale === 'el' ? project.greekTitle : project.title,
    availability: project.availability[locale],
  },
  viewport,
}))));
const previewCasePlan = availabilityProjects.flatMap((project) => ['en', 'el'].map((locale) => ({
  route: {
    key: `preview-${project.slug}-${locale}`,
    path: `${locale === 'el' ? '/el' : ''}/preview/${project.slug}`,
    locale,
    chrome: projectChrome(locale, project.slug, project.categories[0]),
    editorialRoot: '.project-intro-copy',
    title: locale === 'el' ? project.greekTitle : project.title,
    availability: project.availability[locale],
    preview: locale === 'el'
      ? 'Προεπισκόπηση προσχεδίου Ορατό μόνο στον διαχειριστή'
      : 'Draft preview Only visible to the administrator',
  },
  viewport: viewports[5],
})));
const mobileMenuByLanguageCode = {
  EN: {
    navigationLabel: 'Mobile navigation',
    openMenuLabel: 'Open menu',
    closeMenuLabel: 'Close menu',
    contactLinks: [
      { href: 'tel:+306955340416', label: '+30 695 534 0416' },
      { href: 'mailto:info@miracon.gr', label: 'info@miracon.gr' },
      { href: 'https://www.google.com/maps/search/?api=1&query=Egnatia+84%2C+54623+Thessaloniki%2C+Greece', label: 'Egnatia 84, Thessaloniki' },
    ],
  },
  EL: {
    navigationLabel: 'Πλοήγηση για κινητά',
    openMenuLabel: 'Άνοιγμα μενού',
    closeMenuLabel: 'Κλείσιμο μενού',
    contactLinks: [
      { href: 'tel:+306955340416', label: '+30 695 534 0416' },
      { href: 'mailto:info@miracon.gr', label: 'info@miracon.gr' },
      { href: 'https://www.google.com/maps/search/?api=1&query=Egnatia+84%2C+54623+Thessaloniki%2C+Greece', label: 'Εγνατία 84, Θεσσαλονίκη' },
    ],
  },
};
const editorialRootByRoute = {
  'home-en': '.about-section',
  'home-el': '.about-section',
  'golden-visa-en': '.gv-family',
  'golden-visa-el': '.gv-family',
  'project-en': '.project-intro-copy',
  'project-el': '.project-intro-copy',
};
const headerElementSelectors = [
  '.header',
  '.header .logo',
  '.header .nav-menu',
  '.header .header-actions',
  '.header .lang-selector',
  '.header .contact-menu',
  '.header .mobile-lang-selector',
  '.header .mobile-menu-btn',
  '.header .mobile-nav',
];
const homeHeroElementSelectors = ['.hero', '.hero-title', '.hero-actions', '.btn-hero', '.badge-visa'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function artifactConfiguration(environment) {
  const directory = environment.BROWSER_TEST_ARTIFACT_DIR;
  if (!directory) return null;
  if (!isAbsolute(directory)) throw new Error('BROWSER_TEST_ARTIFACT_DIR must be an absolute path');
  const runToken = environment.BROWSER_TEST_RUN_TOKEN;
  if (!runToken || !uuidPattern.test(runToken)) {
    throw new Error('BROWSER_TEST_RUN_TOKEN must be a nonempty UUID when BROWSER_TEST_ARTIFACT_DIR is set');
  }
  return { directory, runToken };
}

test('keeps an unset artifact directory disabled', () => {
  assert.equal(artifactConfiguration({}), null);
});

test('rejects an artifact directory without a caller run token', () => {
  assert.throws(
    () => artifactConfiguration({ BROWSER_TEST_ARTIFACT_DIR: 'C:/tmp/browser-artifacts' }),
    /BROWSER_TEST_RUN_TOKEN/u,
  );
});

test('rejects relative artifact paths and malformed run tokens', () => {
  assert.throws(
    () => artifactConfiguration({ BROWSER_TEST_ARTIFACT_DIR: 'browser-artifacts', BROWSER_TEST_RUN_TOKEN: randomUUID() }),
    /absolute path/u,
  );
  assert.throws(
    () => artifactConfiguration({ BROWSER_TEST_ARTIFACT_DIR: 'C:/tmp/browser-artifacts', BROWSER_TEST_RUN_TOKEN: 'not-a-uuid' }),
    /nonempty UUID/u,
  );
});

test('initializes an empty absolute artifact directory', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'miracon-browser-artifact-test-'));
  const directory = join(parent, 'artifacts');
  try {
    const artifacts = await createArtifactRun(artifactConfiguration({ BROWSER_TEST_ARTIFACT_DIR: directory, BROWSER_TEST_RUN_TOKEN: randomUUID() }));
    assert.deepEqual((await readdir(directory)).sort(), ['assertions', 'screenshots']);
    assert.equal(artifacts.runToken.length, 36);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('rejects a nonempty artifact directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'miracon-browser-artifact-test-'));
  try {
    await writeFile(join(directory, 'stale.json'), '{}\n');
    await assert.rejects(
      createArtifactRun(artifactConfiguration({ BROWSER_TEST_ARTIFACT_DIR: directory, BROWSER_TEST_RUN_TOKEN: randomUUID() })),
      /absent or empty/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('maps every allowed external provider and rejects unknown origins', () => {
  const baseUrl = 'http://127.0.0.1:4321';
  assert.deepEqual([
    routeAction(new URL(`${baseUrl}/style.css`), 'stylesheet', baseUrl),
    routeAction(new URL('https://fonts.googleapis.com/css2?family=Gilroy'), 'stylesheet', baseUrl),
    routeAction(new URL('https://cdn.jsdelivr.net/npm/example.css'), 'stylesheet', baseUrl),
    routeAction(new URL('https://web3forms.com/client/script.js'), 'script', baseUrl),
    routeAction(new URL('https://fonts.gstatic.com/s/gilroy.woff2'), 'font', baseUrl),
    routeAction(new URL('https://example.test/unknown.js'), 'script', baseUrl),
  ], [
    'continue-same-origin',
    'fulfill-empty-css',
    'fulfill-empty-css',
    'fulfill-empty-js',
    'fulfill-no-content',
    'reject-unknown-external',
  ]);
});

test('normalizes only equivalent internal trailing slashes in chrome hrefs', () => {
  assert.equal(normalizeChromeHref('/el/golden-visa/'), '/el/golden-visa');
  assert.equal(normalizeChromeHref('/el/golden-visa/?campaign=spring#top'), '/el/golden-visa?campaign=spring#top');
  assert.equal(normalizeChromeHref('/'), '/');
  assert.notEqual(normalizeChromeHref('/el/golden-visa#top'), normalizeChromeHref('/el/golden-visa#contacts'));
  assert.equal(normalizeChromeHref('https://example.test/el/golden-visa/'), 'https://example.test/el/golden-visa/');
});

test('covers the exact Task 4 full-route matrix', () => {
  assert.deepEqual(casePlan.map(({ route, viewport }) => `${route.key}__${viewport.width}x${viewport.height}`), [
    'home-en__375x667', 'home-en__390x844', 'home-en__768x1024', 'home-en__1024x768', 'home-en__1279x800', 'home-en__1280x800', 'home-en__1366x768', 'home-en__1920x1080',
    'home-el__375x667', 'home-el__390x844', 'home-el__768x1024', 'home-el__1024x768', 'home-el__1279x800', 'home-el__1280x800', 'home-el__1366x768', 'home-el__1920x1080',
    'golden-visa-en__375x667', 'golden-visa-en__390x844', 'golden-visa-en__768x1024', 'golden-visa-en__1024x768', 'golden-visa-en__1279x800', 'golden-visa-en__1280x800', 'golden-visa-en__1366x768', 'golden-visa-en__1920x1080',
    'golden-visa-el__375x667', 'golden-visa-el__390x844', 'golden-visa-el__768x1024', 'golden-visa-el__1024x768', 'golden-visa-el__1279x800', 'golden-visa-el__1280x800', 'golden-visa-el__1366x768', 'golden-visa-el__1920x1080',
    'project-en__375x667', 'project-en__390x844', 'project-en__768x1024', 'project-en__1024x768', 'project-en__1279x800', 'project-en__1280x800', 'project-en__1366x768', 'project-en__1920x1080',
    'project-el__375x667', 'project-el__390x844', 'project-el__768x1024', 'project-el__1024x768', 'project-el__1279x800', 'project-el__1280x800', 'project-el__1366x768', 'project-el__1920x1080',
    'home-el__400x842',
  ]);
});

test('requires the Task 4 correction full-route matrix and keyboard focus traversal', async () => {
  const testSource = await readFile(fileURLToPath(import.meta.url), 'utf8');
  const artifactSchemaVersionSource = testSource.match(/^const artifactSchemaVersion = (?<version>\d+);$/mu);
  assert.equal(artifactSchemaVersionSource?.groups?.version, '1');
  assert.equal(casePlan.length, 49);
  for (const route of routes) {
    const expectedCaseCount = route.key === 'home-el' ? viewports.length + 1 : viewports.length;
    assert.equal(casePlan.filter((entry) => entry.route === route).length, expectedCaseCount, `${route.key} must cover every Task 4 viewport`);
  }
  assert.match(testSource, /await page\.keyboard\.press\('Tab'\)/u);
  assert.match(testSource, /candidates:[\s\S]*?traversed:/u);
  assert.doesNotMatch(testSource, /assertControlFocusability\(page/u);
});

test('adds Task 3 filter coverage for both home locales at mobile and desktop widths', () => {
  const cases = casePlan
    .filter(({ route, viewport }) => route.key.startsWith('home-') && filterViewports.includes(viewport))
    .map(({ route, viewport }) => `${route.key}__${viewport.width}x${viewport.height}`);
  assert.deepEqual(cases, [
    'home-en__390x844', 'home-en__1366x768',
    'home-el__390x844', 'home-el__1366x768',
  ]);
});

test('requires Task 6 localized mobile-menu interaction for exactly 12 compact route cases', async () => {
  const task6Cases = casePlan
    .filter(isTask6MobileNavigationCase)
    .map(({ route, viewport }) => `${route.key}__${viewport.width}x${viewport.height}`);
  assert.deepEqual(task6Cases, [
    'home-en__390x844', 'home-en__1279x800',
    'home-el__390x844', 'home-el__1279x800',
    'golden-visa-en__390x844', 'golden-visa-en__1279x800',
    'golden-visa-el__390x844', 'golden-visa-el__1279x800',
    'project-en__390x844', 'project-en__1279x800',
    'project-el__390x844', 'project-el__1279x800',
  ]);

  const testSource = await readFile(fileURLToPath(import.meta.url), 'utf8');
  assert.match(testSource, /const mobileNavigation = isTask6MobileNavigationCase\(\{ route, viewport \}\)\n      \? await assertMobileNavigationInteraction\(page, chromeByRoute\[route\.key\], viewport\)\n      : null;/u);
  assert.match(testSource, /mobileNavigation,/u);
  assert.match(testSource, /await page\.keyboard\.press\('Escape'\)/u);
  assert.match(testSource, /overlaps: \[\],/u);

  const [readme, packageSource] = await Promise.all([
    readFile(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ]);
  const scripts = JSON.parse(packageSource).scripts;
  assert.equal(scripts['browser:install'], 'playwright install chromium');
  assert.equal(scripts['browser:test:db'], 'node scripts/require-database-test-config.mjs && node --test --test-concurrency=1 browser-tests/public-localization-layout.test.mjs');
  assert.match(scripts['test:db'], /npm run standalone:test:db && npm run browser:test:db$/u);
  assert.doesNotMatch(scripts['release:verify'], /(?:browser|:db)/u);
  assert.match(readme, /npm run browser:install\n+npm run build/u);
  assert.match(readme, /`npm run browser:test:db` uses the same destructive disposable-database safeguards/u);
  assert.match(readme, /`npm run test:db` includes `npm run browser:test:db` after `npm run standalone:test:db`\./u);
  assert.match(readme, /`npm run release:verify` excludes all guarded database and browser acceptance suites/u);
});

test('pins Task 6 mobile-menu markup, implementation states, and preparation order', async () => {
  const [homePage, goldenVisaPage, siteHeader, siteScript, testSource] = await Promise.all([
    readFile(fileURLToPath(new URL('../src/pages/index.astro', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../src/pages/golden-visa.astro', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../src/components/SiteHeader.astro', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../public/site.js', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(import.meta.url), 'utf8'),
  ]);

  assertTask6MobileMenuSourceContract({ homePage, goldenVisaPage, siteHeader, siteScript, testSource });
});

function assertTask6MobileMenuSourceContract({ homePage, goldenVisaPage, siteHeader, siteScript, testSource }) {
  const menuButtonMarkup = /<button\b(?=[^>]*\bclass\s*=\s*"mobile-menu-btn")(?=[^>]*\bid\s*=\s*"mobileMenuBtn")(?=[^>]*\btype\s*=\s*"button")(?=[^>]*\baria-label\s*=\s*\{m\['common\.openMenu'\]\})(?=[^>]*\baria-controls\s*=\s*"mobileNav")(?=[^>]*\baria-expanded\s*=\s*"false")[^>]*>/u;
  const navigationMarkup = /<nav\b(?=[^>]*\bclass\s*=\s*"mobile-nav")(?=[^>]*\bid\s*=\s*"mobileNav")(?=[^>]*\baria-label\s*=\s*\{m\['common\.mobileNavigation'\]\})[^>]*>/u;
  const contactMarkup = /<button\b(?=[^>]*\bclass\s*=\s*"mobile-nav-contact")(?=[^>]*\btype\s*=\s*"button")(?=[^>]*\baria-expanded\s*=\s*"false")(?=[^>]*\baria-controls\s*=\s*"mobileContactDetails")[^>]*>/u;
  const contactDetailsMarkup = /<div\b(?=[^>]*\bclass\s*=\s*"mobile-nav-contacts")(?=[^>]*\bid\s*=\s*"mobileContactDetails")[^>]*>/u;

  for (const [name, markup] of [
    ['homepage header', homePage],
    ['Golden Visa header', goldenVisaPage],
    ['project header', siteHeader],
  ]) {
    assert.match(markup, menuButtonMarkup, `${name} must provide the shared menu button wiring`);
    assert.match(markup, navigationMarkup, `${name} must provide the shared mobile navigation wiring`);
    assert.match(markup, contactMarkup, `${name} must provide the shared contact disclosure wiring`);
    assert.match(markup, contactDetailsMarkup, `${name} must provide the shared contact-details target`);
  }

  assert.match(siteScript, /const\s+mobileMenuBtn\s*=\s*document\.getElementById\('mobileMenuBtn'\);[\s\S]*?const\s+mobileNav\s*=\s*document\.getElementById\('mobileNav'\);[\s\S]*?const\s+mobileContactDetails\s*=\s*document\.getElementById\('mobileContactDetails'\);/u);
  assert.match(siteScript, /const\s+menuFocusableElements\s*=\s*\(\)\s*=>[\s\S]*?\.filter\(\s*element\s*=>\s*!element\.closest\('\.mobile-nav-contacts'\)\s*\|\|\s*mobileContactDetails\?\.classList\.contains\('active'\)\s*\)/u);
  assert.match(siteScript, /const\s+setMenuOpen\s*=\s*\(\s*isOpen\s*,\s*shouldFocusMenu\s*=\s*false\s*\)\s*=>\s*\{[\s\S]*?mobileNav\.classList\.toggle\('active',\s*isOpen\);[\s\S]*?mobileMenuBtn\.classList\.toggle\('active',\s*isOpen\);[\s\S]*?mobileMenuBtn\.setAttribute\('aria-expanded',\s*String\(isOpen\)\);[\s\S]*?mobileMenuBtn\.setAttribute\('aria-label',\s*isOpen\s*\?\s*ui\.closeMenu\s*:\s*ui\.openMenu\);[\s\S]*?mobileNav\.setAttribute\('aria-hidden',\s*String\(!isOpen\)\);[\s\S]*?if\s*\(\s*!isOpen\s*&&\s*mobileContactButton\s*&&\s*mobileContactDetails\s*\)\s*\{[\s\S]*?mobileContactButton\.setAttribute\('aria-expanded',\s*'false'\);[\s\S]*?mobileContactDetails\.classList\.remove\('active'\);[\s\S]*?mobileContactDetails\.setAttribute\('aria-hidden',\s*'true'\);[\s\S]*?if\s*\(\s*isOpen\s*&&\s*shouldFocusMenu\s*\)\s*menuFocusableElements\(\)\[0\]\?\.focus\(\);/u);
  assert.match(siteScript, /mobileNav\.setAttribute\('aria-hidden',\s*'true'\);[\s\S]*?if\s*\(\s*mobileContactDetails\s*\)\s*mobileContactDetails\.setAttribute\('aria-hidden',\s*'true'\);/u);
  assert.match(siteScript, /mobileContactButton\.addEventListener\('click',\s*\(\)\s*=>\s*\{[\s\S]*?mobileContactDetails\.classList\.toggle\('active'\);[\s\S]*?mobileContactButton\.setAttribute\('aria-expanded',\s*String\(isOpen\)\);[\s\S]*?mobileContactDetails\.setAttribute\('aria-hidden',\s*String\(!isOpen\)\);/u);
  assert.match(siteScript, /if\s*\(\s*event\.key\s*===\s*'Escape'\s*\)\s*\{[\s\S]*?setMenuOpen\(false\);[\s\S]*?mobileMenuBtn\.focus\(\);/u);

  assert.match(testSource, /const\s+artifactSchemaVersion\s*=\s*1;/u);
  assert.match(testSource, /await\s+page\.setViewportSize\(viewport\);[\s\S]*?response\s*=\s*await\s+page\.goto\(`\$\{baseUrl\}\$\{route\.path\}`,\s*\{\s*waitUntil:\s*'domcontentloaded'\s*\}\);[\s\S]*?await\s+page\.locator\('header\.header'\)\.waitFor\(\{\s*state:\s*'visible',\s*timeout:\s*pageReadyTimeoutMilliseconds\s*\}\);[\s\S]*?assert\.equal\(\s*await\s+page\.evaluate\(\(\)\s*=>\s*window\.innerWidth\),\s*viewport\.width\s*\);[\s\S]*?await\s+document\.fonts\.load\('400 48px Gilroy',\s*'Πολυτελείς Κατοικίες'\);[\s\S]*?await\s+document\.fonts\.load\('600 15px Gilroy',\s*'Επικοινωνία'\);[\s\S]*?await\s+document\.fonts\.ready;[\s\S]*?document\.fonts\.check\('400 48px Gilroy',\s*'Πολυτελείς Κατοικίες'\)[\s\S]*?document\.fonts\.check\('600 15px Gilroy',\s*'Επικοινωνία'\)[\s\S]*?assert\.equal\(fonts\.gilroy400,\s*true\);[\s\S]*?assert\.equal\(fonts\.gilroy600,\s*true\);[\s\S]*?await\s+assertMobileNavigationInteraction\(page,\s*chromeByRoute\[route\.key\],\s*viewport\)/u);
}

test('characterizes the localized filter labels, pressed state, and three-project oracle', () => {
  assert.deepEqual(filterLabels, {
    en: { all: 'All', coastal: 'Coastal', city: 'City', 'golden-visa': 'Golden Visa' },
    el: { all: 'Όλα', coastal: 'Παραθαλάσσια', city: 'Πόλη', 'golden-visa': 'Golden Visa' },
  });
  assert.deepEqual(filterOracle, [
    { filter: 'all', visibleSlugs: ['browser-coastal-golden', 'browser-city', 'browser-city-seven'], pressed: true },
    { filter: 'coastal', visibleSlugs: ['browser-coastal-golden'], pressed: false },
    { filter: 'city', visibleSlugs: ['browser-city', 'browser-city-seven'], pressed: false },
    { filter: 'golden-visa', visibleSlugs: ['browser-coastal-golden'], pressed: false },
  ]);
});

test('characterizes the public header source contract before responsive ownership changes', async () => {
  const [homePage, goldenVisaPage, projectPage, siteHeader, stylesheet, mobileStylesheet, innerMobileStylesheet] = await Promise.all([
    readFile(fileURLToPath(new URL('../src/pages/index.astro', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../src/pages/golden-visa.astro', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../src/components/ProjectPage.astro', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../src/components/SiteHeader.astro', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../public/style.css', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../public/mobile.css', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../public/inner-mobile.css', import.meta.url)), 'utf8'),
  ]);

  for (const headerMarkup of [homePage, goldenVisaPage, siteHeader]) {
    assert.match(headerMarkup, /class="header(?: notranslate)?"/u);
    for (const control of ['logo', 'nav-menu', 'header-actions', 'lang-selector', 'contact-menu', 'mobile-lang-selector', 'mobile-menu-btn', 'mobile-nav']) {
      assert.match(headerMarkup, new RegExp(`class="[^"\n]*${control}`, 'u'));
    }
  }
  assert.match(homePage, /href="\/style\.css"[\s\S]*href="\/mobile\.css"/u);
  assert.match(goldenVisaPage, /href="\/style\.css"[\s\S]*href="\/golden-visa\.css"[\s\S]*href="\/inner-mobile\.css"/u);
  assert.match(projectPage, /href="\/style\.css"[\s\S]*href="\/project\.css"[\s\S]*href="\/inner-mobile\.css"/u);

  assert.match(stylesheet, /\.header-container\s*\{[\s\S]*?height:\s*51px;/u);
  assert.match(stylesheet, /\.glass-gradient\s*\{[\s\S]*?backdrop-filter:\s*blur\(18px\);/u);
  assert.match(stylesheet, /\.lang-selector\s*\{[\s\S]*?width:\s*62px;[\s\S]*?height:\s*51px;/u);
  assert.match(stylesheet, /\.contact-menu\s*\{[\s\S]*?width:\s*194px;[\s\S]*?height:\s*51px;/u);
  assert.match(stylesheet, /\.contact-dropdown\s*\{[\s\S]*?right:\s*0;/u);
  assert.match(mobileStylesheet, /@media \(max-width: 600px\)/u);
  assert.match(mobileStylesheet, /@media \(min-width: 601px\)/u);
  assert.match(innerMobileStylesheet, /@media \(max-width: 760px\)/u);
  assert.match(innerMobileStylesheet, /@media \(min-width: 761px\)/u);
  assert.match(stylesheet, /@media \(max-width: 1919px\)/u);
});

test('requires Task 4 exclusive compact owners and a 1280px desktop grid', async () => {
  const [stylesheet, mobileStylesheet, innerMobileStylesheet] = await Promise.all([
    readFile(fileURLToPath(new URL('../public/style.css', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../public/mobile.css', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../public/inner-mobile.css', import.meta.url)), 'utf8'),
  ]);

  const homeCompactOwner = /@media \(min-width: 601px\) and \(max-width: 1279px\) \{[\s\S]*?\.nav-menu,[\s\S]*?\.header-actions \{[\s\S]*?display:\s*none;[\s\S]*?\.mobile-menu-btn \{[\s\S]*?display:\s*block;[\s\S]*?\.mobile-lang-selector \{[\s\S]*?display:\s*inline-flex;/u;
  const innerCompactOwner = /@media \(min-width: 761px\) and \(max-width: 1279px\) \{[\s\S]*?\.project-page \.nav-menu,[\s\S]*?\.golden-visa-page \.header-actions \{[\s\S]*?display:\s*none;[\s\S]*?\.project-page \.mobile-menu-btn,[\s\S]*?\.golden-visa-page \.mobile-menu-btn \{[\s\S]*?display:\s*block;/u;
  const desktopGridOwner = /@media \(min-width: 1280px\) \{[\s\S]*?\.header-container \{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*max-content minmax\(0, 1fr\) max-content;[\s\S]*?\.header \.logo,[\s\S]*?\.contact-btn \{[\s\S]*?position:\s*static;[\s\S]*?\.contact-menu \{[\s\S]*?position:\s*relative;[\s\S]*?flex:\s*0 0 194px;/u;

  assert.equal((mobileStylesheet.match(/@media \(min-width: 601px\) and \(max-width: 1279px\)/gu) ?? []).length, 1);
  assert.match(mobileStylesheet, homeCompactOwner);
  assert.doesNotMatch(mobileStylesheet, /@media \(min-width: 951px\) and \(max-width: 1180px\)/u);
  assert.doesNotMatch(mobileStylesheet, /@media \(max-width: 950px\)/u);

  assert.equal((innerMobileStylesheet.match(/@media \(min-width: 761px\) and \(max-width: 1279px\)/gu) ?? []).length, 1);
  assert.match(innerMobileStylesheet, innerCompactOwner);
  assert.doesNotMatch(innerMobileStylesheet, /@media \(min-width: 951px\) and \(max-width: 1180px\)/u);
  assert.doesNotMatch(innerMobileStylesheet, /@media \(max-width: 950px\)/u);

  assert.equal((stylesheet.match(/@media \(min-width: 1280px\)/gu) ?? []).length, 1);
  assert.match(stylesheet, desktopGridOwner);
  const responsiveDesktopRange = stylesheet.slice(
    stylesheet.indexOf('@media (max-width: 1919px)'),
    stylesheet.indexOf('/* Preserve the 1920px desktop composition'),
  );
  assert.doesNotMatch(responsiveDesktopRange, /\.header-container\s*\{[^}]*display:\s*flex;/u);
  assert.doesNotMatch(stylesheet, /@media \(min-width: 1181px\) and \(max-width: 1919px\) \{[\s\S]*?html\[lang='el'\] \.nav-menu/u);
  assert.doesNotMatch(stylesheet, /@media \(min-width: 821px\) and \(max-width: 1180px\) \{[\s\S]*?\.nav-menu/u);
});

test('requires mobile.css to be the only <=600 homepage header owner', async () => {
  const [stylesheet, mobileStylesheet] = await Promise.all([
    readFile(fileURLToPath(new URL('../public/style.css', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../public/mobile.css', import.meta.url)), 'utf8'),
  ]);
  const styleMobileStart = stylesheet.indexOf('@media (max-width: 600px) {');
  const styleMobileEnd = stylesheet.indexOf('@media (max-width: 760px) {', styleMobileStart);
  const styleMobileBlock = stylesheet.slice(styleMobileStart, styleMobileEnd);
  const mobileHeaderStart = mobileStylesheet.indexOf('/* Header — Figma: x0 y0 w375 h72. */');
  const mobileHeaderBlockStart = mobileStylesheet.lastIndexOf('@media (max-width: 600px) {', mobileHeaderStart);
  const mobileHeaderEnd = mobileStylesheet.indexOf('/* Hero — Figma: y0..721. */', mobileHeaderStart);
  const mobileHeaderBlock = mobileStylesheet.slice(mobileHeaderBlockStart, mobileHeaderEnd);
  const duplicateHeaderSelectors = [
    /^\s*\.header\b/mu,
    /^\s*\.header-container\b/mu,
    /^\s*\.header \.logo\b/mu,
    /^\s*\.nav-menu\b/mu,
    /^\s*\.header-actions\b/mu,
    /^\s*\.lang-selector\b/mu,
    /^\s*\.contact-menu\b/mu,
    /^\s*\.contact-dropdown\b/mu,
    /^\s*\.contact-btn\b/mu,
    /^\s*\.contact-btn-icon\b/mu,
    /^\s*\.contact-btn-arrow\b/mu,
    /^\s*\.mobile-lang-selector\b/mu,
    /^\s*\.mobile-menu-btn\b/mu,
    /^\s*\.mobile-nav\b/mu,
  ];

  assert.notEqual(styleMobileStart, -1);
  assert.notEqual(styleMobileEnd, -1);
  for (const selector of duplicateHeaderSelectors) assert.doesNotMatch(styleMobileBlock, selector);
  assert.match(styleMobileBlock, /^\s*\.container\s*\{[\s\S]*?width:\s*calc\(100vw - \(var\(--mobile-gutter\) \* 2\)\);/mu);

  assert.match(mobileHeaderBlock, /\.header,[\s\S]*?\.header\.header--hidden\s*\{[\s\S]*?height:\s*72px;/u);
  assert.match(mobileHeaderBlock, /\.header-container\s*\{[\s\S]*?height:\s*72px;/u);
  assert.match(mobileHeaderBlock, /\.header \.logo\s*\{[\s\S]*?transform:\s*scale\(\.487\);/u);
  assert.match(mobileHeaderBlock, /\.nav-menu,[\s\S]*?\.header-actions\s*\{[\s\S]*?display:\s*none;/u);
  assert.match(mobileHeaderBlock, /\.mobile-lang-selector\s*\{[\s\S]*?width:\s*42px;[\s\S]*?height:\s*34px;/u);
  assert.match(mobileHeaderBlock, /\.mobile-menu-btn\s*\{[\s\S]*?width:\s*19px;[\s\S]*?height:\s*13px;/u);
  assert.match(mobileHeaderBlock, /\.mobile-nav\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?visibility:\s*hidden;/u);
  assert.match(mobileHeaderBlock, /\.mobile-nav\.active\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?visibility:\s*visible;/u);
});

test('requires filter labels to use real text instead of generated content', async () => {
  const [homePage, stylesheet] = await Promise.all([
    readFile(fileURLToPath(new URL('../src/pages/index.astro', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../public/style.css', import.meta.url)), 'utf8'),
  ]);
  assert.doesNotMatch(homePage, /data-label=/u);
  assert.doesNotMatch(stylesheet, /\.filter-tab span::(?:before|after)/u);
  assert.match(stylesheet, /\.filter-tab span\s*\{[\s\S]*?color:\s*#003075;[\s\S]*?transition:\s*color 0\.42s cubic-bezier\(0\.65, 0, 0\.35, 1\);/u);
  assert.match(stylesheet, /\.filter-tab:hover span,[\s\S]*?\.filter-tab:focus-visible span,[\s\S]*?\.filter-tab\.active span\s*\{[\s\S]*?color:\s*var\(--white\);/u);
});

test('requires mobile filters to retain the decorative circle without span label pseudos', async () => {
  const [mobileStylesheet, stylesheet] = await Promise.all([
    readFile(fileURLToPath(new URL('../public/mobile.css', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../public/style.css', import.meta.url)), 'utf8'),
  ]);
  assert.match(mobileStylesheet, /\.filter-tab span::before,[\s\S]*?\.filter-tab span::after\s*\{[\s\S]*?content:\s*none;[\s\S]*?display:\s*none;/u);
  assert.doesNotMatch(mobileStylesheet, /\.filter-tab::before,/u);
  assert.doesNotMatch(mobileStylesheet, /color:\s*inherit\s*!important;/u);
  assert.doesNotMatch(stylesheet, /@media \(max-width: 600px\)\s*\{[\s\S]*?\.filter-tabs \.filter-tab span/u);
  const activeRule = mobileStylesheet.match(/\.filter-tab\.active\s*\{([^}]*)\}/u)?.[1] ?? '';
  assert.match(activeRule, /border-color:\s*var\(--mobile-blue\);/u);
  assert.doesNotMatch(activeRule, /\bbackground(?:-color)?\s*:/u);
  assert.match(mobileStylesheet, /\.filter-tab\s*\{[\s\S]*?background:\s*var\(--mobile-cream\);/u);
  assert.match(stylesheet, /\.filter-tab::before\s*\{[\s\S]*?content:\s*"";[\s\S]*?width:\s*140%;[\s\S]*?aspect-ratio:\s*1;[\s\S]*?transition:\s*transform 0\.42s cubic-bezier\(0\.65, 0, 0\.35, 1\);/u);
});

test('requires Task 5 to give the homepage hero one compact flow owner without changing its contract', async () => {
  const [homePage, messages, stylesheet, mobileStylesheet] = await Promise.all([
    readFile(fileURLToPath(new URL('../src/pages/index.astro', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../src/lib/i18n.ts', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../public/style.css', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('../public/mobile.css', import.meta.url)), 'utf8'),
  ]);
  const styleMobileStart = stylesheet.indexOf('@media (max-width: 600px) {');
  const styleMobileEnd = stylesheet.indexOf('@media (max-width: 760px) {', styleMobileStart);
  const styleMobileBlock = stylesheet.slice(styleMobileStart, styleMobileEnd);
  const heroOwnerStart = mobileStylesheet.indexOf('/* Authoritative <=600 homepage hero flow. */');
  const heroOwnerBlockStart = mobileStylesheet.indexOf('@media ', heroOwnerStart);
  const heroOwnerEnd = mobileStylesheet.indexOf('@media ', heroOwnerBlockStart + 1);
  const mobileHeroRulesOutsideOwner = `${mobileStylesheet.slice(0, heroOwnerStart)}${mobileStylesheet.slice(heroOwnerEnd)}`;
  const mobile360Blocks = [...mobileStylesheet.matchAll(/@media \(max-width: 360px\) \{([\s\S]*?)^\}/gmu)].map((match) => match[1]);
  const style500Block = stylesheet.match(/@media \(max-width: 500px\) \{([\s\S]*?)^\}/gmu)?.[1] ?? '';

  assert.match(homePage, /<h1 class="hero-title">\{m\['home\.heroTitleLine1'\]\}<br>\{m\['home\.heroTitleLine2'\]\}<\/h1>/u);
  assert.match(homePage, /<video class="hero-video is-active" autoplay muted loop=\{homeHeroVideos\.length === 1\} playsinline preload="auto"/u);
  assert.match(homePage, /<source media="\(max-width: 600px\)" src=\{firstHomeHeroVideo\.mobileUrl \?\? firstHomeHeroVideo\.desktopUrl\} type="video\/mp4">/u);
  assert.match(homePage, /<a href=\{projectsHref\} class="btn-hero">[\s\S]*?<a href=\{goldenVisaHref\} class="badge-visa glass-gradient">/u);
  assert.match(messages, /'home\.heroLocation': 'Thessaloniki · Halkidiki · Greece'/u);
  assert.match(messages, /'home\.heroTitleLine1': 'Premium Residences'/u);
  assert.match(messages, /'home\.heroTitleLine2': 'Prime Locations'/u);
  assert.match(messages, /'home\.exploreProjects': 'Explore projects'/u);
  assert.match(messages, /'home\.goldenVisaBadge': 'Golden Visa from €250k'/u);
  assert.match(messages, /'home\.heroLocation': 'Θεσσαλονίκη · Χαλκιδική · Ελλάδα'/u);
  assert.match(messages, /'home\.heroTitleLine1': 'Πολυτελείς Κατοικίες'/u);
  assert.match(messages, /'home\.heroTitleLine2': 'Προνομιακές Τοποθεσίες'/u);
  assert.match(messages, /'home\.exploreProjects': 'Εξερευνήστε τα έργα'/u);
  assert.match(messages, /'home\.goldenVisaBadge': 'Golden Visa από €250k'/u);
  assert.match(stylesheet, /\.hero::after\s*\{[\s\S]*?background:\s*rgba\(0, 0, 0, \.2\);/u);
  assert.match(stylesheet, /\.btn-hero:hover \.(?:btn-arrow)[\s\S]*?translate:\s*var\(--btn-hero-arrow-travel\)/u);
  assert.match(stylesheet, /\.badge-visa\s*\{[\s\S]*?animation:\s*premium-gold-flow 5\.5s ease-in-out infinite;/u);

  assert.equal((mobileStylesheet.match(/\/\* Authoritative <=600 homepage hero flow\. \*\//gu) ?? []).length, 1);
  assert.notEqual(heroOwnerStart, -1);
  assert.match(mobileStylesheet, /\/\* Authoritative <=600 homepage hero flow\. \*\/[\s\S]*?@media \(max-width: 600px\) \{[\s\S]*?\.hero-pin,[\s\S]*?min-height:\s*max\(620px, 100dvh\);[\s\S]*?\.hero-content,[\s\S]*?position:\s*relative;[\s\S]*?\.hero-actions\s*\{[\s\S]*?position:\s*static;/u);
  assert.doesNotMatch(mobileHeroRulesOutsideOwner, /\.(?:hero-content|hero-subtitle|hero-title|hero-actions|btn-hero|badge-visa)\b/u);
  assert.doesNotMatch(mobileStylesheet, /\.hero-content,[\s\S]*?body\.js-enabled \.hero-content\s*\{[^}]*position:\s*absolute;/u);
  assert.doesNotMatch(mobileStylesheet, /@media \(max-width: 600px\) and \(max-height: 700px\)/u);
  for (const mobile360Block of mobile360Blocks) assert.doesNotMatch(mobile360Block, /\.hero-(?:subtitle|title)/u);

  assert.match(stylesheet, /@media \(min-width: 601px\) and \(max-width: 1919px\) \{[\s\S]*?\.hero-content\s*\{[\s\S]*?\.hero-subtitle,[\s\S]*?\.hero-title/u);
  assert.match(stylesheet, /@media \(min-width: 601px\) and \(max-width: 820px\) \{[\s\S]*?\.hero-content\s*\{[\s\S]*?\.hero-actions/u);
  assert.doesNotMatch(style500Block, /\.hero-actions/u);
  assert.doesNotMatch(styleMobileBlock, /\.(?:hero-content|hero-subtitle|hero-title|hero-actions|btn-hero|badge-visa)\b/u);
  assert.match(stylesheet, /html\[lang='el'\] \.hero-subtitle\s*\{[\s\S]*?max-width:[\s\S]*?text-wrap:\s*balance;[\s\S]*?white-space:\s*normal;/u);
  assert.match(stylesheet, /html\[lang='el'\] \.hero-title\s*\{[\s\S]*?max-width:[\s\S]*?text-wrap:\s*balance;[\s\S]*?white-space:\s*normal;/u);
});

function isTask6MobileNavigationCase({ viewport }) {
  return mobileNavigationViewports.includes(viewport);
}

function isTask3FilterCase({ route, viewport }) {
  return route.key.startsWith('home-') && filterViewports.includes(viewport);
}

test('writes the exact incomplete artifact manifest schema', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'miracon-browser-manifest-test-'));
  const directory = join(parent, 'artifacts');
  try {
    const artifacts = await createArtifactRun(artifactConfiguration({ BROWSER_TEST_ARTIFACT_DIR: directory, BROWSER_TEST_RUN_TOKEN: randomUUID() }));
    await writeRunManifest(artifacts, false, []);
    const manifest = JSON.parse(await readFile(join(directory, 'run-manifest.json'), 'utf8'));
    assert.deepEqual(Object.keys(manifest).sort(), [
      'artifactDir', 'cases', 'complete', 'completedAt', 'externalRequests', 'pid', 'routes', 'runId', 'runToken', 'schemaVersion', 'startedAt', 'viewports',
    ]);
    assert.equal(manifest.complete, false);
    assert.equal(manifest.artifactDir, directory);
    assert.deepEqual(manifest.externalRequests, []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('does not publish a complete manifest when cleanup fails', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'miracon-browser-cleanup-test-'));
  const directory = join(parent, 'artifacts');
  try {
    const artifacts = await createArtifactRun(artifactConfiguration({ BROWSER_TEST_ARTIFACT_DIR: directory, BROWSER_TEST_RUN_TOKEN: randomUUID() }));
    await writeRunManifest(artifacts, false, []);
    await assert.rejects(
      finalizeRun({ artifacts, externalRequests: [], succeeded: true, cleanup: async () => { throw new Error('cleanup failed'); } }),
      /cleanup failed/u,
    );
    const manifest = JSON.parse(await readFile(join(directory, 'run-manifest.json'), 'utf8'));
    assert.equal(manifest.complete, false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('publishes a complete manifest only after successful cleanup', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'miracon-browser-cleanup-test-'));
  const directory = join(parent, 'artifacts');
  try {
    const artifacts = await createArtifactRun(artifactConfiguration({ BROWSER_TEST_ARTIFACT_DIR: directory, BROWSER_TEST_RUN_TOKEN: randomUUID() }));
    await writeRunManifest(artifacts, false, []);
    await finalizeRun({
      artifacts,
      externalRequests: [],
      succeeded: true,
      cleanup: async () => {
        const manifest = JSON.parse(await readFile(join(directory, 'run-manifest.json'), 'utf8'));
        assert.equal(manifest.complete, false);
      },
    });
    const manifest = JSON.parse(await readFile(join(directory, 'run-manifest.json'), 'utf8'));
    assert.equal(manifest.complete, true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('uses explicit application readiness instead of network idle for browser cases', async () => {
  const testSource = await readFile(fileURLToPath(import.meta.url), 'utf8');
  const runCaseStart = testSource.indexOf('\nasync function runCase({');
  const runCaseSource = testSource.slice(runCaseStart, testSource.indexOf('\nasync function assertLocalizedChrome(', runCaseStart));
  const navigation = runCaseSource.indexOf("await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'domcontentloaded' })");
  const application = runCaseSource.indexOf("await page.locator('header.header').waitFor({ state: 'visible', timeout: pageReadyTimeoutMilliseconds })");
  const scripting = runCaseSource.indexOf("await page.locator('body.js-enabled').waitFor({ state: 'attached', timeout: pageReadyTimeoutMilliseconds })");
  const viewport = runCaseSource.indexOf('assert.equal(await page.evaluate(() => window.innerWidth), viewport.width);');
  const fonts = runCaseSource.indexOf("await document.fonts.load('400 48px Gilroy', 'Πολυτελείς Κατοικίες');");

  assert.doesNotMatch(runCaseSource, /waitUntil:\s*'networkidle'/u);
  assert.match(testSource, /const pageReadyTimeoutMilliseconds = 10_000;/u);
  assert.equal(navigation >= 0, true, 'Each browser case must wait for DOM content rather than global network idleness');
  assert.equal(application > navigation, true, 'Each browser case must wait for its public header before layout assertions');
  assert.equal(scripting > application, true, 'Each browser case must wait for public behavior initialization before layout assertions');
  assert.equal(viewport > scripting, true, 'Each browser case must verify the requested viewport after application readiness');
  assert.equal(fonts > viewport, true, 'Each browser case must load Gilroy after application and viewport readiness');
});

test('runs the built standalone public localization fixture', { timeout: 180_000 }, async () => {
  await requireBuiltStandaloneEntry();
  const databaseUrl = requireSafeDatabaseTestUrl();
  const artifacts = await createArtifactRun(artifactConfiguration(process.env));
  let mediaRoot;
  let database;
  let server;
  let browser;
  let context;
  let previewContext;
  let complete = false;
  const externalRequests = [];
  const unknownExternalRequests = [];
  try {
    await writeRunManifest(artifacts, false, externalRequests);
    mediaRoot = await mkdtemp(join(tmpdir(), 'miracon-browser-media-'));
    database = await openClient(databaseUrl, 'miracon-browser-localization-test');
    await resetSchemas(database, databaseUrl);
    await migrate(databaseUrl);
    await seedProjects(database);
    await provisionSingletonAdmin({ databaseUrl, ...fixtureAdmin });
    await database.query('update miracon.homepage_videos set is_active = false');
    await assertSeedOracle(database);
    const port = await freeLoopbackPort();
    const baseUrl = `http://localhost:${port}`;
    server = startStandalone({ baseUrl, databaseUrl, mediaRoot, port });
    await waitForHealth(baseUrl, server);
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ serviceWorkers: 'block' });
    await configureContextRouting(context, { baseUrl, externalRequests, unknownExternalRequests });
    for (const { route, viewport } of casePlan) {
      const caseRecord = await runCase({ context, baseUrl, route, viewport, externalRequests, unknownExternalRequests, artifacts });
      artifacts?.cases.push(caseRecord);
    }
    for (const { route, viewport } of availabilityDetailCasePlan) {
      await runCase({ context, baseUrl, route, viewport, externalRequests, unknownExternalRequests, artifacts: null });
    }
    await transitionFixtureToDraft(database, 'browser-city-seven');
    const previewBaseUrl = baseUrl;
    previewContext = await createAuthenticatedPreviewContext(browser, {
      baseUrl: previewBaseUrl,
      externalRequests,
      unknownExternalRequests,
    });
    for (const { route, viewport } of previewCasePlan) {
      await runCase({ context: previewContext, baseUrl: previewBaseUrl, route, viewport, externalRequests, unknownExternalRequests, artifacts: null });
    }
    assert.deepEqual(unknownExternalRequests, []);
    assert.equal(externalRequests.every((request) => actionEnum.has(request.action)), true);
    await assertCompleteArtifacts(artifacts);
    complete = true;
  } finally {
    await finalizeRun({
      artifacts,
      externalRequests,
      succeeded: complete,
      cleanup: () => closeFixture({ context, previewContext, browser, server, database, mediaRoot }),
    });
  }
});

async function createArtifactRun(configuration) {
  if (!configuration) return null;
  try {
    const entries = await readdir(configuration.directory);
    if (entries.length > 0) throw new Error('BROWSER_TEST_ARTIFACT_DIR must be absent or empty');
  } catch (error) {
    if (!(error && error.code === 'ENOENT')) throw error;
  }
  await mkdir(join(configuration.directory, 'screenshots'), { recursive: true });
  await mkdir(join(configuration.directory, 'assertions'), { recursive: true });
  return {
    directory: configuration.directory,
    runId: randomUUID(),
    runToken: configuration.runToken,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cases: [],
  };
}

function routeAction(url, resourceType, baseUrl) {
  if (url.origin === baseUrl) return 'continue-same-origin';
  if ((url.hostname === 'fonts.googleapis.com' || url.hostname === 'cdn.jsdelivr.net') && resourceType === 'stylesheet') return 'fulfill-empty-css';
  if (url.hostname === 'web3forms.com' && resourceType === 'script') return 'fulfill-empty-js';
  if (url.hostname === 'fonts.gstatic.com' && resourceType === 'font') return 'fulfill-no-content';
  return 'reject-unknown-external';
}

async function configureContextRouting(context, routing) {
  await context.route('**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const action = routeAction(url, request.resourceType(), routing.baseUrl);
    const record = { url: url.href, origin: url.origin, resourceType: request.resourceType(), action };
    routing.externalRequests.push(record);
    if (action === 'continue-same-origin') return route.continue();
    if (action === 'fulfill-empty-css') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (action === 'fulfill-empty-js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    if (action === 'fulfill-no-content') return route.fulfill({ status: 204 });
    routing.unknownExternalRequests.push(record);
    return route.abort('blockedbyclient');
  });
}

async function createAuthenticatedPreviewContext(browser, routing) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await configureContextRouting(context, routing);
  const login = await context.request.post(`${routing.baseUrl}/api/auth/login`, {
    data: fixtureAdmin,
    headers: { origin: routing.baseUrl },
  });
  assert.equal(login.status(), 200, 'Fixture administrator must authenticate through the public login endpoint');
  const session = await context.request.get(`${routing.baseUrl}/api/auth/session`);
  assert.equal(session.status(), 200, 'Authenticated preview context must retain the issued session cookie');
  return context;
}

async function runCase({ context, baseUrl, route, viewport, externalRequests, unknownExternalRequests, artifacts }) {
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const requestStart = externalRequests.length;
  const unknownStart = unknownExternalRequests.length;
  const caseId = `${route.key}__${viewport.width}x${viewport.height}`;
  try {
    await page.setViewportSize(viewport);
    let response;
    try {
      response = await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      throwUnknownExternalRequest(unknownExternalRequests.slice(unknownStart), error);
      throw error;
    }
    throwUnknownExternalRequest(unknownExternalRequests.slice(unknownStart));
    assert.equal(response?.status(), 200, `${route.key} should respond successfully`);
    await page.locator('header.header').waitFor({ state: 'visible', timeout: pageReadyTimeoutMilliseconds });
    await page.locator('body.js-enabled').waitFor({ state: 'attached', timeout: pageReadyTimeoutMilliseconds });
    assert.equal(await page.evaluate(() => window.innerWidth), viewport.width);
    const fonts = await page.evaluate(async () => {
      await document.fonts.load('400 48px Gilroy', 'Πολυτελείς Κατοικίες');
      await document.fonts.load('600 15px Gilroy', 'Επικοινωνία');
      await document.fonts.ready;
      return {
        gilroy400: document.fonts.check('400 48px Gilroy', 'Πολυτελείς Κατοικίες'),
        gilroy600: document.fonts.check('600 15px Gilroy', 'Επικοινωνία'),
      };
    });
    assert.equal(fonts.gilroy400, true);
    assert.equal(fonts.gilroy600, true);
    const locale = await page.locator('html').getAttribute('lang');
    assert.equal(locale, route.locale ?? (route.key.endsWith('-el') ? 'el' : 'en'));
    await assertLocalizedChrome(page, route.chrome ?? chromeByRoute[route.key]);
    await assertTranslationBoundaries(page, route.key.startsWith('home-'), route.editorialRoot ?? editorialRootByRoute[route.key]);
    const header = await assertHeaderLayout(page, viewport);
    const mobileNavigation = isTask6MobileNavigationCase({ route, viewport })
      ? await assertMobileNavigationInteraction(page, chromeByRoute[route.key], viewport)
      : null;
    if (route.key.startsWith('home-')) {
      await assertFilterOracle(page, locale);
      if (isTask3FilterCase({ route, viewport })) await assertFilterCircle(page, filterLabels[locale]);
    }
    if (route.key.startsWith('home-') || route.key.startsWith('golden-visa-')) await assertProjectCardsHaveNoAvailability(page);
    if (route.availability !== undefined) {
      await assertProjectAvailability(page, { title: route.title, availability: route.availability });
      await assertNoHorizontalOverflow(page, viewport);
    }
    if (route.preview) await assertPreviewResponse(page, response, route.preview);
    const hero = route.key.startsWith('home-') ? await assertHomeHeroLayout(page, homeHeroByLocale[locale]) : null;
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    const assertion = {
      schemaVersion: artifactSchemaVersion,
      runId: artifacts?.runId ?? null,
      runToken: artifacts?.runToken ?? null,
      caseId,
      routeKey: route.key,
      path: route.path,
      viewport,
      fonts,
      windowInnerWidth: viewport.width,
      locale,
      elements: await captureElements(page, route.key.startsWith('home-') ? [...headerElementSelectors, ...homeHeroElementSelectors, '.filter-tabs', '.project-card'] : headerElementSelectors),
      header,
      mobileNavigation,
      hero,
      overlaps: [],
      consoleErrors,
      pageErrors,
      externalRequests: externalRequests.slice(requestStart),
    };
    if (artifacts) {
      assertAssertionSchema(assertion, artifacts, route, viewport, caseId);
      await page.screenshot({ path: join(artifacts.directory, 'screenshots', `${caseId}.png`), fullPage: true });
      await writeFile(join(artifacts.directory, 'assertions', `${caseId}.json`), `${JSON.stringify(assertion, null, 2)}\n`);
    }
    return { caseId, routeKey: route.key, path: route.path, width: viewport.width, height: viewport.height, screenshot: `screenshots/${caseId}.png`, assertionFile: `assertions/${caseId}.json` };
  } finally {
    await page.close();
  }
}

async function assertLocalizedChrome(page, expected) {
  const links = await page.locator('.header .nav-menu .nav-link').evaluateAll((items) => items.map((item) => ({ href: item.getAttribute('href'), label: item.textContent?.trim() })));
  assert.deepEqual(links.map(({ href, label }) => ({ href: normalizeChromeHref(href), label })), expected.links.map(([href, label]) => ({ href: normalizeChromeHref(href), label })));
  const languageSelector = page.locator('.header .lang-selector');
  assert.equal(normalizeChromeHref(await languageSelector.getAttribute('href')), normalizeChromeHref(expected.languageHref));
  assert.equal(await languageSelector.getAttribute('hreflang'), expected.languageCode === 'EN' ? 'el' : 'en');
  assert.equal(await languageSelector.getAttribute('aria-label'), expected.language);
  assert.equal((await languageSelector.textContent())?.trim(), expected.languageCode);
  if (expected.languageCode !== 'EL') return;
  const visibleHeaderLabels = await page.locator('.header .nav-link:visible').allTextContents();
  assert.equal(visibleHeaderLabels.includes('Projects'), false);
  assert.equal(visibleHeaderLabels.includes('About us'), false);
  assert.equal(visibleHeaderLabels.includes('Contacts'), false);
}

function normalizeChromeHref(href) {
  if (href === null) return href;
  const internalOrigin = 'https://miracon.test';
  const url = new URL(href, internalOrigin);
  if (url.origin !== internalOrigin) return href;
  const pathname = url.pathname !== '/' && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  return `${pathname}${url.search}${url.hash}`;
}

function projectChrome(locale, slug, category, routeKind = 'projects') {
  const routePath = `/${routeKind}/${slug}`;
  if (locale === 'el') {
    return {
      links: [[`/el/?filter=${category}#projects`, 'Έργα'], ['/el/golden-visa', 'Golden Visa'], ['/el/#about', 'Σχετικά με εμάς'], [`/el${routePath}#contacts`, 'Επικοινωνία']],
      languageHref: routePath,
      language: 'English',
      languageCode: 'EL',
    };
  }
  return {
    links: [[`/?filter=${category}#projects`, 'Projects'], ['/golden-visa', 'Golden Visa'], ['/#about', 'About us'], [`${routePath}#contacts`, 'Contacts']],
    languageHref: `/el${routePath}`,
    language: 'Ελληνικά',
    languageCode: 'EN',
  };
}

async function assertProjectAvailability(page, expected) {
  assert.equal((await page.locator('#project-title').textContent())?.trim(), expected.title);
  const availability = page.locator('p.project-availability');
  if (expected.availability === null) {
    assert.equal(await availability.count(), 0, 'Unknown availability must not render a project availability marker');
    return;
  }
  assert.equal(await availability.count(), 1);
  assert.equal(await availability.getAttribute('data-availability'), expected.availability.dataAvailability);
  assert.equal((await availability.textContent())?.trim(), expected.availability.text);
}

async function assertProjectCardsHaveNoAvailability(page) {
  const cards = page.locator('.project-card');
  assert.ok(await cards.count(), 'Expected rendered project cards');
  assert.equal(await cards.locator('.project-availability').count(), 0, 'Project cards must not render detail availability markers');
  assert.equal(await cards.locator('[data-availability]').count(), 0, 'Project cards must not expose availability data');
  const cardText = await cards.allTextContents();
  for (const availabilityText of ['Sold out', 'units available', 'Εξαντλήθηκε', 'διαθέσιμες κατοικίες']) {
    assert.equal(cardText.some((text) => text.includes(availabilityText)), false, `Project cards must not render ${availabilityText}`);
  }
}

async function assertNoHorizontalOverflow(page, viewport) {
  const overflow = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    windowInnerWidth: window.innerWidth,
  }));
  assert.equal(overflow.windowInnerWidth, viewport.width);
  assert.equal(overflow.documentScrollWidth <= overflow.windowInnerWidth, true, 'Detail surface must not overflow horizontally');
  assert.equal(overflow.bodyScrollWidth <= overflow.windowInnerWidth, true, 'Detail body must not overflow horizontally');
}

async function assertPreviewResponse(page, response, expectedBanner) {
  assert.equal(await response?.headerValue('cache-control'), 'private, no-store');
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex,nofollow,noarchive');
  assert.equal((await page.locator('.project-preview-banner').textContent())?.trim(), expectedBanner);
}

async function assertTranslationBoundaries(page, isHome, editorialSelector) {
  assert.equal(await page.locator('meta[name="google"][content="notranslate"]').count(), 0);
  const header = page.locator('header.header');
  assert.equal(await header.count(), 1);
  assert.equal(await header.getAttribute('translate'), 'no');
  assert.equal((await header.getAttribute('class') ?? '').split(/\s+/u).includes('notranslate'), true);
  assert.equal(await header.locator('.nav-menu').count(), 1);
  assert.equal(await header.locator('.nav-menu .nav-link').count(), 4);
  assert.equal(await header.locator('.mobile-nav').count(), 1);
  assert.equal(await header.locator('.mobile-nav .mobile-nav-link').count(), 3);
  for (const selector of ['html', 'body', 'main']) {
    const element = page.locator(selector);
    assert.equal(await element.getAttribute('translate'), null);
    assert.equal((await element.getAttribute('class') ?? '').split(/\s+/u).includes('notranslate'), false);
  }
  const editorialRoot = page.locator(editorialSelector);
  assert.equal(await editorialRoot.count(), 1);
  assert.equal(await editorialRoot.getAttribute('translate'), null);
  assert.equal((await editorialRoot.getAttribute('class') ?? '').split(/\s+/u).includes('notranslate'), false);
  if (!isHome) return;
  assert.equal(await page.locator('.hero-content.notranslate[translate="no"]').count(), 1);
  assert.equal(await page.locator('.filter-tabs.notranslate[translate="no"]').count(), 1);
}

async function assertHeaderLayout(page, viewport) {
  const header = await page.evaluate((selectors) => {
    const headerContainer = document.querySelector('.header-container');
    if (!(headerContainer instanceof HTMLElement)) throw new Error('Expected one header container');
    const containerStyle = getComputedStyle(headerContainer);
    const controls = Object.fromEntries(selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`Expected ${selector}`);
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      return [selector, {
        visible,
        rect: visible ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      }];
    }));
    return {
      display: containerStyle.display,
      gridTemplateColumns: containerStyle.gridTemplateColumns,
      controls,
    };
  }, headerElementSelectors);
  const compact = viewport.width < 1280;
  const desktopControls = ['.header .nav-menu', '.header .header-actions', '.header .lang-selector', '.header .contact-menu'];
  const mobileControls = ['.header .mobile-lang-selector', '.header .mobile-menu-btn'];
  const hiddenControls = compact
    ? ['.header .nav-menu .nav-link', '.header .lang-selector', '.header .contact-btn', '.header .mobile-nav .mobile-nav-link', '.header .mobile-nav-contact', '.header .mobile-nav-contacts a']
    : ['.header .mobile-lang-selector', '.header .mobile-menu-btn', '.header .mobile-nav .mobile-nav-link', '.header .mobile-nav-contact', '.header .mobile-nav-contacts a'];
  const visibleControls = compact
    ? mobileControls
    : ['.header .nav-menu .nav-link', '.header .lang-selector', '.header .contact-btn'];

  for (const selector of desktopControls) assert.equal(header.controls[selector].visible, !compact, `${selector} mode visibility at ${viewport.width}px`);
  for (const selector of mobileControls) assert.equal(header.controls[selector].visible, compact, `${selector} mode visibility at ${viewport.width}px`);
  for (const { rect, visible } of Object.values(header.controls)) {
    if (!visible) continue;
    assert.ok(rect);
    assert.equal(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width && rect.y + rect.height <= viewport.height, true, `Header control must remain in the ${viewport.width}px viewport`);
  }
  const focus = await assertHeaderKeyboardTraversal(page, { hiddenControls, visibleControls });

  const navRect = header.controls['.header .nav-menu'].rect;
  const actionsRect = header.controls['.header .header-actions'].rect;
  const overlap = navRect && actionsRect ? rectangleIntersectionArea(navRect, actionsRect) : 0;
  assert.equal(overlap, 0, `Desktop navigation and actions must not overlap at ${viewport.width}px`);
  if (!compact) {
    assert.equal(header.display, 'grid');
    assert.equal(header.gridTemplateColumns.trim().split(/\s+/u).length, 3);
  }
  return { ...header, mode: compact ? 'compact' : 'desktop', focus, overlaps: [{ selectors: ['.header .nav-menu', '.header .header-actions'], area: overlap }] };
}

async function assertHeaderKeyboardTraversal(page, { hiddenControls, visibleControls }) {
  let { candidates, candidateLimit } = await readHeaderKeyboardFocusState(page);
  assert.ok(candidates.length > 0, 'Expected at least one keyboard-focusable header control');

  await page.locator('body').focus();
  const traversed = [];
  while (traversed.length < candidates.length) {
    assert.ok(traversed.length < candidateLimit, 'Header Tab traversal exceeded the actual header control count');
    await page.keyboard.press('Tab');
    const state = await readHeaderKeyboardFocusState(page);
    traversed.push(state.active);
    candidates = state.candidates;
    candidateLimit = state.candidateLimit;
  }

  assert.deepEqual(traversed, candidates, 'Tab traversal must visit every visible header focus target in document order');
  const traversedSelectors = traversed.map(({ selector }) => selector);
  for (const selector of hiddenControls) {
    assert.equal(traversedSelectors.includes(selector), false, `${selector} must never become document.activeElement in the hidden header mode`);
  }
  for (const selector of visibleControls) {
    assert.equal(traversedSelectors.includes(selector), true, `${selector} must become document.activeElement in the visible header mode`);
  }

  return { candidates, traversed, hiddenControls, visibleControls, tabCount: candidates.length };
}

async function readHeaderKeyboardFocusState(page) {
  return page.evaluate(() => {
    const header = document.querySelector('header.header');
    if (!(header instanceof HTMLElement)) throw new Error('Expected one header');
    const focusSelector = (element) => {
      if (element.matches('.logo')) return '.header .logo';
      if (element.matches('.nav-menu .nav-link')) return '.header .nav-menu .nav-link';
      if (element.matches('.lang-selector')) return '.header .lang-selector';
      if (element.matches('.contact-btn')) return '.header .contact-btn';
      if (element.matches('.mobile-lang-selector')) return '.header .mobile-lang-selector';
      if (element.matches('.mobile-menu-btn')) return '.header .mobile-menu-btn';
      if (element.matches('.mobile-nav .mobile-nav-link')) return '.header .mobile-nav .mobile-nav-link';
      if (element.matches('.mobile-nav-contact')) return '.header .mobile-nav-contact';
      if (element.matches('.mobile-nav-contacts a')) return '.header .mobile-nav-contacts a';
      return `header ${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`;
    };
    const allCandidates = [...header.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    const candidates = allCandidates
      .filter((element) => {
        if (!(element instanceof HTMLElement) || element.tabIndex < 0) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
    const focusTargets = candidates.map((element, index) => ({ selector: focusSelector(element), index }));
    const activeIndex = candidates.indexOf(document.activeElement);
    return {
      candidates: focusTargets,
      active: activeIndex === -1 ? null : focusTargets[activeIndex],
      candidateLimit: allCandidates.length,
    };
  });
}

function rectangleIntersectionArea(first, second) {
  const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
  const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
  return width * height;
}

async function assertHomeHeroLayout(page, expected) {
  const details = await page.evaluate(() => {
    const selectors = ['.hero', '.hero-title', '.hero-actions', '.btn-hero', '.badge-visa'];
    const toRect = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const elements = Object.fromEntries(selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`Expected ${selector}`);
      const style = getComputedStyle(element);
      const rect = toRect(element);
      const textRange = document.createRange();
      textRange.selectNodeContents(element);
      const textRect = textRange.getBoundingClientRect();
      const textClipped = textRect.left < rect.x
        || textRect.top < rect.y
        || textRect.right > rect.x + rect.width
        || textRect.bottom > rect.y + rect.height;
      return [selector, {
        rect,
        visible: element.checkVisibility(),
        clipped: selector === '.badge-visa'
          ? textClipped
          : element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
        href: element instanceof HTMLAnchorElement ? element.getAttribute('href') ?? '' : '',
        text: element.textContent?.trim() ?? '',
      }];
    }));
    const title = document.querySelector('.hero-title');
    if (!(title instanceof HTMLHeadingElement)) throw new Error('Expected one hero title');
    const titleRange = document.createRange();
    titleRange.selectNodeContents(title);
    return {
      elements,
      subtitle: document.querySelector('.hero-subtitle')?.textContent?.trim() ?? '',
      titleLines: Array.from(title.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim())
        .filter(Boolean),
      titleBreaks: title.querySelectorAll(':scope > br').length,
      titleTextRect: toRect(titleRange),
      titleOverflow: getComputedStyle(title).overflow,
    };
  });
  const { elements } = details;
  const hero = elements['.hero'].rect;

  assert.equal(details.subtitle, expected.subtitle);
  assert.deepEqual(details.titleLines, expected.titleLines);
  assert.equal(details.titleBreaks, 1);
  assert.deepEqual({ href: elements['.btn-hero'].href, label: elements['.btn-hero'].text }, expected.cta);
  assert.deepEqual({ href: elements['.badge-visa'].href, label: elements['.badge-visa'].text }, expected.badge);
  for (const selector of homeHeroElementSelectors) {
    const element = elements[selector];
    assert.equal(element.visible, true, `${selector} must be visible`);
    assert.equal(element.rect.width > 0 && element.rect.height > 0, true, `${selector} must have a nonzero rectangle`);
    if (selector !== '.hero-title') assert.equal(element.clipped, false, `${selector} must not clip its own content`);
    assert.equal(element.rect.x >= hero.x && element.rect.y >= hero.y && element.rect.x + element.rect.width <= hero.x + hero.width && element.rect.y + element.rect.height <= hero.y + hero.height, true, `${selector} must stay inside the hero`);
  }
  const title = elements['.hero-title'].rect;
  assert.equal(details.titleOverflow, 'visible', 'Hero title text must not be hidden by overflow');
  assert.equal(
    details.titleTextRect.x >= hero.x - heroTextGeometryTolerance
      && details.titleTextRect.y >= hero.y - heroTextGeometryTolerance
      && details.titleTextRect.x + details.titleTextRect.width <= hero.x + hero.width + heroTextGeometryTolerance
      && details.titleTextRect.y + details.titleTextRect.height <= hero.y + hero.height + heroTextGeometryTolerance,
    true,
    'Hero title text must stay within the hero geometry',
  );
  const actions = elements['.hero-actions'].rect;
  const cta = elements['.btn-hero'].rect;
  const badge = elements['.badge-visa'].rect;
  const ctaBadgeIntersection = rectangleIntersectionArea(cta, badge);
  assert.equal(title.y + title.height <= actions.y, true, 'Hero title must end before hero actions');
  assert.equal(ctaBadgeIntersection, 0, 'Hero CTA and Golden Visa badge must not overlap');
  return {
    subtitle: details.subtitle,
    titleLines: details.titleLines,
    elements,
    overlaps: [
      { selectors: ['.hero-title', '.hero-actions'], area: rectangleIntersectionArea(title, actions) },
      { selectors: ['.btn-hero', '.badge-visa'], area: ctaBadgeIntersection },
    ],
  };
}

async function assertMobileNavigationInteraction(page, expected, viewport) {
  const expectedMenu = mobileMenuByLanguageCode[expected.languageCode];
  const header = page.locator('header.header');
  const menuButton = header.locator('.mobile-menu-btn');
  const mobileNavigation = header.locator('.mobile-nav');
  const contactButton = mobileNavigation.locator('.mobile-nav-contact');
  const contactDetails = mobileNavigation.locator('.mobile-nav-contacts');
  const hiddenSelectors = ['.header .mobile-nav .mobile-nav-link', '.header .mobile-nav-contact', '.header .mobile-nav-contacts a'];

  const initial = await readMobileNavigationState(page);
  assertClosedMobileNavigationState(initial, expectedMenu);
  const initialFocus = await readHeaderKeyboardFocusState(page);
  for (const selector of hiddenSelectors) {
    assert.equal(initialFocus.candidates.some((candidate) => candidate.selector === selector), false, `${selector} must not be keyboard-focusable while the mobile menu is closed`);
  }

  await menuButton.click();
  await waitForMobileNavigationVisibility(page, true);
  const opened = await readMobileNavigationState(page);
  assert.equal(opened.menuButton.active, true);
  assert.equal(opened.menuButton.ariaExpanded, 'true');
  assert.equal(opened.menuButton.ariaLabel, expectedMenu.closeMenuLabel);
  assert.equal(opened.navigation.active, true);
  assert.equal(opened.navigation.ariaHidden, 'false');
  assert.equal(opened.navigation.ariaLabel, expectedMenu.navigationLabel);
  assert.equal(opened.navigation.visible, true);
  assert.deepEqual(opened.navigation.links, expected.links.slice(0, 3).map(([href, label]) => ({ href, label })));
  assert.equal(opened.contact.ariaExpanded, 'false');
  assert.equal(opened.contact.label, expected.links[3][1]);
  assert.equal(opened.contactDetails.active, false);
  assert.equal(opened.contactDetails.ariaHidden, 'true');
  assert.equal(opened.contactDetails.visible, false);
  assertViewportContainment(opened, viewport);

  await contactButton.click();
  const contactExpanded = await readMobileNavigationState(page);
  assert.equal(contactExpanded.contact.ariaExpanded, 'true');
  assert.equal(contactExpanded.contactDetails.active, true);
  assert.equal(contactExpanded.contactDetails.ariaHidden, 'false');
  assert.equal(contactExpanded.contactDetails.visible, true);
  assert.deepEqual(contactExpanded.contactDetails.links, expectedMenu.contactLinks);
  assertViewportContainment(contactExpanded, viewport);
  const contactExpandedFocus = await readHeaderKeyboardFocusState(page);
  assert.equal(contactExpandedFocus.candidates.filter((candidate) => candidate.selector === '.header .mobile-nav-contacts a').length, 3, 'Expanded contact details must expose all three contact links to keyboard users');

  await page.keyboard.press('Escape');
  await waitForMobileNavigationVisibility(page, false);
  const closed = await readMobileNavigationState(page);
  assertClosedMobileNavigationState(closed, expectedMenu);
  assert.equal(closed.focus.selector, '.header .mobile-menu-btn');
  const closedFocus = await readHeaderKeyboardFocusState(page);
  for (const selector of hiddenSelectors) {
    assert.equal(closedFocus.candidates.some((candidate) => candidate.selector === selector), false, `${selector} must not be keyboard-focusable after Escape closes the mobile menu`);
  }
  assert.equal(await menuButton.getAttribute('aria-controls'), 'mobileNav');
  assert.equal(await contactButton.getAttribute('aria-controls'), 'mobileContactDetails');
  assert.equal(await contactDetails.getAttribute('id'), 'mobileContactDetails');

  return { initial, initialFocus, opened, contactExpanded, contactExpandedFocus, closed, closedFocus };
}

async function waitForMobileNavigationVisibility(page, expectedOpen) {
  await page.waitForFunction((expectedOpen) => {
    const navigation = document.querySelector('.mobile-nav');
    if (!(navigation instanceof HTMLElement)) return false;
    const style = getComputedStyle(navigation);
    const opacity = Number(style.opacity);
    if (navigation.classList.contains('active') !== expectedOpen) return false;
    return expectedOpen
      ? style.visibility === 'visible' && opacity >= .99
      : style.visibility === 'hidden' && opacity <= .01;
  }, expectedOpen, { timeout: pageReadyTimeoutMilliseconds });
}

function assertClosedMobileNavigationState(state, expectedMenu) {
  assert.equal(state.menuButton.active, false);
  assert.equal(state.menuButton.ariaExpanded, 'false');
  assert.equal(state.menuButton.ariaLabel, expectedMenu.openMenuLabel);
  assert.equal(state.navigation.active, false);
  assert.equal(state.navigation.ariaHidden, 'true');
  assert.equal(state.navigation.visible, false);
  assert.equal(state.contact.ariaExpanded, 'false');
  assert.equal(state.contactDetails.active, false);
  assert.equal(state.contactDetails.ariaHidden, 'true');
  assert.equal(state.contactDetails.visible, false);
}

function assertViewportContainment(state, viewport) {
  assert.equal(state.overflow.windowInnerWidth, viewport.width, 'Mobile navigation geometry must use the requested viewport width');
  assert.equal(state.overflow.documentScrollWidth <= state.overflow.windowInnerWidth, true, 'Document must not overflow horizontally when the mobile menu is visible');
  assert.equal(state.overflow.bodyScrollWidth <= state.overflow.windowInnerWidth, true, 'Body must not overflow horizontally when the mobile menu is visible');
  for (const { selector, rect } of state.visibleRectangles) {
    assert.equal(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width && rect.y + rect.height <= viewport.height, true, `${selector} must remain contained in the ${viewport.width}x${viewport.height} viewport`);
  }
}

async function readMobileNavigationState(page) {
  return page.evaluate(() => {
    const menuButton = document.querySelector('.mobile-menu-btn');
    const navigation = document.querySelector('.mobile-nav');
    const contactButton = document.querySelector('.mobile-nav-contact');
    const contactDetails = document.querySelector('.mobile-nav-contacts');
    if (!(menuButton instanceof HTMLButtonElement) || !(navigation instanceof HTMLElement) || !(contactButton instanceof HTMLButtonElement) || !(contactDetails instanceof HTMLElement)) {
      throw new Error('Expected complete mobile navigation controls');
    }
    const toRect = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const isRendered = (element) => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const selectorFor = (element) => {
      if (element.matches('.mobile-nav')) return '.header .mobile-nav';
      if (element.matches('.mobile-nav-link')) return '.header .mobile-nav .mobile-nav-link';
      if (element.matches('.mobile-nav-contact')) return '.header .mobile-nav-contact';
      if (element.matches('.mobile-nav-contacts')) return '.header .mobile-nav-contacts';
      return '.header .mobile-nav-contacts a';
    };
    const visibleRectangles = [navigation, ...navigation.querySelectorAll('.mobile-nav-link, .mobile-nav-contact, .mobile-nav-contacts, .mobile-nav-contacts a')]
      .filter((element) => element instanceof HTMLElement && isRendered(element))
      .map((element) => ({ selector: selectorFor(element), rect: toRect(element) }));
    const detailLinks = [...contactDetails.querySelectorAll('a')].map((link) => ({ href: link.getAttribute('href'), label: link.textContent?.trim() }));
    const mobileLinks = [...navigation.querySelectorAll('.mobile-nav-link')].map((link) => ({ href: link.getAttribute('href'), label: link.textContent?.trim() }));
    const active = document.activeElement;
    return {
      menuButton: {
        active: menuButton.classList.contains('active'),
        ariaExpanded: menuButton.getAttribute('aria-expanded'),
        ariaLabel: menuButton.getAttribute('aria-label'),
      },
      navigation: {
        active: navigation.classList.contains('active'),
        ariaHidden: navigation.getAttribute('aria-hidden'),
        ariaLabel: navigation.getAttribute('aria-label'),
        visible: isRendered(navigation),
        links: mobileLinks,
      },
      contact: {
        ariaExpanded: contactButton.getAttribute('aria-expanded'),
        label: contactButton.firstElementChild?.textContent?.trim(),
      },
      contactDetails: {
        active: contactDetails.classList.contains('active'),
        ariaHidden: contactDetails.getAttribute('aria-hidden'),
        visible: isRendered(contactDetails),
        links: detailLinks,
      },
      focus: {
        insideNavigation: active instanceof Element && navigation.contains(active),
        selector: active instanceof Element && active.matches('.mobile-menu-btn')
          ? '.header .mobile-menu-btn'
          : active instanceof Element && active.matches('.mobile-nav-link')
            ? '.header .mobile-nav .mobile-nav-link'
            : active instanceof Element && active.matches('.mobile-nav-contact')
              ? '.header .mobile-nav-contact'
              : active?.tagName.toLowerCase() ?? null,
      },
      visibleRectangles,
      overflow: {
        windowInnerWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
      },
    };
  });
}

function throwUnknownExternalRequest(requests, cause) {
  if (requests.length === 0) return;
  throw new Error(`Unknown external request rejected: ${requests.map((request) => request.url).join(', ')}`, cause ? { cause } : undefined);
}

async function captureElements(page, selectors) {
  return Object.fromEntries(await Promise.all(selectors.map(async (selector) => {
    const element = page.locator(selector).first();
    const count = await element.count();
    if (count === 0) return [selector, { visible: false, rect: null, accessibleName: '', href: '', text: '' }];
    const [visible, box, text, href, accessibleName] = await Promise.all([
      element.isVisible(), element.boundingBox(), element.textContent(), element.getAttribute('href'), element.evaluate((node) => node.getAttribute('aria-label') ?? node.textContent ?? ''),
    ]);
    return [selector, {
      visible,
      rect: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
      accessibleName: accessibleName.trim(),
      href: href ?? '',
      text: (text ?? '').trim(),
    }];
  })));
}

async function assertFilterOracle(page, locale) {
  const cards = page.locator('.project-card');
  const labels = filterLabels[locale];
  await waitForFilterColorSettle(page, 'all');
  await assertFilterTabs(page, labels, 'all');
  await assertVisibleSlugs(cards, filterOracle[0].visibleSlugs);
  for (const { filter, visibleSlugs } of filterOracle) {
    const tab = page.getByRole('button', { name: labels[filter], exact: true });
    assert.equal(await tab.count(), 1);
    await tab.click();
    await waitForFilterColorSettle(page, filter);
    await assertFilterTabs(page, labels, filter);
    await assertVisibleSlugs(cards, visibleSlugs);
  }
}

async function waitForFilterColorSettle(page, expectedActiveFilter) {
  await page.waitForFunction(({ activeColor, expectedActiveFilter, inactiveColor }) => {
    return [...document.querySelectorAll('.filter-tab')].every((button) => {
      const label = button.querySelector(':scope > span');
      if (!(label instanceof HTMLSpanElement)) return false;
      const isInteractive = button.classList.contains('active') || button.matches(':hover') || button.matches(':focus-visible');
      const expectedColor = isInteractive ? activeColor : inactiveColor;
      return button.getAttribute('data-filter') !== expectedActiveFilter
        ? getComputedStyle(label).color === expectedColor
        : button.classList.contains('active') && getComputedStyle(label).color === activeColor;
    });
  }, {
    activeColor: activeFilterTextColor,
    expectedActiveFilter,
    inactiveColor: inactiveFilterTextColor,
  }, { timeout: pageReadyTimeoutMilliseconds });
}

async function assertFilterTabs(page, labels, activeFilter) {
  const tabs = page.locator('.filter-tab');
  assert.equal(await tabs.count(), filterOracle.length);
  for (const { filter } of filterOracle) {
    const label = labels[filter];
    const tab = page.getByRole('button', { name: label, exact: true });
    assert.equal(await tab.count(), 1);
    const details = await tab.evaluate((button) => {
      const labelSpan = button.querySelector(':scope > span');
      if (!(labelSpan instanceof HTMLSpanElement)) return null;
      return {
        dataLabel: labelSpan.getAttribute('data-label'),
        directTextNodes: Array.from(labelSpan.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent?.trim())
          .filter(Boolean),
        isVisible: labelSpan.checkVisibility(),
        isActive: button.classList.contains('active'),
        isHovered: button.matches(':hover'),
        isFocusVisible: button.matches(':focus-visible'),
        color: getComputedStyle(labelSpan).color,
        transition: getComputedStyle(labelSpan).transition,
        beforeContent: getComputedStyle(labelSpan, '::before').content,
        afterContent: getComputedStyle(labelSpan, '::after').content,
      };
    });
    assert.ok(details);
    assert.deepEqual({
      dataLabel: details.dataLabel,
      directTextNodes: details.directTextNodes,
      isVisible: details.isVisible,
      beforeContent: details.beforeContent,
      afterContent: details.afterContent,
    }, {
      dataLabel: null,
      directTextNodes: [label],
      isVisible: true,
      beforeContent: 'none',
      afterContent: 'none',
    });
    assert.equal(details.isActive, filter === activeFilter);
    assert.equal(details.color, details.isActive || details.isHovered || details.isFocusVisible ? activeFilterTextColor : inactiveFilterTextColor);
    assert.equal(details.transition.includes('color'), true);
  }
  const pressedTabs = await tabs.evaluateAll((items) => items
    .filter((tab) => tab.getAttribute('aria-pressed') === 'true')
    .map((tab) => tab.getAttribute('data-filter')));
  assert.deepEqual(pressedTabs, [activeFilter]);
}

async function assertFilterCircle(page, labels) {
  const tab = page.getByRole('button', { name: labels.coastal, exact: true });
  await assertFilterCircleState(tab, 0);

  await tab.hover();
  await waitForFilterCircleScale(tab, 1);
  await assertFilterCircleState(tab, 1);

  await page.mouse.move(0, 0);
  await waitForFilterCircleScale(tab, 0);
  await assertFilterCircleState(tab, 0);

  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await tab.evaluate((element) => document.activeElement === element), true);
  await waitForFilterCircleScale(tab, 1);
  await assertFilterCircleState(tab, 1);

  await tab.evaluate((element) => element.blur());
  await waitForFilterCircleScale(tab, 0);
  await assertFilterCircleState(tab, 0);

  await tab.click();
  await waitForFilterCircleScale(tab, 1);
  await assertFilterCircleState(tab, 1, true);
}

async function waitForFilterCircleScale(tab, expectedScale) {
  await tab.evaluate(async (button, { expectedScale, timeout }) => {
    const deadline = performance.now() + timeout;
    await new Promise((resolve, reject) => {
      const check = () => {
        const transform = getComputedStyle(button, '::before').transform;
        const scale = Number(transform.match(/^matrix\(([^,]+)/u)?.[1]);
        if (Math.abs(scale - expectedScale) < .001) return resolve();
        if (performance.now() >= deadline) return reject(new Error(`Filter circle did not settle at scale ${expectedScale}`));
        requestAnimationFrame(check);
      };
      check();
    });
  }, { expectedScale, timeout: pageReadyTimeoutMilliseconds });
}

async function assertFilterCircleState(tab, expectedScale, requiresActive = false) {
  const details = await tab.evaluate((button) => {
    const styles = getComputedStyle(button, '::before');
    const matrix = styles.transform.match(/^matrix\(([^,]+)/u);
    return {
      active: button.classList.contains('active'),
      backgroundColor: getComputedStyle(button).backgroundColor,
      beforeBackgroundColor: styles.backgroundColor,
      content: styles.content,
      display: styles.display,
      width: styles.width,
      aspectRatio: styles.aspectRatio,
      transition: styles.transition,
      scaleX: matrix ? Number(matrix[1]) : Number.NaN,
    };
  });
  assert.equal(details.content, '""');
  assert.notEqual(details.display, 'none');
  assert.equal(Number.parseFloat(details.width) > 0, true);
  assert.equal(details.aspectRatio, '1 / 1');
  assert.equal(details.transition.includes('transform'), true);
  assert.equal(details.transition.includes('0.42s'), true);
  assert.equal(Math.abs(details.scaleX - expectedScale) < .001, true);
  if (expectedScale === 1) {
    assert.equal(details.beforeBackgroundColor, inactiveFilterTextColor);
    assert.notEqual(details.backgroundColor, details.beforeBackgroundColor);
  }
  if (requiresActive) assert.equal(details.active, true);
}

async function assertVisibleSlugs(cards, expected) {
  const visibility = await cards.evaluateAll((items) => items.map((item) => ({
    slug: item.dataset.projectSlug,
    visible: getComputedStyle(item).display !== 'none',
  })));
  const visible = visibility.filter((item) => item.visible).map((item) => item.slug);
  assert.deepEqual(visible, expected);
  if (expected.length < visibility.length) {
    assert.equal(visibility.some((item) => !item.visible), true);
  }
}

async function seedProjects(database) {
  for (const project of availabilityProjects) {
    await database.query('select miracon.save_project_with_images($1::jsonb, $2::jsonb)', [JSON.stringify({
      id: project.slug,
      slug: project.slug,
      title: project.title,
      address: 'Test address',
      card_address: 'Test address',
      price: 'EUR 100,000',
      short_description: 'Browser acceptance fixture.',
      full_description: 'Browser acceptance fixture project.',
      intro_title: project.title,
      categories: project.categories,
      status: 'published',
      sort_order: project.sortOrder,
      remaining_units: project.remainingUnits,
      cover_url: '/img/figma_hero.png',
      translations: { el: { title: project.greekTitle } },
    }), '[]']);
  }
}

async function assertSeedOracle(database) {
  const result = await database.query('select slug, status, categories, remaining_units from miracon.projects order by sort_order');
  assert.deepEqual(result.rows, [
    { slug: 'browser-coastal-golden', status: 'published', categories: ['coastal', 'golden-visa'], remaining_units: null },
    { slug: 'browser-city', status: 'published', categories: ['city'], remaining_units: 0 },
    { slug: 'browser-city-seven', status: 'published', categories: ['city'], remaining_units: 7 },
  ]);
}

async function transitionFixtureToDraft(database, slug) {
  await database.query("update miracon.projects set status = 'draft' where slug = $1", [slug]);
  const result = await database.query('select slug, status from miracon.projects where slug = $1', [slug]);
  assert.deepEqual(result.rows, [{ slug, status: 'draft' }]);
}

async function assertCompleteArtifacts(artifacts) {
  if (!artifacts) return;
  assert.equal(artifacts.cases.length, casePlan.length);
  await Promise.all(artifacts.cases.flatMap((entry) => [
    access(join(artifacts.directory, entry.screenshot)),
    access(join(artifacts.directory, entry.assertionFile)),
  ]));
}

async function finalizeRun({ artifacts, externalRequests, succeeded, cleanup }) {
  let cleanupError;
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
  }
  try {
    await writeRunManifest(artifacts, cleanupError === undefined && succeeded, externalRequests);
  } catch (manifestError) {
    if (cleanupError) throw new AggregateError([cleanupError, manifestError], 'Fixture cleanup and manifest publication failed');
    throw manifestError;
  }
  if (cleanupError) throw cleanupError;
}

async function closeFixture({ context, previewContext, browser, server, database, mediaRoot }) {
  try {
    await context?.close();
  } finally {
    try {
      await previewContext?.close();
    } finally {
      try {
        await browser?.close();
      } finally {
        try {
          await stopStandalone(server);
        } finally {
          try {
            await database?.end();
          } finally {
            if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
          }
        }
      }
    }
  }
}

async function writeRunManifest(artifacts, complete, externalRequests) {
  if (!artifacts) return;
  const manifest = {
    schemaVersion: artifactSchemaVersion,
    runId: artifacts.runId,
    runToken: artifacts.runToken,
    pid: artifacts.pid,
    artifactDir: artifacts.directory,
    startedAt: artifacts.startedAt,
    completedAt: new Date().toISOString(),
    complete,
    routes,
    viewports,
    cases: artifacts.cases,
    externalRequests,
  };
  assertManifestSchema(manifest, artifacts);
  await writeFile(join(artifacts.directory, 'run-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function assertManifestSchema(manifest, artifacts) {
  assert.deepEqual(Object.keys(manifest).sort(), [
    'artifactDir', 'cases', 'complete', 'completedAt', 'externalRequests', 'pid', 'routes', 'runId', 'runToken', 'schemaVersion', 'startedAt', 'viewports',
  ]);
  assert.equal(manifest.schemaVersion, artifactSchemaVersion);
  assert.equal(manifest.runId, artifacts.runId);
  assert.equal(manifest.runToken, artifacts.runToken);
  assert.equal(manifest.pid, process.pid);
  assert.equal(manifest.artifactDir, artifacts.directory);
  assert.equal(Number.isInteger(manifest.pid) && manifest.pid > 0, true);
  assert.equal(Array.isArray(manifest.externalRequests), true);
}

function assertAssertionSchema(assertion, artifacts, route, viewport, caseId) {
  assert.deepEqual(Object.keys(assertion).sort(), [
    'caseId', 'consoleErrors', 'elements', 'externalRequests', 'fonts', 'header', 'hero', 'locale', 'mobileNavigation', 'overlaps', 'pageErrors', 'path', 'routeKey', 'runId', 'runToken', 'schemaVersion', 'viewport', 'windowInnerWidth',
  ]);
  assert.equal(assertion.schemaVersion, artifactSchemaVersion);
  assert.equal(assertion.runId, artifacts.runId);
  assert.equal(assertion.runToken, artifacts.runToken);
  assert.equal(assertion.caseId, caseId);
  assert.equal(assertion.routeKey, route.key);
  assert.equal(assertion.path, route.path);
  assert.deepEqual(assertion.viewport, viewport);
  assert.equal(assertion.windowInnerWidth, viewport.width);
  assert.equal(Array.isArray(assertion.overlaps), true);
  assert.equal(Array.isArray(assertion.externalRequests), true);
  assert.deepEqual(Object.keys(assertion.header.focus).sort(), [
    'candidates', 'hiddenControls', 'tabCount', 'traversed', 'visibleControls',
  ]);
  assert.equal(assertion.header.focus.tabCount, assertion.header.focus.candidates.length);
  assert.deepEqual(assertion.header.focus.traversed, assertion.header.focus.candidates);
}

async function requireBuiltStandaloneEntry() {
  try {
    await access(standaloneEntry);
  } catch {
    throw new Error('Built standalone entry dist/server/entry.mjs is missing. Run npm run build before npm run browser:test:db.');
  }
}

async function freeLoopbackPort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function startStandalone({ baseUrl, databaseUrl, mediaRoot, port }) {
  const child = spawn(process.execPath, ['app.js'], {
    cwd: projectRoot,
    env: { ...process.env, HOST: '::', PORT: String(port), DATABASE_URL: databaseUrl, MEDIA_ROOT: mediaRoot, PUBLIC_SITE_URL: baseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { child.output = `${child.output}${chunk}`.slice(-8_000); });
  return child;
}

async function waitForHealth(baseUrl, server) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode) throw new Error(`Standalone server exited before readiness:\n${server.output}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) return;
    } catch (error) {
      if (!(error instanceof TypeError || error.name === 'TimeoutError')) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Standalone server did not become healthy within 90 seconds:\n${server.output}`);
}

async function stopStandalone(server) {
  if (!server || server.exitCode !== null || server.signalCode) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL');
    await once(server, 'exit');
  }
}
