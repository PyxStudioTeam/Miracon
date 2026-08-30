import type { QueryResult, QueryResultRow } from 'pg';
import { mapSiteSettings } from '../site-settings';
import type { SiteSettings } from '../site-settings';

export interface SiteSettingsDatabase {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

const settingsColumns = `
  footer_terms_visible,
  footer_terms_pdf_url,
  footer_privacy_visible,
  footer_privacy_pdf_url,
  footer_cookie_visible,
  footer_cookie_pdf_url
`;

export async function getSiteSettings(database: SiteSettingsDatabase): Promise<SiteSettings> {
  const result = await database.query(`select ${settingsColumns} from miracon.site_settings where id = 1`);
  return mapSiteSettings(result.rows[0]);
}

export async function updateSiteSettings(
  database: SiteSettingsDatabase,
  settings: SiteSettings,
): Promise<SiteSettings> {
  const result = await database.query(`
    update miracon.site_settings
    set footer_terms_visible = $1,
        footer_terms_pdf_url = $2,
        footer_privacy_visible = $3,
        footer_privacy_pdf_url = $4,
        footer_cookie_visible = $5,
        footer_cookie_pdf_url = $6
    where id = 1
    returning ${settingsColumns}
  `, [
    settings.footerTermsVisible,
    settings.footerTermsPdfUrl,
    settings.footerPrivacyVisible,
    settings.footerPrivacyPdfUrl,
    settings.footerCookieVisible,
    settings.footerCookiePdfUrl,
  ]);
  return mapSiteSettings(result.rows[0]);
}
