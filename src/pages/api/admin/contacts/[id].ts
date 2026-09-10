import {
  json,
  jsonError,
  requireAdminMutationCapability,
  requireSessionCapability,
} from '../../../../lib/server/api';
import type { ApiContext } from '../../../../lib/server/api';
import { contactIdSchema } from '../../../../lib/server/contact-contracts';
import { PostgresContactRepository } from '../../../../lib/server/contact-repository';
import { getDatabasePool } from '../../../../lib/server/database';

export async function GET({ request, params }: ApiContext): Promise<Response> {
  const session = await requireSessionCapability(request, 'manageContacts');
  if (!session.ok) return session.response;
  const id = contactIdSchema.safeParse(params.id);
  if (!id.success) return jsonError(400, 'invalid_request', 'Invalid contact ID');

  const contact = await new PostgresContactRepository(getDatabasePool()).get(id.data);
  if (!contact) return jsonError(404, 'not_found', 'Contact request was not found');
  return json({
    contact: {
      ...contact,
      createdAt: contact.createdAt.toISOString(),
      consentedAt: contact.consentedAt.toISOString(),
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function DELETE({ request, params }: ApiContext): Promise<Response> {
  const session = await requireAdminMutationCapability(request, 'manageContacts');
  if (!session.ok) return session.response;
  const id = contactIdSchema.safeParse(params.id);
  if (!id.success) return jsonError(400, 'invalid_request', 'Invalid contact ID');

  const deleted = await new PostgresContactRepository(getDatabasePool()).delete(id.data);
  if (!deleted) return jsonError(404, 'not_found', 'Contact request was not found');
  return new Response(null, { status: 204 });
}
