import { createClient } from '@supabase/supabase-js';

export const DEFAULT_PAGE_SIZE = 500;
export const MAX_PAGE_SIZE = 1000;

export class SupabaseSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SupabaseSourceError';
  }
}

export function createSupabaseSourceClient(sourceUrl, serviceRoleKey) {
  return createClient(sourceUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function validatePageSize(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new SupabaseSourceError(`Page size must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  }
  return value;
}

function safeErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,32}$/u.test(error.code)
    ? ` (${error.code})`
    : '';
}

async function readTable(client, table, pageSize) {
  const rows = [];
  const ids = new Set();
  let expectedCount;
  let previousId;

  for (let offset = 0; ; offset += pageSize) {
    let response;
    try {
      response = await client
        .from(table)
        .select('*', { count: 'exact' })
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
    } catch {
      throw new SupabaseSourceError(`${table} source query failed`);
    }
    if (!response || typeof response !== 'object') {
      throw new SupabaseSourceError(`${table} returned an invalid response`);
    }
    if (response.error) {
      throw new SupabaseSourceError(`${table} source query failed${safeErrorCode(response.error)}`);
    }
    if (!Array.isArray(response.data)) {
      throw new SupabaseSourceError(`${table} response data must be an array`);
    }
    if (!Number.isSafeInteger(response.count) || response.count < 0) {
      throw new SupabaseSourceError(`${table} response requires an exact non-negative count`);
    }
    expectedCount ??= response.count;
    if (response.count !== expectedCount || response.data.length > pageSize || rows.length + response.data.length > expectedCount) {
      throw new SupabaseSourceError(`${table} count changed or page exceeded the expected result`);
    }

    for (const row of response.data) {
      const id = row?.id;
      if ((typeof id !== 'string' && typeof id !== 'number') || String(id).length === 0) {
        throw new SupabaseSourceError(`${table} row requires a stable id`);
      }
      const stableId = String(id);
      if (ids.has(stableId)) throw new SupabaseSourceError(`Duplicate ${table} id ${stableId}`);
      if (previousId !== undefined && previousId.localeCompare(stableId) >= 0) {
        throw new SupabaseSourceError(`${table} rows were not returned in stable id order`);
      }
      ids.add(stableId);
      previousId = stableId;
      rows.push(row);
    }

    if (response.data.length < pageSize) {
      if (rows.length !== expectedCount) throw new SupabaseSourceError(`${table} page ended before exact count ${expectedCount}`);
      return rows;
    }
  }
}

async function readSiteSettings(client) {
  let response;
  try {
    response = await client.from('site_settings').select('*').eq('id', 1).single();
  } catch {
    throw new SupabaseSourceError('site_settings source query failed');
  }
  if (!response || typeof response !== 'object') throw new SupabaseSourceError('site_settings returned an invalid response');
  if (response.error) throw new SupabaseSourceError(`site_settings source query failed${safeErrorCode(response.error)}`);
  if (response.data === null || typeof response.data !== 'object' || Array.isArray(response.data) || response.data.id !== 1) {
    throw new SupabaseSourceError('site_settings singleton id 1 is required');
  }
  return response.data;
}

export async function readSupabaseSource({ client, pageSize = DEFAULT_PAGE_SIZE }) {
  const size = validatePageSize(pageSize);
  const projects = await readTable(client, 'projects', size);
  const projectImages = await readTable(client, 'project_images', size);
  const homepageVideos = await readTable(client, 'homepage_videos', size);
  const siteSettings = await readSiteSettings(client);
  return { projects, projectImages, homepageVideos, siteSettings };
}
