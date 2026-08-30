import { defaultSiteSettings, isValidTermsPdfUrl } from './site-settings-shared';
import type { SiteSettings } from './site-settings-shared';

export { defaultSiteSettings, isValidTermsPdfUrl } from './site-settings-shared';
export type { SiteSettings } from './site-settings-shared';

export function mapSiteSettings(row: Record<string, unknown> | null | undefined): SiteSettings {
  const footerTermsPdfUrl = String(row?.footer_terms_pdf_url ?? '').trim();
  const footerPrivacyPdfUrl = String(row?.footer_privacy_pdf_url ?? '').trim();
  const footerCookiePdfUrl = String(row?.footer_cookie_pdf_url ?? '').trim();
  return {
    footerTermsVisible: Boolean(row?.footer_terms_visible) && isValidTermsPdfUrl(footerTermsPdfUrl),
    footerTermsPdfUrl: isValidTermsPdfUrl(footerTermsPdfUrl) ? footerTermsPdfUrl : '',
    footerPrivacyVisible: Boolean(row?.footer_privacy_visible) && isValidTermsPdfUrl(footerPrivacyPdfUrl),
    footerPrivacyPdfUrl: isValidTermsPdfUrl(footerPrivacyPdfUrl) ? footerPrivacyPdfUrl : '',
    footerCookieVisible: Boolean(row?.footer_cookie_visible) && isValidTermsPdfUrl(footerCookiePdfUrl),
    footerCookiePdfUrl: isValidTermsPdfUrl(footerCookiePdfUrl) ? footerCookiePdfUrl : '',
  };
}

export async function getSiteSettings(): Promise<SiteSettings> {
  if (import.meta.env.DEV && !process.env.DATABASE_URL) return defaultSiteSettings;
  const { getDatabasePool } = await import('./server/database');
  const { getSiteSettings: getSettings } = await import('./server/site-settings');
  return getSettings(getDatabasePool());
}
