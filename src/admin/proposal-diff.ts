import type { ContentSnapshot, CanonicalProjectImageRow } from '../lib/server/revision-contracts';

export function isStaleProposal(proposal: { readonly expectedRevisionId: string | null; readonly currentHeadRevisionId: string | null }): boolean {
  return proposal.expectedRevisionId !== proposal.currentHeadRevisionId;
}

export type FieldChange = { readonly label: string; readonly before: unknown; readonly after: unknown };
export type ImageChange = {
  readonly label: string;
  readonly kind: 'added' | 'removed' | 'replaced' | 'moved' | 'updated';
  readonly beforeUrl: string | null;
  readonly afterUrl: string | null;
};
export type ProposalDiff = {
  readonly state: 'added' | 'deleted' | 'changed' | 'no-head';
  readonly fields: readonly FieldChange[];
  readonly images: readonly ImageChange[];
};

const technicalKeys: Record<string, true> = {
  id: true, project_id: true, created_at: true, updated_at: true, published_at: true,
  storage_path: true, desktop_storage_path: true, mobile_storage_path: true, image_variants: true,
  width: true, height: true,
};
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (key: string) => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
const label = (path: readonly string[]) => path.map(text).join(' / ');
const mediaUrl = (value: unknown): string | null => typeof value === 'string' && value ? value : null;

function compareValue(before: unknown, after: unknown, path: string[], fields: FieldChange[]): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (before === undefined && after === undefined) return;
  const oldRecord = record(before);
  const newRecord = record(after);
  if (oldRecord || newRecord) {
    for (const key of new Set([...Object.keys(oldRecord ?? {}), ...Object.keys(newRecord ?? {})])) {
      if (!Object.hasOwn(technicalKeys, key)) compareValue(oldRecord?.[key], newRecord?.[key], [...path, key], fields);
    }
    return;
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    const oldList = Array.isArray(before) ? before : [];
    const newList = Array.isArray(after) ? after : [];
    // Keyed editor collections preserve identity across reorders; order is a separate change.
    const keyed = [...oldList, ...newList].every((item) => typeof record(item)?.['id'] === 'string');
    if (keyed && (oldList.length || newList.length)) {
      const oldById = new Map(oldList.map((item) => [record(item)!['id'] as string, item]));
      const newById = new Map(newList.map((item) => [record(item)!['id'] as string, item]));
      for (const id of new Set([...oldById.keys(), ...newById.keys()])) {
        compareValue(oldById.get(id), newById.get(id), [...path, id], fields);
      }
      for (const [id, item] of newById) {
        const oldPosition = oldList.findIndex((entry) => record(entry)?.['id'] === id);
        const newPosition = newList.findIndex((entry) => record(entry)?.['id'] === id);
        if (oldPosition >= 0 && oldPosition !== newPosition) {
          const name = record(item)?.['title'] ?? record(item)?.['label'] ?? id;
          fields.push({ label: label([...path, String(name), 'position']), before: oldPosition + 1, after: newPosition + 1 });
        }
      }
    } else {
      for (let i = 0; i < Math.max(oldList.length, newList.length); i += 1) {
        compareValue(oldList[i], newList[i], [...path, String(i + 1)], fields);
      }
    }
    return;
  }
  fields.push({ label: label(path), before, after });
}

function addMediaChange(images: ImageChange[], title: string, before: unknown, after: unknown, kind?: ImageChange['kind']) {
  const beforeUrl = mediaUrl(before);
  const afterUrl = mediaUrl(after);
  if (beforeUrl !== afterUrl) images.push({ label: title, kind: kind ?? (beforeUrl && afterUrl ? 'replaced' : beforeUrl ? 'removed' : 'added'), beforeUrl, afterUrl });
}

