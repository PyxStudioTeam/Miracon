import { z } from 'zod';
import type { SiteSettings } from '../site-settings-shared';
import {
  siteSettingsSnapshotSchema,
  SINGLETON_AGGREGATE_ID,
  type SiteSettingsSnapshot,
} from './revision-contracts';

export type SiteSettingsRevisionTransportInput = {
  readonly settings: SiteSettings;
  readonly expectedRevisionId: string | null;
  readonly mediaFileIds: readonly string[];
  readonly mutationTime: string;
};

export type SiteSettingsRevisionTransport = {
  readonly aggregateType: 'site_settings';
  readonly aggregateId: typeof SINGLETON_AGGREGATE_ID;
  readonly snapshot: SiteSettingsSnapshot;
  readonly expectedRevisionId: string | null;
  readonly mediaFileIds: string[];
};

const canonicalTimestampSchema = z.iso.datetime().transform((value) => new Date(value).toISOString());

export function buildSiteSettingsRevisionTransport(
  input: SiteSettingsRevisionTransportInput,
): SiteSettingsRevisionTransport {
  const mutationTime = canonicalTimestampSchema.parse(input.mutationTime);

  const snapshot = siteSettingsSnapshotSchema.parse({
    aggregateType: 'site_settings',
    aggregateId: SINGLETON_AGGREGATE_ID,
    settings: {
      id: 1,
      footer_terms_visible: input.settings.footerTermsVisible,
      footer_terms_pdf_url: input.settings.footerTermsPdfUrl,
      footer_privacy_visible: input.settings.footerPrivacyVisible,
      footer_privacy_pdf_url: input.settings.footerPrivacyPdfUrl,
      footer_cookie_visible: input.settings.footerCookieVisible,
      footer_cookie_pdf_url: input.settings.footerCookiePdfUrl,
      updated_at: mutationTime,
    },
  });

  return {
    aggregateType: 'site_settings',
    aggregateId: SINGLETON_AGGREGATE_ID,
    snapshot,
    expectedRevisionId: input.expectedRevisionId,
    mediaFileIds: [...new Set(input.mediaFileIds)].sort(),
  };
}
