import { requireSessionCapability } from '../../../../lib/server/api';
import type { ApiContext } from '../../../../lib/server/api';
import { contactsToCsv } from '../../../../lib/server/contact-export';
import { PostgresContactRepository } from '../../../../lib/server/contact-repository';
import { getDatabasePool } from '../../../../lib/server/database';

export async function GET({ request }: ApiContext): Promise<Response> {
  const session = await requireSessionCapability(request, 'manageContacts');
  if (!session.ok) return session.response;

  const contacts = await new PostgresContactRepository(getDatabasePool()).exportAll();
  return new Response(contactsToCsv(contacts), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="miracon-contacts.csv"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
