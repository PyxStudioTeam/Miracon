import { useState } from 'react';
import type { SiteSettings } from '../lib/site-settings-shared';
import { externalSocialUrl, goldenVisaCopyKeys, homeCopyKeys } from '../lib/site-settings-shared';

const titleCase = (value: string) => value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
const locales = ['en', 'el'] as const;
type Locale = (typeof locales)[number];

function PageCopyHeader({ title, locale, onLocaleChange }: {
  title: string;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  return (
    <header className="editor-locale-toolbar">
      <div><strong>{title}</strong><span>Edit this page's text in English or Greek</span></div>
      <div className="presentation-switch" role="group" aria-label={`${title} content language`}>
        {locales.map((language) => (
          <button key={language} type="button" className={locale === language ? 'active' : ''} aria-pressed={locale === language} onClick={() => onLocaleChange(language)}>
            {language === 'en' ? 'EN' : 'ΕΛ'}
          </button>
        ))}
      </div>
    </header>
  );
}

export default function PagesSettingsFields({ settings, onChange, mode }: {
  settings: SiteSettings;
  onChange: (settings: SiteSettings) => void;
  mode: 'pages-home' | 'pages-visa' | 'pages-shared' | 'branding';
}) {
  const [homeLocale, setHomeLocale] = useState<Locale>('en');
  const [goldenVisaLocale, setGoldenVisaLocale] = useState<Locale>('en');
  return (
    <div className="pages-settings-fields">
      {mode === 'branding' ? <>
      <h3>Company and contact details</h3>
      <p>The website name and logo are above. Manage your company name, footer contacts and social links here.</p>
      <label>Company name<input type="text" value={settings.companyName} onChange={(event) => onChange({ ...settings, companyName: event.target.value })} /></label>
      <label>Phone (international)<input type="tel" value={settings.footerPhone} onChange={(event) => onChange({ ...settings, footerPhone: event.target.value })} /></label>
      <label>Email<input type="email" value={settings.footerEmail} onChange={(event) => onChange({ ...settings, footerEmail: event.target.value })} /></label>
      {locales.map((locale) => <label key={`address-${locale}`}>Address ({locale.toUpperCase()})
        <input type="text" value={settings.footerAddress[locale]} onChange={(event) => onChange({ ...settings, footerAddress: { ...settings.footerAddress, [locale]: event.target.value } })} />
      </label>)}
      <h3>Social links</h3>
      {(['facebook', 'instagram', 'linkedin'] as const).map((network) => {
        const visibleKey = `${network}Visible` as const;
        const urlKey = `${network}Url` as const;
        const invalidUrl = settings[urlKey] !== '' && externalSocialUrl(settings[urlKey]) === null;
        return <fieldset key={network}>
          <legend>{titleCase(network)}</legend>
          <label><input type="checkbox" checked={settings[visibleKey]} onChange={(event) => onChange({ ...settings, [visibleKey]: event.target.checked })} /> Show link</label>
          <label>HTTPS profile URL<input type="url" value={settings[urlKey]} aria-invalid={invalidUrl} aria-describedby={invalidUrl ? `${network}-url-error` : undefined} onChange={(event) => onChange({ ...settings, [urlKey]: event.target.value })} /></label>
          {invalidUrl && <small id={`${network}-url-error`} className="social-url-error" role="alert">Enter your {titleCase(network)} profile URL starting with https:// (not http://).</small>}
        </fieldset>;
      })}
      <fieldset>
        <legend>WhatsApp</legend>
        <label><input type="checkbox" checked={settings.whatsappVisible} onChange={(event) => onChange({ ...settings, whatsappVisible: event.target.checked })} /> Show link</label>
        <label>International number (digits with country code)<input type="tel" value={settings.whatsappPhone} onChange={(event) => onChange({ ...settings, whatsappPhone: event.target.value })} /></label>
        <label>Prefilled message (optional)<textarea value={settings.whatsappMessage} onChange={(event) => onChange({ ...settings, whatsappMessage: event.target.value })} /></label>
      </fieldset>
      </> : <>
      {mode === 'pages-home' && <section className="pages-copy-section" aria-label="Homepage content">
        <PageCopyHeader title="Homepage" locale={homeLocale} onLocaleChange={setHomeLocale} />
        <div className="pages-copy-fields">
          {homeCopyKeys.map((key) => <label key={key}>{titleCase(key)}
            <textarea value={settings.homeCopy[homeLocale][key]} onChange={(event) => onChange({ ...settings, homeCopy: {
              ...settings.homeCopy, [homeLocale]: { ...settings.homeCopy[homeLocale], [key]: event.target.value },
            } })} />
          </label>)}
        </div>
      </section>}
      {mode === 'pages-visa' && <section className="pages-copy-section" aria-label="Golden Visa page content">
        <PageCopyHeader title="Golden Visa page" locale={goldenVisaLocale} onLocaleChange={setGoldenVisaLocale} />
        <div className="pages-copy-fields">
          {goldenVisaCopyKeys.map((key) => <label key={key}>{titleCase(key)}
            <textarea value={settings.goldenVisaCopy[goldenVisaLocale][key]} onChange={(event) => onChange({ ...settings, goldenVisaCopy: {
              ...settings.goldenVisaCopy, [goldenVisaLocale]: { ...settings.goldenVisaCopy[goldenVisaLocale], [key]: event.target.value },
            } })} />
          </label>)}
        </div>
      </section>}
      {mode === 'pages-shared' && locales.map((locale) => <section key={locale} aria-label={`${locale.toUpperCase()} page content`}>
        <h3>{locale === 'en' ? 'English' : 'Greek'} contact form and stages</h3>
        <fieldset>
          <legend>Contact form</legend>
          {(['title', 'description'] as const).map((key) => <label key={key}>{titleCase(key)}
            <textarea value={settings.contactCopy[locale][key]} onChange={(event) => onChange({ ...settings, contactCopy: {
              ...settings.contactCopy, [locale]: { ...settings.contactCopy[locale], [key]: event.target.value },
            } })} />
          </label>)}
        </fieldset>
        <fieldset>
          <legend>Five stages (shown on both pages)</legend>
          {(['title', 'description'] as const).map((key) => <label key={key}>{titleCase(key)}
            <textarea value={settings.stagesCopy[locale][key]} onChange={(event) => onChange({ ...settings, stagesCopy: {
              ...settings.stagesCopy, [locale]: { ...settings.stagesCopy[locale], [key]: event.target.value },
            } })} />
          </label>)}
          {settings.stagesCopy[locale].steps.map((step, index) => <div key={index}>
            <strong>Step {String(index + 1).padStart(2, '0')}</strong>
            {(['title', 'text'] as const).map((key) => <label key={key}>{titleCase(key)}
              <textarea value={step[key]} onChange={(event) => {
                const steps = [...settings.stagesCopy[locale].steps] as SiteSettings['stagesCopy']['en']['steps'];
                steps[index] = { ...step, [key]: event.target.value };
                onChange({ ...settings, stagesCopy: {
                  ...settings.stagesCopy, [locale]: { ...settings.stagesCopy[locale], steps },
                } });
              }} />
            </label>)}
          </div>)}
        </fieldset>
      </section>)}
      </>}
    </div>
  );
}
