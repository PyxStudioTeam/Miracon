import { describe, expect, it } from 'vitest';
import { canonicalSiteSettingsRowSchema, type CanonicalProjectRow, type CanonicalProjectImageRow, type ProjectSnapshot } from '../lib/server/revision-contracts';
import { diffProposal, isStaleProposal } from './proposal-diff';

const project: CanonicalProjectRow = {
  id: 'p', slug: 'p', title: 'Before', address: 'Address', card_address: '', price: '',
  short_description: 'Old', full_description: '', intro_title: '', categories: [], status: 'draft', sort_order: 0,
  cover_url: '/media/cover.jpg', cover_focal_x: 50, cover_focal_y: 50, image_variants: {}, hero_type: 'image', hero_variant: 'standard',
  hero_sound_enabled: false, hero_idle_ui: false, hero_url: '/media/hero.jpg', hero_mobile_url: null, hero_poster_url: null, hero_videos: [],
  walkthrough_video_enabled: false, walkthrough_video_title: '', walkthrough_video_desktop_url: '', walkthrough_video_mobile_url: null,
  walkthrough_video_poster_url: null, walkthrough_videos: [], virtual_tour_url: '', hero_focal_x: 50, hero_focal_y: 50,
  intro_image_url: '', brochure_url: null, map_query: '', map_url: '', characteristics: [], benefits: [], floor_plan_groups: [], nearby_places: [],
  translations: {}, seo_title: '', seo_description: '', published_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', remaining_units: 0,
};
const image = (id: string, role: 'card' | 'gallery', sort_order: number, url = `/media/${id}.jpg`): CanonicalProjectImageRow => ({
  id, project_id: 'p', role, sort_order, url, alt: '', storage_path: null, width: null, height: null, focal_x: 50, focal_y: 50,
  created_at: '2026-01-01T00:00:00Z',
});
const snapshot = (row: CanonicalProjectRow | null = project, images: CanonicalProjectImageRow[] = []): ProjectSnapshot => ({
  aggregateType: 'project', aggregateId: 'p', deleted: !row, project: row, images,
});

