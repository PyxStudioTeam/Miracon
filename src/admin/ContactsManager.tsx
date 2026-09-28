import { useEffect, useState } from 'react';
import type { AdminApi, AdminContact } from './admin-api';

type ContactsManagerProps = { readonly api: AdminApi };
const pageSize = 50;

export default function ContactsManager({ api }: ContactsManagerProps) {
  const [contacts, setContacts] = useState<AdminContact[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const load = async () => {
      try {
        const page = await api.listContacts(pageSize, offset);
        if (active) setContacts(page);
      } catch {
        if (active) setError('Unable to load contacts. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [api, offset]);

  const download = async () => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const file = await api.exportContactsCsv();
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'miracon-contacts.csv';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice('All stored contacts exported as UTF-8 CSV.');
    } catch {
      setError('Unable to export contacts. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-contacts" aria-label="Contact requests">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div><span className="eyebrow">Contact requests</span><h2>Submitted enquiries</h2><p>Read-only requests, newest first.</p></div>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void download()}>Export all contacts (CSV)</button>
      </header>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading ? <p>Loading contacts…</p> : (
        <>
          {contacts.length === 0 ? <p>No requests on this page.</p> : (
            <div style={{ display: 'grid', gap: 12 }}>
              {contacts.map((contact) => (
                <article key={contact.id} className="project-row" style={{ display: 'block', padding: 16, overflowWrap: 'anywhere' }}>
                  <strong>{contact.name}</strong>
                  <p><time dateTime={contact.createdAt}>{new Date(contact.createdAt).toLocaleString()}</time> · {contact.locale.toUpperCase()}</p>
                  <p>Phone: {contact.phone ?? 'Not provided'} · Email: {contact.email ?? 'Not provided'}</p>
                  <p>Source: <a href={contact.sourcePath} target="_blank" rel="noopener noreferrer">{contact.sourcePath}</a></p>
                  <p style={{ whiteSpace: 'pre-wrap' }}>Full message: {contact.message}</p>
                </article>
              ))}
            </div>
          )}
          <nav aria-label="Contact pages" style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16 }}>
            <button type="button" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - pageSize))}>Previous</button>
            <span>Page {Math.floor(offset / pageSize) + 1}</span>
            <button type="button" disabled={contacts.length < pageSize} onClick={() => setOffset((value) => value + pageSize)}>Next</button>
          </nav>
        </>
      )}
    </section>
  );
}
