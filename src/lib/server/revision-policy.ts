import { DatabaseError } from 'pg';
import type { AdminCapability } from './auth/authorization';
import type { ContentAggregateType, RevisionActionInput, RevisionError } from './revision-contracts';

export function requiredRevisionCapability(command: RevisionActionInput): AdminCapability {
  switch (command.action) {
    case 'proposal':
      switch (command.aggregateType) {
        case 'project': return 'proposeProject';
        case 'homepage_hero': return 'proposeHomepageHero';
        case 'site_settings': return 'proposeSiteSettings';
        default: return unreachable(command);
      }
    case 'publish': return 'publishOwnRevision';
    case 'approve': return 'approveRevision';
    case 'reject': return 'rejectRevision';
    case 'rollback': return 'rollbackRevision';
    case 'delete': return 'deleteProject';
    default: return unreachable(command);
  }
}

export function revisionSnapshotError(
  command: RevisionActionInput,
  aggregate: { readonly type: ContentAggregateType; readonly id: string } | null,
): RevisionError {
  if (aggregate) return { kind: 'snapshot_invalid', aggregateType: aggregate.type, aggregateId: aggregate.id };
  if ('aggregateType' in command) return { kind: 'snapshot_invalid', aggregateType: command.aggregateType, aggregateId: command.aggregateId };
  return { kind: 'snapshot_invalid', aggregateType: 'project', aggregateId: 'unknown' };
}

export const isRevisionSnapshotDatabaseError = (error: unknown): boolean =>
  error instanceof DatabaseError && error.code !== undefined && ['22023', '23503', '23514'].includes(error.code);

const unreachable = (value: never): never => {
  void value;
  throw new RevisionPolicyError();
};

class RevisionPolicyError extends Error {
  readonly name = 'RevisionPolicyError';
  constructor() { super('Unreachable revision action'); }
}
