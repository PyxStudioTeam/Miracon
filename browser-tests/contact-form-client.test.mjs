import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';

const siteScript = await readFile(new URL('../public/site.js', import.meta.url), 'utf8');
const validChallenge = (token, expiresAt = Date.now() + 60_000) => ({
  challenge: token.repeat(43),
  notBefore: new Date(Date.now() - 1_000).toISOString(),
  expiresAt: new Date(expiresAt).toISOString(),
});
const accepted = { status: 201, body: { id: '11111111-1111-4111-8111-111111111111' } };

for (const fixture of [
  { locale: 'en', path: '/golden-visa', missingText: 'Please enter your name and at least one contact detail', successText: 'Thank you. Your request has been sent' },
  { locale: 'el', path: '/el/golden-visa', missingText: 'Συμπληρώστε το όνομά σας και τουλάχιστον ένα στοιχείο επικοινωνίας', successText: 'Ευχαριστούμε. Το αίτημά σας στάλθηκε' },
]) {
  test(`submits the ${fixture.locale} contact form through same-origin JSON`, async () => {
    await withContactPage({
      fixture,
      challenges: [{ status: 200, body: validChallenge('A') }],
      contacts: [accepted],
    }, async ({ form, submissions }) => {
      await form.locator('[name="consent"]').check();
      await form.locator('[name="message"]').fill('Browser client contract message');
      await form.locator('.btn-submit').click();
      await expectStatus(form, fixture.missingText);
      assert.equal(submissions.length, 0);

      await fillValidContact(form);
      await form.locator('.btn-submit').click();
      await expectStatus(form, fixture.successText);
      assert.deepEqual(submissions, [{
        name: 'Browser Client Contact',
        email: 'browser@example.test',
        message: 'Browser client contract message',
        consent: true,
        locale: fixture.locale,
        sourcePath: fixture.path,
        website: '',
        challenge: 'A'.repeat(43),
      }]);
    });
  });
}

test('retries challenge acquisition after an initial failure without toggling consent', async () => {
  await withContactPage({
    fixture: { locale: 'en', path: '/golden-visa', initialConsent: true },
    challenges: [
      { status: 500, body: { error: { code: 'unavailable' } } },
      { status: 200, body: validChallenge('B') },
    ],
    contacts: [accepted],
  }, async ({ form, challengeRequests, submissions }) => {
    await fillValidContact(form);
    await form.locator('[name="message"]').fill('Browser client contract message');
    await form.locator('.btn-submit').click();
    await expectStatus(form, 'temporarily unavailable');
    await form.locator('.btn-submit').click();
    await expectStatus(form, 'Thank you');
    assert.equal(challengeRequests.length, 2);
    assert.equal(submissions.length, 1);
  });
});

test('replaces an expired challenge before the contact POST', async () => {
  await withContactPage({
    challenges: [
      { status: 200, body: validChallenge('C', Date.now() - 1_000) },
      { status: 200, body: validChallenge('D') },
    ],
    contacts: [accepted],
  }, async ({ form, challengeRequests, submissions }) => {
    await prepareValidForm(form);
    await form.locator('.btn-submit').click();
    await expectStatus(form, 'Thank you');
    assert.equal(challengeRequests.length, 2);
    assert.equal(submissions[0].challenge, 'D'.repeat(43));
  });
});

test('refreshes once and safely retries once after invalid_challenge', async () => {
  await withContactPage({
    challenges: [
      { status: 200, body: validChallenge('E') },
      { status: 200, body: validChallenge('F') },
    ],
    contacts: [
      { status: 400, body: { error: { code: 'invalid_challenge' } } },
      accepted,
    ],
  }, async ({ form, challengeRequests, submissions }) => {
    await prepareValidForm(form);
    await form.locator('.btn-submit').click();
    await expectStatus(form, 'Thank you');
    assert.equal(challengeRequests.length, 2);
    assert.deepEqual(submissions.map(({ challenge }) => challenge), ['E'.repeat(43), 'F'.repeat(43)]);
  });
});

