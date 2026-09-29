import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';

const siteScript = await readFile(new URL('../public/site.js', import.meta.url), 'utf8');
const validChallenge = (token, expiresAt = Date.now() + 60_000) => ({
  challenge: token.repeat(43),
  expiresAt: new Date(expiresAt).toISOString(),
});
const accepted = { status: 201, body: { id: '11111111-1111-4111-8111-111111111111' } };
const fixtures = [
  {
    locale: 'en', path: '/golden-visa',
    missing: 'Please enter your name, phone number and email address',
    phone: 'Please enter a valid phone number',
    email: 'Please enter a valid email address',
    success: 'Thank you. Your request has been sent',
    rateLimited: 'Too many requests. Please try again later',
    duplicate: 'We have already received this request',
  },
  {
    locale: 'el', path: '/el/golden-visa',
    missing: 'Συμπληρώστε το όνομά σας, το τηλέφωνο και το email σας',
    phone: 'Συμπληρώστε έναν έγκυρο αριθμό τηλεφώνου',
    email: 'Συμπληρώστε μια έγκυρη διεύθυνση email',
    success: 'Ευχαριστούμε. Το αίτημά σας στάλθηκε',
    rateLimited: 'Έχετε στείλει πάρα πολλά αιτήματα. Δοκιμάστε ξανά αργότερα',
    duplicate: 'Έχουμε ήδη λάβει αυτό το αίτημα',
  },
];

for (const fixture of fixtures) {
  test(`${fixture.locale}: checking consent on a filled form permits immediate success`, async () => {
    await withContactPage({
      fixture,
      challenges: [{ status: 200, body: validChallenge('A') }],
      contacts: [accepted],
    }, async ({ form, challengeRequests, submissions }) => {
      const submit = form.locator('.btn-submit');
      assert.equal(await submit.isDisabled(), true);
      await form.locator('[name="message"]').fill('Browser client contract message');
      await fillValidContact(form);
      await form.locator('[name="consent"]').check();
      assert.equal(await submit.isEnabled(), true);
      assert.equal(challengeRequests.length, 0);
      await submit.click();
      await form.locator('.form-status').filter({ hasText: fixture.success }).waitFor({ timeout: 2_500 });
      assert.equal(challengeRequests.length, 1);
      assert.equal(submissions.length, 1);
      assert.equal(await form.locator('[name="name"]').inputValue(), '');
      assert.equal(await submit.isDisabled(), true);
    });
  });

  test(`${fixture.locale}: invalid contact details and honeypot never start a submission`, async () => {
    await withContactPage({ fixture, challenges: [], contacts: [] }, async ({ form, challengeRequests, submissions }) => {
      const submit = form.locator('.btn-submit');
      await form.locator('[name="consent"]').check();
      await form.locator('[name="message"]').fill('Browser client contract message');
      await submit.click();
      await expectStatus(form, fixture.missing);
      await form.locator('[name="name"]').fill('Browser Client Contact');
      await form.locator('[name="email"]').fill('browser@example.test');
      await submit.click();
      await expectStatus(form, fixture.missing);
      await form.locator('[name="email"]').fill('');
      await form.locator('[name="phone"]').fill('+30 210 000 0000');
      await submit.click();
      await expectStatus(form, fixture.missing);
      await form.locator('[name="phone"]').fill('invalid');
      await form.locator('[name="email"]').fill('browser@example.test');
      await submit.click();
      await expectStatus(form, fixture.phone);
      await form.locator('[name="phone"]').fill('+30 210 000 0000');
      await form.locator('[name="email"]').fill('invalid');
      await submit.click();
      await expectStatus(form, fixture.email);
      await form.locator('[name="email"]').fill('browser@example.test');
      await form.locator('[name="website"]').fill('https://spam.example');
      await submit.click();
      await expectStatus(form, fixture.locale === 'el' ? 'Δεν ήταν δυνατή η αποστολή' : 'Unable to send');
      assert.equal(challengeRequests.length, 0);
      assert.equal(submissions.length, 0);
    });
  });

  for (const scenario of [
    { name: 'rate-limited', reply: { status: 429, body: { error: { code: 'rate_limited' } } }, status: fixture.rateLimited },
    { name: 'duplicate', reply: { status: 409, body: { error: { code: 'duplicate' } } }, status: fixture.duplicate },
  ]) {
    test(`${fixture.locale}: ${scenario.name} contact response is not success or automatically retried`, async () => {
      await withContactPage({
        fixture,
        challenges: [{ status: 200, body: validChallenge('B') }, { status: 200, body: validChallenge('C') }],
        contacts: [scenario.reply, accepted],
      }, async ({ form, challengeRequests, submissions }) => {
        await prepareValidForm(form);
        await form.locator('.btn-submit').click();
        await expectStatus(form, scenario.status);
        assert.equal(await form.locator('.form-status').getAttribute('data-status'), 'error');
        assert.equal(challengeRequests.length, 1);
        assert.equal(submissions.length, 1);
        assert.equal(await form.locator('.btn-submit').isEnabled(), true);
        await form.locator('.btn-submit').click();
        await expectStatus(form, fixture.success);
        assert.equal(challengeRequests.length, 2);
        assert.deepEqual(submissions.map(({ challenge }) => challenge), ['B'.repeat(43), 'C'.repeat(43)]);
      });
    });
  }
}

