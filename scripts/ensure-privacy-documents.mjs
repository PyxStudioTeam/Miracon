import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

export async function ensurePrivacyDocuments(client, mediaRoot) {
  const rootDir = process.cwd();
  const enSource = resolve(rootDir, 'public/documents/privacy-policy-en.pdf');
  const elSource = resolve(rootDir, 'public/documents/privacy-policy-el.pdf');

  if (!existsSync(enSource) || !existsSync(elSource)) {
    console.warn('[Privacy Policy] Source PDFs not found in public/documents/');
    return;
  }

  if (mediaRoot) {
    const privacyDir = join(mediaRoot, 'documents', 'privacy-policy');
    await mkdir(privacyDir, { recursive: true });
    await copyFile(enSource, join(privacyDir, 'privacy-policy-en.pdf'));
    await copyFile(elSource, join(privacyDir, 'privacy-policy-el.pdf'));
    console.log(`[Privacy Policy] Copied PDFs to ${privacyDir}`);
  }

  if (client) {
    const enBuffer = await readFile(enSource);
    const elBuffer = await readFile(elSource);
    const enHash = createHash('sha256').update(enBuffer).digest();
    const elHash = createHash('sha256').update(elBuffer).digest();

    await client.query(`
      insert into miracon.media_files (
        id, relative_url, relative_path, original_name, mime_type, size_bytes, sha256, metadata
      ) values
      (
        'doc-privacy-policy-en',
        '/media/documents/privacy-policy/privacy-policy-en.pdf',
        'documents/privacy-policy/privacy-policy-en.pdf',
        'privacy-policy-en.pdf',
        'application/pdf',
        $1,
        $2,
        '{}'::jsonb
      ),
      (
        'doc-privacy-policy-el',
        '/media/documents/privacy-policy/privacy-policy-el.pdf',
        'documents/privacy-policy/privacy-policy-el.pdf',
        'privacy-policy-el.pdf',
        'application/pdf',
        $3,
        $4,
        '{}'::jsonb
      )
      on conflict (id) do update set
        size_bytes = excluded.size_bytes,
        sha256 = excluded.sha256;
    `, [enBuffer.length, enHash, elBuffer.length, elHash]);

    await client.query(`
      update miracon.site_settings
      set footer_privacy_visible = true,
          footer_privacy_pdf_url = '/media/documents/privacy-policy/privacy-policy-en.pdf'
      where id = 1 and (footer_privacy_pdf_url is null or footer_privacy_pdf_url = '');
    `);
    await client.query(`
      update miracon.site_settings
      set footer_privacy_el_visible = true,
          footer_privacy_el_pdf_url = '/media/documents/privacy-policy/privacy-policy-el.pdf'
      where id = 1 and footer_privacy_el_pdf_url = '';
    `);

    console.log('[Privacy Policy] Registered in database and site settings updated.');
  }
}

// Allow standalone invocation
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
  const databaseUrl = process.env.DATABASE_URL;
  const mediaRoot = process.env.MEDIA_ROOT;
  let client = null;
  if (databaseUrl) {
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
  }
  try {
    await ensurePrivacyDocuments(client, mediaRoot);
  } finally {
    if (client) await client.end();
  }
}
