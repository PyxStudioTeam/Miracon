import type { ContactSummary } from './contact-repository';

const columns = ['Date', 'Name', 'Phone', 'Email', 'Full text', 'Source'];

// Prefix spreadsheet control characters, including after leading whitespace, before CSV quoting.
function cell(value: string): string {
  const safe = /^[\s\u200B-\u200D\uFEFF]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function contactsToCsv(contacts: readonly ContactSummary[]): string {
  return `\uFEFF${[
    columns.map(cell).join(','),
    ...contacts.map((contact) => [
      contact.createdAt.toISOString(),
      contact.name,
      contact.phone ?? '',
      contact.email ?? '',
      contact.message,
      contact.sourcePath,
    ].map(cell).join(',')),
  ].join('\r\n')}\r\n`;
}
