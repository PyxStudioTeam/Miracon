import { json, jsonError, requireSessionCapability } from '../../../../lib/server/api';
import type { ApiContext } from '../../../../lib/server/api';
import { contactListQuerySchema } from '../../../../lib/server/contact-contracts';
import { PostgresContactRepository } from '../../../../lib/server/contact-repository';
import { getDatabasePool } from '../../../../lib/server/database';

export async function GET({ request }: ApiContext): Promise<Response> {
  const session = await requireSessionCapability(request, 'manageContacts');
  if (!session.ok) return session.response;
  const url = new URL(request.url);
  const parsed = contactListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return jsonError(400, 'invalid_request', 'Contact list query is invalid');

  const contacts = await new PostgresContactRepository(getDatabasePool()).list(parsed.data.limit, parsed.data.offset);
  return json({
    contacts: contacts.map((contact) => ({
      ...contact,
      createdAt: contact.createdAt.toISOString(),
    })),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