function collectEmbeddedMedia(before: unknown, after: unknown, path: string[], images: ImageChange[]): void {
  const oldRecord = record(before);
  const newRecord = record(after);
  if (oldRecord || newRecord) {
    for (const key of new Set([...Object.keys(oldRecord ?? {}), ...Object.keys(newRecord ?? {})])) {
      if (Object.hasOwn(technicalKeys, key)) continue;
      const oldValue = oldRecord?.[key];
      const newValue = newRecord?.[key];
      const imageKey = /(?:cover|intro|poster|image|logo|icon|benefit).*url|(?:posterUrl|imageUrl|iconUrl)$/iu.test(key);
      if (imageKey && (typeof oldValue === 'string' || typeof newValue === 'string' || oldValue === null || newValue === null)) {
        addMediaChange(images, label([...path, key]), oldValue, newValue);
      } else collectEmbeddedMedia(oldValue, newValue, [...path, key], images);
    }
  } else if (Array.isArray(before) || Array.isArray(after)) {
    const oldList = Array.isArray(before) ? before : [];
    const newList = Array.isArray(after) ? after : [];
    const keyed = [...oldList, ...newList].every((item) => typeof record(item)?.['id'] === 'string');
    if (keyed) {
      const oldById = new Map(oldList.map((item) => [record(item)!['id'] as string, item]));
      const newById = new Map(newList.map((item) => [record(item)!['id'] as string, item]));
      for (const id of new Set([...oldById.keys(), ...newById.keys()])) collectEmbeddedMedia(oldById.get(id), newById.get(id), [...path, id], images);
    } else {
      for (let i = 0; i < Math.max(oldList.length, newList.length); i += 1) collectEmbeddedMedia(oldList[i], newList[i], [...path, String(i + 1)], images);
    }
  }
}

function compareProjectImages(before: readonly CanonicalProjectImageRow[], after: readonly CanonicalProjectImageRow[], images: ImageChange[], fields: FieldChange[]): void {
  const oldById = new Map(before.map((image) => [image.id, image]));
  const newById = new Map(after.map((image) => [image.id, image]));
  for (const id of new Set([...oldById.keys(), ...newById.keys()])) {
    const old = oldById.get(id);
    const next = newById.get(id);
    const title = `${next?.role ?? old?.role} / ${id}`;
    if (!old || !next) {
      images.push({ label: title, kind: old ? 'removed' : 'added', beforeUrl: mediaUrl(old?.url), afterUrl: mediaUrl(next?.url) });
      compareValue(old, next, ['photos', id], fields);
      continue;
    }
    const moved = old.role !== next.role || old.sort_order !== next.sort_order;
    const changed = old.url !== next.url || old.alt !== next.alt || old.focal_x !== next.focal_x || old.focal_y !== next.focal_y;
    if (moved || changed) images.push({ label: title, kind: old.url !== next.url ? 'replaced' : moved ? 'moved' : 'updated', beforeUrl: mediaUrl(old.url), afterUrl: mediaUrl(next.url) });
    compareValue(old, next, ['photos', id], fields);
  }
}

export function diffProposal(current: ContentSnapshot | null, proposed: ContentSnapshot): ProposalDiff {
  const fields: FieldChange[] = [];
  const images: ImageChange[] = [];
  if (proposed.aggregateType === 'project') {
    const old = current?.aggregateType === 'project' ? current : null;
    compareValue(old?.project, proposed.project, ['project'], fields);
    collectEmbeddedMedia(old?.project, proposed.project, ['project'], images);
    if (old?.project?.hero_type === 'image' || proposed.project?.hero_type === 'image') {
      addMediaChange(images, 'project / hero image', old?.project?.hero_type === 'image' ? old.project.hero_url : null,
        proposed.project?.hero_type === 'image' ? proposed.project.hero_url : null);
    }
    compareProjectImages(old?.images ?? [], proposed.images, images, fields);
    return { state: !current ? 'no-head' : proposed.deleted ? 'deleted' : old?.deleted ? 'added' : 'changed', fields, images };
  }
  if (proposed.aggregateType === 'homepage_hero') {
    const old = current?.aggregateType === 'homepage_hero' ? current.videos : undefined;
    compareValue(old, proposed.videos, ['hero videos'], fields);
    collectEmbeddedMedia(old, proposed.videos, ['hero videos'], images);
  } else {
    const old = current?.aggregateType === 'site_settings' ? current.settings : undefined;
    compareValue(old, proposed.settings, ['site settings'], fields);
    collectEmbeddedMedia(old, proposed.settings, ['site settings'], images);
  }
  return { state: current ? 'changed' : 'no-head', fields, images };
}
