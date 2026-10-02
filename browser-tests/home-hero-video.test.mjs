import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';

const siteScript = await readFile(new URL('../public/site.js', import.meta.url), 'utf8');
const playlist = JSON.stringify([
  { id: 'first', mobileUrl: '/mobile.mp4', desktopUrl: '/desktop.mp4' },
  { id: 'second', mobileUrl: null, desktopUrl: '/second.mp4' },
]);

async function withHeroPage(playImpl, run) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.addInitScript(playImpl);
    await page.route('https://miracon.test/**', (route) => {
      if (new URL(route.request().url()).pathname === '/site.js') {
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: siteScript });
      }
      if (route.request().resourceType() === 'media') return route.abort();
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="en"><body>
        <div data-home-hero-playlist='${playlist}'>
          <video class="hero-video is-active" muted playsinline preload="none">
            <source media="(max-width: 600px), (pointer: coarse)" src="/mobile.mp4" type="video/mp4">
            <source src="/desktop.mp4" type="video/mp4">
          </video>
          <video class="hero-video" muted playsinline preload="none"></video>
        </div><script src="/site.js"></script></body></html>` });
    });
    await page.goto('https://miracon.test/', { waitUntil: 'domcontentloaded' });
    await run(page);
  } finally {
    await page.close();
    await browser.close();
  }
}

test('initial navigation preserves the browser-selected video source and does not preload the next clip', async () => {
  await withHeroPage(() => {
    HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    HTMLMediaElement.prototype.load = function () {};
  }, async (page) => {
    const state = await page.locator('.hero-video').first().evaluate((video) => ({
      src: video.getAttribute('src'),
      selected: video.dataset.playlistSrc,
      standbyPreload: document.querySelectorAll('.hero-video')[1].preload,
    }));
    assert.equal(state.src, null);
    assert.equal(state.selected, '/mobile.mp4');
    assert.equal(state.standbyPreload, 'none');
  });
});

test('mobile decode rejection switches to the existing desktop source without a language change or click', async () => {
  await withHeroPage(() => {
    HTMLMediaElement.prototype.play = function () {
      return this.dataset.playlistSrc === '/mobile.mp4'
        ? Promise.reject(new DOMException('Unsupported mobile video', 'NotSupportedError'))
        : Promise.resolve();
    };
    HTMLMediaElement.prototype.load = function () {};
  }, async (page) => {
    await page.locator('.hero-video.is-active[src="/desktop.mp4"]').waitFor();
    assert.equal(await page.locator('.hero-video.is-active').getAttribute('data-playlist-src'), '/desktop.mp4');
  });
});

test('an autoplay policy denial keeps the selected source instead of treating it as a decode failure', async () => {
  await withHeroPage(() => {
    HTMLMediaElement.prototype.play = function () {
      return Promise.reject(new DOMException('Autoplay denied', 'NotAllowedError'));
    };
    HTMLMediaElement.prototype.load = function () {};
  }, async (page) => {
    const video = page.locator('.hero-video.is-active');
    assert.equal(await video.getAttribute('src'), null);
    assert.equal(await video.getAttribute('data-playlist-src'), '/mobile.mp4');
    assert.equal(await video.getAttribute('class'), 'hero-video is-active');
  });
});
