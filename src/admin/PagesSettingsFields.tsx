import type { SiteSettings } from '../lib/site-settings-shared';
import { goldenVisaCopyKeys, homeCopyKeys } from '../lib/site-settings-shared';

const titleCase = (value: string) => value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
const locales = ['en', 'el'] as const;

export default function PagesSettingsFields({ settings, onChange }: {
  settings: SiteSettings;
  onChange: (settings: SiteSettings) => void;
}) {
  return (
    <div className="pages-settings-fields">
      <h3>Brand and contact information</h3>
      <p>Text and metadata update here. The logo artwork, favicon, DNS, and reviewed privacy-policy legal entity/contact text are separate: replace or review those before changing the brand.</p>
      <label>Site name<input type="text" value={settings.siteName} onChange={(event) => onChange({ ...settings, siteName: event.target.value })} /></label>
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
        return <fieldset key={network}>
          <legend>{titleCase(network)}</legend>
          <label><input type="checkbox" checked={settings[visibleKey]} onChange={(event) => onChange({ ...settings, [visibleKey]: event.target.checked })} /> Show link</label>
          <label>HTTPS profile URL<input type="url" value={settings[urlKey]} onChange={(event) => onChange({ ...settings, [urlKey]: event.target.value })} /></label>
        </fieldset>;
      })}
      <fieldset>
        <legend>WhatsApp</legend>
        <label><input type="checkbox" checked={settings.whatsappVisible} onChange={(event) => onChange({ ...settings, whatsappVisible: event.target.checked })} /> Show link</label>
        <label>International number (digits with country code)<input type="tel" value={settings.whatsappPhone} onChange={(event) => onChange({ ...settings, whatsappPhone: event.target.value })} /></label>
        <label>Prefilled message (optional)<textarea value={settings.whatsappMessage} onChange={(event) => onChange({ ...settings, whatsappMessage: event.target.value })} /></label>
      </fieldset>
      {locales.map((locale) => <section key={locale} aria-label={`${locale.toUpperCase()} page content`}>
        <h3>{locale === 'en' ? 'English' : 'Greek'} page content</h3>
        <fieldset>
          <legend>Homepage</legend>
          {homeCopyKeys.map((key) => <label key={key}>{titleCase(key)}
            <textarea value={settings.homeCopy[locale][key]} onChange={(event) => onChange({ ...settings, homeCopy: {
              ...settings.homeCopy, [locale]: { ...settings.homeCopy[locale], [key]: event.target.value },
            } })} />
          </label>)}
        </fieldset>
        <fieldset>
          <legend>Golden Visa page</legend>
          {goldenVisaCopyKeys.map((key) => <label key={key}>{titleCase(key)}
            <textarea value={settings.goldenVisaCopy[locale][key]} onChange={(event) => onChange({ ...settings, goldenVisaCopy: {
              ...settings.goldenVisaCopy, [locale]: { ...settings.goldenVisaCopy[locale], [key]: event.target.value },
            } })} />
          </label>)}
        </fieldset>
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
    </div>
  );
}