describe('proposal comparison against current HEAD', () => {
  it('distinguishes changed and cleared text, translation, false/zero and editor collections without technical metadata', () => {
    const current = snapshot({ ...project, hero_sound_enabled: true, remaining_units: 4,
      translations: { el: { title: 'Πριν' } }, characteristics: [{ id: 'bed', label: 'Bedrooms', value: '2' }],
    });
    const next = snapshot({ ...project, title: 'After', short_description: '', hero_sound_enabled: false, remaining_units: 0,
      updated_at: '2027-01-01T00:00:00Z', translations: { el: { title: 'Μετά' } },
      characteristics: [{ id: 'bed', label: 'Bedrooms', value: '3' }],
    });
    const diff = diffProposal(current, next);
    expect(diff.fields).toEqual(expect.arrayContaining([
      { label: 'project / title', before: 'Before', after: 'After' },
      { label: 'project / short description', before: 'Old', after: '' },
      { label: 'project / hero sound enabled', before: true, after: false },
      { label: 'project / remaining units', before: 4, after: 0 },
      { label: 'project / translations / el / title', before: 'Πριν', after: 'Μετά' },
      { label: 'project / characteristics / bed / value', before: '2', after: '3' },
    ]));
    expect(diff.fields.some((entry) => entry.label.includes('updated at'))).toBe(false);
  });

  it('distinguishes creation, deletion, and absent HEAD without inventing a baseline', () => {
    expect(diffProposal(null, snapshot()).state).toBe('no-head');
    expect(diffProposal(snapshot(null), snapshot()).state).toBe('added');
    const removed = diffProposal(snapshot(), snapshot(null));
    expect(removed.state).toBe('deleted');
    expect(removed.fields).toContainEqual({ label: 'project / title', before: 'Before', after: undefined });
  });

  it('matches photo identity for both roles and shows replacement, movement, removal and additions', () => {
    const before = snapshot(project, [image('card', 'card', 0), image('moved', 'gallery', 0), image('removed', 'gallery', 1)]);
    const after = snapshot({ ...project, cover_url: '/media/new-cover.jpg', hero_url: '/media/new-hero.jpg',
      floor_plan_groups: [{ id: 'group', plans: [{ id: 'plan', imageUrl: '/media/plan.jpg' }] }],
    }, [image('card', 'card', 0, '/media/replacement.jpg'), image('moved', 'gallery', 2), image('added', 'gallery', 1)]);
    const diff = diffProposal(before, after);
    expect(diff.images).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'card / card', kind: 'replaced', beforeUrl: '/media/card.jpg', afterUrl: '/media/replacement.jpg' }),
      expect.objectContaining({ label: 'gallery / moved', kind: 'moved' }),
      expect.objectContaining({ label: 'gallery / removed', kind: 'removed' }),
      expect.objectContaining({ label: 'gallery / added', kind: 'added' }),
      expect.objectContaining({ label: 'project / cover url', kind: 'replaced' }),
      expect.objectContaining({ label: 'project / hero image', kind: 'replaced' }),
      expect.objectContaining({ label: 'project / floor plan groups / group / plans / plan / image Url', kind: 'added' }),
    ]));
    expect(diff.fields).toEqual(expect.arrayContaining([
      { label: 'photos / removed / url', before: '/media/removed.jpg', after: undefined },
      { label: 'photos / added / role', before: undefined, after: 'gallery' },
      { label: 'photos / moved / sort order', before: 0, after: 2 },
    ]));
  });

  it('compares homepage videos and site settings including localized copy and legal settings', () => {
    const first = { id: 'video', title: 'Before', project_id: null, desktop_url: '/media/a.mp4', desktop_storage_path: null,
      mobile_url: null, mobile_storage_path: null, sort_order: 0, is_active: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
    const hero = diffProposal({ aggregateType: 'homepage_hero', aggregateId: 'singleton', videos: [first] },
      { aggregateType: 'homepage_hero', aggregateId: 'singleton', videos: [{ ...first, title: 'After', is_active: true }] });
    expect(hero.fields).toContainEqual({ label: 'hero videos / video / is active', before: false, after: true });
    const base = { id: 1 as const, footer_terms_visible: true, footer_terms_pdf_url: '/old.pdf', footer_privacy_visible: false,
      footer_privacy_pdf_url: '', footer_cookie_visible: false, footer_cookie_pdf_url: '', home_copy: { el: { heading: 'Πριν' } },
      updated_at: '2026-01-01T00:00:00Z' };
    const settings = diffProposal({ aggregateType: 'site_settings', aggregateId: 'singleton', settings: canonicalSiteSettingsRowSchema.parse(base) },
      { aggregateType: 'site_settings', aggregateId: 'singleton', settings: canonicalSiteSettingsRowSchema.parse({ ...base, footer_terms_visible: false, footer_terms_pdf_url: '', home_copy: { el: { heading: 'Μετά' } } }) });
    expect(settings.fields).toEqual(expect.arrayContaining([
      { label: 'site settings / footer terms visible', before: true, after: false },
      { label: 'site settings / footer terms pdf url', before: '/old.pdf', after: '' },
      { label: 'site settings / home copy / el / heading', before: 'Πριν', after: 'Μετά' },
    ]));
  });

  it('flags stale HEAD even when values in the snapshots are identical', () => {
    expect(diffProposal(snapshot(), snapshot()).fields).toHaveLength(0);
    expect(isStaleProposal({ expectedRevisionId: 'old', currentHeadRevisionId: 'new' })).toBe(true);
    expect(isStaleProposal({ expectedRevisionId: null, currentHeadRevisionId: null })).toBe(false);
  });
});
