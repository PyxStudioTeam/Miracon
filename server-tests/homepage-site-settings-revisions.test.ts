import { describe, expect, it } from 'vitest';
import { buildHomepageHeroRevisionTransport } from '../src/lib/server/homepage-revision-adapter';

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