for (const scenario of [
  { name: 'challenge outage', reply: { status: 500, body: { error: { code: 'unavailable' } } } },
  { name: 'challenge rate limit', reply: { status: 429, body: { error: { code: 'rate_limited' } } }, status: 'Too many requests' },
  { name: 'malformed challenge JSON', reply: { status: 200, rawBody: '{not-json' } },
  { name: 'malformed challenge payload', reply: { status: 200, body: { challenge: 'invalid' } } },
  { name: 'expired challenge', reply: { status: 200, body: validChallenge('D', Date.now() - 1_000) } },
  { name: 'challenge network failure', reply: { abort: true } },
]) {
  test(`${scenario.name} requires another explicit submit before POST`, async () => {
    await withContactPage({
      challenges: [scenario.reply, { status: 200, body: validChallenge('E') }],
      contacts: [accepted],
    }, async ({ form, challengeRequests, submissions }) => {
      await prepareValidForm(form);
      await form.locator('.btn-submit').click();
      await expectStatus(form, scenario.status ?? (scenario.reply.abort || scenario.reply.rawBody
        ? 'Please try again later' : 'temporarily unavailable'));
      assert.equal(challengeRequests.length, 1);
      assert.equal(submissions.length, 0);
      await form.locator('.btn-submit').click();
      await expectStatus(form, 'Thank you');
      assert.equal(challengeRequests.length, 2);
      assert.deepEqual(submissions.map(({ challenge }) => challenge), ['E'.repeat(43)]);
    });
  });
}

for (const scenario of [
  { name: 'invalid or expired challenge', reply: { status: 400, body: { error: { code: 'invalid_challenge' } } }, status: 'Unable to send your request' },
  { name: 'ambiguous network failure', reply: { abort: true }, status: 'Please try again later' },
  { name: 'malformed contact response', reply: { status: 200, rawBody: '{not-json' }, status: 'Please try again later' },
]) {
  test(`${scenario.name} never replays a POST without explicit submission`, async () => {
    await withContactPage({
      challenges: [{ status: 200, body: validChallenge('F') }, { status: 200, body: validChallenge('G') }],
      contacts: [scenario.reply, accepted],
    }, async ({ form, challengeRequests, submissions }) => {
      await prepareValidForm(form);
      await form.locator('.btn-submit').click();
      await expectStatus(form, scenario.status);
      assert.equal(challengeRequests.length, 1);
      assert.equal(submissions.length, 1);
      assert.equal(await form.locator('.form-status').getAttribute('data-status'), 'error');
      await form.locator('.btn-submit').click();
      await expectStatus(form, 'Thank you');
      assert.equal(challengeRequests.length, 2);
      assert.deepEqual(submissions.map(({ challenge }) => challenge), ['F'.repeat(43), 'G'.repeat(43)]);
    });
  });
}

test('overlapping submit events while a contact POST is pending only send once', async () => {
  let releasePost;
  const pendingPost = new Promise(resolve => { releasePost = resolve; });
  let markPostStarted;
  const postStarted = new Promise(resolve => { markPostStarted = resolve; });
  await withContactPage({
    challenges: [{ status: 200, body: validChallenge('H') }],
    contacts: [accepted],
    beforeContact: () => {
      markPostStarted();
      return pendingPost;
    },
  }, async ({ page, form, challengeRequests, submissions }) => {
    await prepareValidForm(form);
    await form.locator('.btn-submit').click();
    await expectStatus(form, 'Sending your request');
    assert.equal(await form.locator('.btn-submit').isDisabled(), true);
    await postStarted;
    await page.locator('form').evaluate(element => element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(challengeRequests.length, 1);
    assert.equal(submissions.length, 1);
    releasePost();
    await expectStatus(form, 'Thank you');
    assert.equal(submissions.length, 1);
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
        if (options.beforeContact) await options.beforeContact();
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
  await form.locator('[name="phone"]').fill('+30 210 000 0000');
  await form.locator('[name="email"]').fill('browser@example.test');
}

async function expectStatus(form, text) {
  await form.locator('.form-status').filter({ hasText: text }).waitFor({ timeout: 10_000 });
}

function formDocument(fixture) {
  return `<!doctype html><html lang="${fixture.locale}"><head><meta charset="utf-8"></head><body>
    <form data-consultation-form novalidate>
      <input name="name"><input name="phone"><input name="email" type="email">
      <textarea name="message"></textarea><input name="consent" type="checkbox">
      <input name="website" type="text"><button class="btn-submit" type="submit" disabled>Submit</button>
      <p class="form-status" hidden></p>
    </form><script src="/site.js"></script></body></html>`;
}
