import { describe, expect, it } from 'vitest';
import { buildHomepageHeroRevisionTransport } from '../src/lib/server/homepage-revision-adapter';
import { defaultSiteSettings } from '../src/lib/site-settings-shared';
import { mapSiteSettings } from '../src/lib/site-settings';
import { siteSettingsSchema } from '../src/lib/server/api-schemas';
import { buildSiteSettingsRevisionTransport } from '../src/lib/server/site-settings-revision-adapter';

describe('homepage hero revision adapter', () => {
  it('builds canonical HomepageHeroSnapshot and sorts videos deterministically', () => {
    const transport = buildHomepageHeroRevisionTransport({
      videos: [
        {
          id: 'video-2',
          title: 'Second Video',
          projectId: 'p2',
          desktopUrl: '/media/vid2.mp4',
          desktopStoragePath: null,
          mobileUrl: null,
          mobileStoragePath: null,
          sortOrder: 1,
          isActive: true,
        },
        {
          id: 'video-1',
          title: 'First Video',
          projectId: 'p1',
          desktopUrl: '/media/vid1.mp4',
          desktopStoragePath: null,
          mobileUrl: null,
          mobileStoragePath: null,
          sortOrder: 0,
          isActive: true,
        },
      ],
      previousSnapshot: null,
      expectedRevisionId: null,
      mediaFileIds: ['media-1', 'media-2'],
      mutationTime: '2026-08-30T10:00:00.000Z',
    });

    expect(transport.aggregateType).toBe('homepage_hero');
    expect(transport.aggregateId).toBe('singleton');
    expect(transport.snapshot.videos).toHaveLength(2);
    expect(transport.snapshot.videos[0].id).toBe('video-1');
    expect(transport.snapshot.videos[1].id).toBe('video-2');
    expect(transport.mediaFileIds).toEqual(['media-1', 'media-2']);
  });

});
describe('localized contact acknowledgement settings', () => {
  it('retains legacy contact-form copy and supplies both 24-hour defaults without changing stored rows', () => {
    const historicalCopy = {
      en: { title: 'Existing EN title', description: 'Existing EN text' },
      el: { title: 'Existing EL title', description: 'Existing EL text' },
    };
    const mapped = mapSiteSettings({ contact_copy: historicalCopy });
    expect(mapped.contactCopy.en.title).toBe('Existing EN title');
    expect(mapped.contactCopy.el.description).toBe('Existing EL text');
    expect(mapped.contactCopy.en.acknowledgement).toContain('within 24 hours');
    expect(mapped.contactCopy.el.acknowledgement).toContain('εντός 24 ωρών');
    expect(historicalCopy.en).not.toHaveProperty('acknowledgement');
    expect(siteSettingsSchema.safeParse(mapped).success).toBe(true);
  });

  it('transports approved bilingual text in the existing site-settings revision and rejects unsafe copy', () => {
    const settings = {
      ...defaultSiteSettings,
      contactCopy: {
        en: { ...defaultSiteSettings.contactCopy.en, acknowledgement: 'Receipt in English. Reply within 24 hours.' },
        el: { ...defaultSiteSettings.contactCopy.el, acknowledgement: 'Λήψη στα ελληνικά. Εντός 24 ωρών.' },
      },
    };
    expect(siteSettingsSchema.safeParse(settings).success).toBe(true);
    const transport = buildSiteSettingsRevisionTransport({
      settings, expectedRevisionId: null, mediaFileIds: [], mutationTime: '2026-10-01T10:00:00.000Z',
    });
    expect(transport.snapshot.settings.contact_copy).toEqual(settings.contactCopy);
    const published = mapSiteSettings({ contact_copy: transport.snapshot.settings.contact_copy });
    expect(published.contactCopy).toEqual(settings.contactCopy);
    for (const acknowledgement of ['', 'X'.repeat(2_001), 'Header\r\nBcc: outsider@example.org']) {
      const invalid = { ...settings, contactCopy: {
        ...settings.contactCopy, en: { ...settings.contactCopy.en, acknowledgement },
      } };
      expect(siteSettingsSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
