import { useState } from 'react';
import type { PendingProposal } from './admin-api';
import { diffProposal, type ImageChange } from './proposal-diff';

function format(value: unknown): string {
  if (value === undefined) return 'Absent';
  if (value === null || value === '') return 'Empty';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function changeKind(before: unknown, after: unknown): string {
  if (before === undefined) return 'Added';
  if (after === undefined) return 'Removed';
  if (after === null || after === '') return 'Cleared';
  return 'Changed';
}

function SafePreview({ url, label }: { url: string | null; label: string }) {
  const safe = url && (url.startsWith('/') && !url.startsWith('//') || /^https:\/\//iu.test(url));
  return safe ? <img src={url} alt={label} loading="lazy" /> : <span className="proposal-image-empty">{url ? 'Preview unavailable' : 'No image'}</span>;
}

const imageBadge: Record<ImageChange['kind'], string> = {
  added: 'Добавлено', removed: 'Удалено', replaced: 'Заменено', moved: 'Перемещено', updated: 'Изменено',
};

export default function ProposalReviewContent({ proposal }: { proposal: PendingProposal }) {
  const [raw, setRaw] = useState(false);
  const diff = diffProposal(proposal.currentHeadSnapshot, proposal.snapshot);
  return <div className="proposal-review">
    <div className="proposal-review-toolbar">
      <strong>Сейчас (HEAD) → Предложено</strong>
      <button type="button" className="secondary-button" onClick={() => setRaw(!raw)}>{raw ? 'Show changes' : 'Raw JSON (both)'}</button>
    </div>
    {raw ? <div className="proposal-raw-pair">
      <section><h4>Сейчас (HEAD)</h4><pre>{JSON.stringify(proposal.currentHeadSnapshot, null, 2) ?? 'null'}</pre></section>
      <section><h4>Предложено</h4><pre>{JSON.stringify(proposal.snapshot, null, 2)}</pre></section>
    </div> : <div className="proposal-diff-body">
      {diff.state === 'no-head' && <p className="proposal-diff-state">No current HEAD; this proposal creates content without a baseline.</p>}
      {diff.state === 'added' && <p className="proposal-diff-state">Project added to a deleted HEAD.</p>}
      {diff.state === 'deleted' && <p className="proposal-diff-state">Project deletion proposed; all current content will be removed.</p>}
      {!diff.fields.length && !diff.images.length && <p>No content changes relative to current HEAD. Revision conflicts still require a new proposal.</p>}
      {diff.fields.map((field, index) => <div className="proposal-field-change" key={`${field.label}-${index}`}>
        <strong>{field.label}</strong> <span className="proposal-change-kind">{changeKind(field.before, field.after)}</span>
        <div className="proposal-before-after">
          <div className="proposal-before"><small>Сейчас (HEAD)</small><del>{format(field.before)}</del></div>
          <div className="proposal-after"><small>Предложено</small><ins>{format(field.after)}</ins></div>
        </div>
      </div>)}
      {diff.images.length > 0 && <h4>Photo changes</h4>}
      {diff.images.map((image, index) => <div className={`proposal-image-change proposal-image-${image.kind}`} key={`${image.label}-${index}`}>
        <div><strong>{image.label}</strong> <span className="proposal-image-badge">{imageBadge[image.kind]}</span></div>
        <div className="proposal-before-after">
          {image.kind !== 'added' && <div className="proposal-before"><small>Сейчас (HEAD)</small><SafePreview url={image.beforeUrl} label={`Current ${image.label}`} /><span>{image.beforeUrl || 'No URL'}</span></div>}
          {image.kind !== 'removed' && <div className="proposal-after"><small>Предложено</small><SafePreview url={image.afterUrl} label={`Proposed ${image.label}`} /><span>{image.afterUrl || 'No URL'}</span></div>}
        </div>
      </div>)}
    </div>}
  </div>;
}