for (const scenario of [
  {
    name: '429 response',
    firstContact: { status: 429, body: { error: { code: 'rate_limited' } } },
    firstStatus: 'Please wait before sending another request',
  },
  {
    name: 'malformed contact response',
    firstContact: { status: 200, rawBody: '{not-json' },
    firstStatus: 'Unable to send your request',
  },
]) {
  test(`requires an explicit retry after a ${scenario.name}`, async () => {
    await withContactPage({
      challenges: [
        { status: 200, body: validChallenge('G') },
        { status: 200, body: validChallenge('H') },
      ],
      contacts: [scenario.firstContact, accepted],
    }, async ({ form, submissions }) => {
      await prepareValidForm(form);
      await form.locator('.btn-submit').click();
      await expectStatus(form, scenario.firstStatus);
      assert.equal(submissions.length, 1);
      await form.locator('.btn-submit').click();
      await expectStatus(form, 'Thank you');
      assert.equal(submissions.length, 2);
    });
  });
}

test('recovers from a malformed challenge response on the next explicit submit', async () => {
  await withContactPage({
    fixture: { locale: 'en', path: '/golden-visa', initialConsent: true },
    challenges: [
      { status: 200, body: { challenge: 'invalid' } },
      { status: 200, body: validChallenge('I') },
    ],
    contacts: [accepted],
  }, async ({ form, challengeRequests }) => {
    await fillValidContact(form);
    await form.locator('[name="message"]').fill('Browser client contract message');
    await form.locator('.btn-submit').click();
    await expectStatus(form, 'temporarily unavailable');
    await form.locator('.btn-submit').click();
    await expectStatus(form, 'Thank you');
    assert.equal(challengeRequests.length, 2);
  });
});

test('does not replay an ambiguous POST until the user submits again', async () => {
  await withContactPage({
    challenges: [
      { status: 200, body: validChallenge('J') },
      { status: 200, body: validChallenge('K') },
    ],
    contacts: [{ abort: true }, accepted],
  }, async ({ form, page, challengeRequests, submissions }) => {
    await prepareValidForm(form);
    await form.locator('.btn-submit').click();
    await expectStatus(form, 'Please try again later');
    await page.waitForFunction(() => performance.getEntriesByType('resource')
      .filter((entry) => new URL(entry.name).pathname === '/api/contact/challenge').length >= 2);
    assert.equal(challengeRequests.length, 2);
    assert.equal(submissions.length, 1);

    await form.locator('.btn-submit').click();
    await expectStatus(form, 'Thank you');
    assert.equal(submissions.length, 2);
  });
});

async function withContactPage(options, run) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const fixture = options.fixture ?? { locale: 'en', path: '/golden-visa' };
  const challengeRequests = [];
  const submissions = [];
  try {
    await page.route('https://miracon.test/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/site.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: siteScript });
      if (pathname === '/api/contact/challenge') {
        challengeRequests.push(request);
        return respond(route, options.challenges.shift());
      }
      if (pathname === '/api/contact') {
        submissions.push(request.postDataJSON());
        return respond(route, options.contacts.shift());
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: formDocument(fixture) });
    });
    await page.goto(`https://miracon.test${fixture.path}`);
    await run({ page, form: page.locator('[data-consultation-form]'), challengeRequests, submissions });
  } finally {
    await page.close();
    await browser.close();
  }
}

async function respond(route, reply) {
  assert.ok(reply, 'Unexpected request');
  if (reply.abort) return route.abort('connectionreset');
  return route.fulfill({
    status: reply.status,
    contentType: 'application/json',
    body: reply.rawBody ?? JSON.stringify(reply.body),
  });
}

async function prepareValidForm(form) {
  await form.locator('[name="consent"]').check();
  await form.locator('[name="message"]').fill('Browser client contract message');
  await fillValidContact(form);
}

async function fillValidContact(form) {
  await form.locator('[name="name"]').fill('Browser Client Contact');
  await form.locator('[name="email"]').fill('browser@example.test');
}

async function expectStatus(form, text) {
  await form.locator('.form-status').filter({ hasText: text }).waitFor({ timeout: 10_000 });
}

function formDocument(fixture) {
  return `<!doctype html><html lang="${fixture.locale}"><head><meta charset="utf-8"></head><body>
    <form data-consultation-form novalidate>
      <input name="name"><input name="phone"><input name="email" type="email">
      <textarea name="message"></textarea><input name="consent" type="checkbox"${fixture.initialConsent ? ' checked' : ''}>
      <input name="website" type="text"><button class="btn-submit" type="submit" disabled>Submit</button>
      <p class="form-status" hidden></p>
    </form><script src="/site.js"></script></body></html>`;
}
