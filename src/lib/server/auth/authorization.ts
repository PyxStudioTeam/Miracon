import type { AdminRole } from './admin-role';

export const ADMIN_CAPABILITIES = [
  'readAdmin',
  'proposeProject',
  'proposeHomepageHero',
  'proposeSiteSettings',
  'publishOwnRevision',
  'approveRevision',
  'rejectRevision',
  'rollbackRevision',
  'manageEditors',
  'manageContacts',
  'deleteProject',
  'reorderProjects',
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

const capabilitiesByRole: Readonly<Record<AdminRole, readonly AdminCapability[]>> = {
  owner: ADMIN_CAPABILITIES,
  editor: [
    'readAdmin',
    'proposeProject',
    'proposeHomepageHero',
    'proposeSiteSettings',
    'manageContacts',
  ],
};

export function hasCapability(role: AdminRole, capability: AdminCapability): boolean {
  return capabilitiesByRole[role].includes(capability);
}
