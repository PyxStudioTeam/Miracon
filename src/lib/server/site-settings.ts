import type { QueryResult, QueryResultRow } from 'pg';
import { mapSiteSettings } from '../site-settings';
import type { SiteSettings } from '../site-settings';

export interface SiteSettingsDatabase {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export type SiteSettingsWithHead = {
  readonly settings: SiteSettings;
  readonly currentRevisionId: string | null;
};

const settingsColumns = `
  footer_terms_visible,
  footer_terms_pdf_url,
  footer_privacy_visible,
  footer_privacy_pdf_url,
  footer_cookie_visible,
  footer_cookie_pdf_url,
  site_name, company_name, logo_url, brand_color, home_copy, golden_visa_copy, contact_copy, stages_copy,
  footer_phone, footer_email, footer_address,
  facebook_visible, facebook_url, instagram_visible, instagram_url,
  linkedin_visible, linkedin_url, whatsapp_visible, whatsapp_phone, whatsapp_message
`;

export async function getSiteSettings(database: SiteSettingsDatabase): Promise<SiteSettings> {
  const result = await database.query(`select ${settingsColumns} from miracon.site_settings where id = 1`);
  return mapSiteSettings(result.rows[0]);
}

export async function getSiteSettingsWithHead(
  database: SiteSettingsDatabase,
): Promise<SiteSettingsWithHead> {
  const result = await database.query(`
    select
      settings.footer_terms_visible,
      settings.footer_terms_pdf_url,
      settings.footer_privacy_visible,
      settings.footer_privacy_pdf_url,
      settings.footer_cookie_visible,
      settings.footer_cookie_pdf_url,
      settings.site_name, settings.company_name, settings.logo_url, settings.brand_color,
      settings.home_copy, settings.golden_visa_copy, settings.contact_copy, settings.stages_copy,
      settings.footer_phone, settings.footer_email, settings.footer_address,
      settings.facebook_visible, settings.facebook_url, settings.instagram_visible, settings.instagram_url,
      settings.linkedin_visible, settings.linkedin_url,
      settings.whatsapp_visible, settings.whatsapp_phone, settings.whatsapp_message,
      head.current_revision_id
    from miracon.site_settings as settings
    left join miracon.content_revision_heads as head
      on head.aggregate_type = 'site_settings' and head.aggregate_id = 'singleton'
    where settings.id = 1
  `);
  const row = result.rows[0];
  if (!row) throw new Error('Site settings record not found');
  return {
    settings: mapSiteSettings(row),
    currentRevisionId: row['current_revision_id'] ? String(row['current_revision_id']) : null,
  };
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
        footer_cookie_pdf_url = $6,
        site_name = $7, company_name = $8, logo_url = $25, brand_color = $26,
        home_copy = $9, golden_visa_copy = $10, contact_copy = $11, stages_copy = $12,
        footer_phone = $13, footer_email = $14, footer_address = $15,
        facebook_visible = $16, facebook_url = $17, instagram_visible = $18, instagram_url = $19,
        linkedin_visible = $20, linkedin_url = $21, whatsapp_visible = $22,
        whatsapp_phone = $23, whatsapp_message = $24
    where id = 1
    returning ${settingsColumns}
  `, [
    settings.footerTermsVisible,
    settings.footerTermsPdfUrl,
    settings.footerPrivacyVisible,
    settings.footerPrivacyPdfUrl,
    settings.footerCookieVisible,
    settings.footerCookiePdfUrl,
    settings.siteName, settings.companyName,
    settings.homeCopy, settings.goldenVisaCopy, settings.contactCopy, settings.stagesCopy,
    settings.footerPhone, settings.footerEmail, settings.footerAddress,
    settings.facebookVisible, settings.facebookUrl, settings.instagramVisible, settings.instagramUrl,
    settings.linkedinVisible, settings.linkedinUrl, settings.whatsappVisible,
    settings.whatsappPhone, settings.whatsappMessage,
    settings.logoUrl, settings.brandColor,
  ]);
  return mapSiteSettings(result.rows[0]);
}
