import { getDatabasePool } from '../../lib/server/database';
import { getMediaRoot } from '../../lib/server/media';

export async function GET(): Promise<Response> {
  const [database, media] = await Promise.all([databaseHealthy(), mediaHealthy()]);
  const ok = database && media;
  return Response.json({ ok, database, media }, { status: ok ? 200 : 503 });
}

async function databaseHealthy(): Promise<boolean> {
  try {
    await getDatabasePool().query('select 1');
    return true;
  } catch {
    return false;
  }
}

async function mediaHealthy(): Promise<boolean> {
  const root = await getMediaRoot();
  return root.ok;
}
