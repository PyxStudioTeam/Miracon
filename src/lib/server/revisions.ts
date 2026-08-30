import { z } from 'zod';
import { hasCapability } from './auth/authorization';
import { sha256, verifyTokenDigest } from './auth/crypto';
import { materializeSnapshot, MaterializationError } from './revision-materializers';
import { isRevisionSnapshotDatabaseError, requiredRevisionCapability, revisionSnapshotError } from './revision-policy';
import {
  InvalidSnapshotReferenceError,
  RevisionHeadRaceError,
  RevisionRepository,
  RevisionStateRaceError,
  type RevisionActor,
  type RevisionHeadState,
  type RevisionPool,
  type RevisionTransaction,
  type StoredRevision,
} from './revision-repository';
import {
  revisionActionInputSchema,
  type ContentAggregateType,
  type ContentSnapshot,
  type RevisionActionInput,
  type RevisionError,
  type RevisionResult,
} from './revision-contracts';

export type { RevisionPool, RevisionQueryResult, RevisionTransaction } from './revision-repository';

export class RevisionAccessError extends Error {
  readonly name = 'RevisionAccessError';
  constructor(readonly reason: 'forbidden' | 'unauthenticated') { super('Revision access denied'); }
}

export class RevisionCommandError extends Error {
  readonly name = 'RevisionCommandError';
  constructor() { super('Revision command is invalid'); }
}

export class RevisionPersistenceError extends Error {
  readonly name = 'RevisionPersistenceError';
  constructor() { super('Revision transaction failed'); }
}

class RevisionFailure extends Error {
  readonly name = 'RevisionFailure';
  constructor(readonly revisionError: RevisionError) { super(revisionError.kind); }
}

type Aggregate = { readonly type: ContentAggregateType; readonly id: string };

export class RevisionService {
  constructor(private readonly pool: RevisionPool) {}

  async execute(sessionToken: string, suppliedCommand: RevisionActionInput): Promise<RevisionResult<StoredRevision>> {
    const parsed = revisionActionInputSchema.safeParse(suppliedCommand);
    if (!parsed.success) throw new RevisionCommandError();
    const command = parsed.data;
    const tokenDigest = sha256(sessionToken);
    const transaction = await this.pool.connect();
    const repository = new RevisionRepository(transaction);
    let actionAggregate: Aggregate | null = null;
    try {
      await transaction.query('begin');
      const actor = await this.authenticate(repository, sessionToken, tokenDigest);
      const capability = requiredRevisionCapability(command);
      if (!hasCapability(actor.role, capability)) throw new RevisionAccessError('forbidden');
      const aggregate = await this.resolveAggregate(repository, command);
      actionAggregate = aggregate;
      await repository.lockAggregate(aggregate.type, aggregate.id);
      const head = await repository.loadHead(aggregate.type, aggregate.id);
      const revision = await this.apply(repository, transaction, actor, aggregate, head, command);
      await transaction.query('commit');
      return { ok: true, value: revision };
    } catch (error) {
      try {
        await transaction.query('rollback');
      } catch (rollbackError) {
        void rollbackError;
        throw new RevisionPersistenceError();
      }
      if (error instanceof RevisionFailure) return { ok: false, error: error.revisionError };
      if (error instanceof RevisionAccessError || error instanceof RevisionCommandError || error instanceof RevisionPersistenceError) throw error;
      if (error instanceof InvalidSnapshotReferenceError || error instanceof MaterializationError || error instanceof z.ZodError || isRevisionSnapshotDatabaseError(error)) {
        return { ok: false, error: revisionSnapshotError(command, actionAggregate) };
      }
      throw new RevisionPersistenceError();
    } finally {
      transaction.release();
    }
  }

  private async authenticate(repository: RevisionRepository, token: string, digest: Buffer): Promise<RevisionActor> {
    const discovered = await repository.discoverSession(digest);
    const digestMatches = verifyTokenDigest(token, discovered?.session_token_hash ?? Buffer.alloc(32));
    if (!discovered || !digestMatches) throw new RevisionAccessError('unauthenticated');
    if (!await repository.lockAdmin(discovered.admin_user_id)) throw new RevisionAccessError('unauthenticated');
    const actor = await repository.lockSession(discovered.admin_user_id, discovered.id, digest);
    if (!actor) throw new RevisionAccessError('unauthenticated');
    return actor;
  }

  private async resolveAggregate(repository: RevisionRepository, command: RevisionActionInput): Promise<Aggregate> {
    switch (command.action) {
      case 'proposal':
      case 'publish':
      case 'delete':
        return { type: command.aggregateType, id: command.aggregateId };
      case 'approve':
      case 'reject': {
        const aggregate = await repository.resolveRevision(command.revisionId);
        if (!aggregate) throw new RevisionFailure({ kind: 'revision_not_found', revisionId: command.revisionId });
        return { type: aggregate.aggregateType, id: aggregate.aggregateId };
      }
      case 'rollback': {
        const aggregate = await repository.resolveRevision(command.targetRevisionId);
        if (!aggregate) throw new RevisionFailure({ kind: 'revision_not_found', revisionId: command.targetRevisionId });
        return { type: aggregate.aggregateType, id: aggregate.aggregateId };
      }
      default:
        return assertNever(command);
    }
  }

  private async apply(
    repository: RevisionRepository,
    transaction: RevisionTransaction,
    actor: RevisionActor,
    aggregate: Aggregate,
    head: RevisionHeadState | null,
    command: RevisionActionInput,
  ): Promise<StoredRevision> {
    switch (command.action) {
      case 'proposal':
      case 'publish':
        return this.createFromSnapshot(repository, transaction, actor, aggregate, head, command);
      case 'approve':
      case 'reject':
        return this.reviewProposal(repository, transaction, actor, aggregate, head, command);
      case 'rollback':
        return this.rollback(repository, transaction, actor, aggregate, head, command);
      case 'delete':
        return this.deleteProject(repository, transaction, actor, aggregate, head, command.expectedCurrentRevisionId);
      default:
        return assertNever(command);
    }
  }

  private async createFromSnapshot(
    repository: RevisionRepository,
    transaction: RevisionTransaction,
    actor: RevisionActor,
    aggregate: Aggregate,
    head: RevisionHeadState | null,
    command: Extract<RevisionActionInput, { readonly action: 'proposal' | 'publish' }>,
  ): Promise<StoredRevision> {
    assertExpected(command.expectedRevisionId, head?.currentRevisionId ?? null);
    const before = currentSnapshot(aggregate, head);
    const revision = await repository.insertRevision({
      aggregateType: aggregate.type, aggregateId: aggregate.id, revisionNumber: await repository.allocateRevision(aggregate.type, aggregate.id),
      state: command.action === 'proposal' ? 'pending' : 'approved', action: command.action, snapshot: command.snapshot,
      expectedRevisionId: head?.currentRevisionId ?? null, actorId: actor.actorId,
    });
    if (command.action === 'publish') {
      await materializeSnapshot(transaction, revision);
    }
    await repository.validateAndInsertMedia(revision.id, command.mediaFileIds, aggregate);
    if (command.action === 'publish') {
      await advance(repository, revision, head);
    }
    await repository.insertAudit({ actor, aggregateType: aggregate.type, aggregateId: aggregate.id, revisionId: revision.id, action: command.action, before, after: revision.snapshot });
    return revision;
  }

  private async reviewProposal(
    repository: RevisionRepository,
    transaction: RevisionTransaction,
    actor: RevisionActor,
    aggregate: Aggregate,
    head: RevisionHeadState | null,
    command: Extract<RevisionActionInput, { readonly action: 'approve' | 'reject' }>,
  ): Promise<StoredRevision> {
    const proposal = await requireRevision(repository, command.revisionId);
    if (proposal.aggregateType !== aggregate.type || proposal.aggregateId !== aggregate.id || proposal.action !== 'proposal' || proposal.state !== 'pending') {
      throw new RevisionFailure({ kind: 'invalid_transition', revisionId: proposal.id, state: proposal.state });
    }
    const currentId = head?.currentRevisionId ?? null;
    assertExpected(command.expectedCurrentRevisionId, currentId);
    assertExpected(proposal.expectedRevisionId, currentId);
    let revision: StoredRevision;
    try {
      revision = await repository.transitionProposal(proposal, command.action === 'approve' ? 'approved' : 'rejected', actor.actorId);
    } catch (error) {
      if (error instanceof RevisionStateRaceError) throw new RevisionFailure({ kind: 'invalid_transition', revisionId: proposal.id, state: proposal.state });
      throw error;
    }
    const current = currentSnapshot(aggregate, head);
    if (command.action === 'approve') {
      await materializeSnapshot(transaction, revision);
      await advance(repository, revision, head);
      await repository.insertAudit({ actor, aggregateType: aggregate.type, aggregateId: aggregate.id, revisionId: revision.id, action: 'approve', before: current, after: revision.snapshot });
    } else {
      await repository.insertAudit({ actor, aggregateType: aggregate.type, aggregateId: aggregate.id, revisionId: revision.id, action: 'reject', before: revision.snapshot, after: current });
    }
    return revision;
  }

  private async rollback(
    repository: RevisionRepository,
    transaction: RevisionTransaction,
    actor: RevisionActor,
    aggregate: Aggregate,
    head: RevisionHeadState | null,
    command: Extract<RevisionActionInput, { readonly action: 'rollback' }>,
  ): Promise<StoredRevision> {
    const current = requireHead(aggregate, head);
    assertExpected(command.expectedCurrentRevisionId, current.currentRevisionId);
    const target = await requireRevision(repository, command.targetRevisionId);
    if (target.aggregateType !== aggregate.type || target.aggregateId !== aggregate.id || target.state !== 'approved' || target.id === current.currentRevisionId) {
      throw new RevisionFailure({ kind: 'invalid_transition', revisionId: target.id, state: target.state });
    }
    const revision = await repository.insertRevision({ aggregateType: aggregate.type, aggregateId: aggregate.id, revisionNumber: await repository.allocateRevision(aggregate.type, aggregate.id), state: 'approved', action: 'rollback', snapshot: target.snapshot, expectedRevisionId: current.currentRevisionId, actorId: actor.actorId });
    await materializeSnapshot(transaction, revision);
    await repository.copyMedia(target.id, revision.id);
    await advance(repository, revision, current);
    await repository.insertAudit({ actor, aggregateType: aggregate.type, aggregateId: aggregate.id, revisionId: revision.id, action: 'rollback', before: current.snapshot, after: target.snapshot });
    return revision;
  }

  private async deleteProject(repository: RevisionRepository, transaction: RevisionTransaction, actor: RevisionActor, aggregate: Aggregate, head: RevisionHeadState | null, expectedRevisionId: string): Promise<StoredRevision> {
    const current = requireHead(aggregate, head);
    assertExpected(expectedRevisionId, current.currentRevisionId);
    const snapshot: ContentSnapshot = { aggregateType: 'project', aggregateId: aggregate.id, deleted: true, project: null, images: [] };
    const revision = await repository.insertRevision({ aggregateType: 'project', aggregateId: aggregate.id, revisionNumber: await repository.allocateRevision('project', aggregate.id), state: 'approved', action: 'delete', snapshot, expectedRevisionId: current.currentRevisionId, actorId: actor.actorId });
    await materializeSnapshot(transaction, revision);
    await advance(repository, revision, current);
    await repository.insertAudit({ actor, aggregateType: 'project', aggregateId: aggregate.id, revisionId: revision.id, action: 'delete', before: current.snapshot, after: snapshot });
    return revision;
  }
}

const requireRevision = async (repository: RevisionRepository, revisionId: string): Promise<StoredRevision> => {
  const revision = await repository.loadRevision(revisionId);
  if (!revision) throw new RevisionFailure({ kind: 'revision_not_found', revisionId });
  return revision;
};

const requireHead = (aggregate: Aggregate, head: RevisionHeadState | null): RevisionHeadState => {
  if (!head) throw new RevisionFailure({ kind: 'aggregate_not_found', aggregateType: aggregate.type, aggregateId: aggregate.id });
  return head;
};

const currentSnapshot = (aggregate: Aggregate, head: RevisionHeadState | null): ContentSnapshot => {
  if (head) return head.snapshot;
  if (aggregate.type === 'project') return { aggregateType: 'project', aggregateId: aggregate.id, deleted: true, project: null, images: [] };
  throw new RevisionFailure({ kind: 'aggregate_not_found', aggregateType: aggregate.type, aggregateId: aggregate.id });
};

const assertExpected = (expected: string | null, current: string | null): void => {
  if (expected !== current) throw new RevisionFailure({ kind: 'revision_conflict', expectedRevisionId: expected, currentRevisionId: current });
};

const advance = async (repository: RevisionRepository, revision: StoredRevision, head: RevisionHeadState | null): Promise<void> => {
  try {
    await repository.advanceHead(revision, head?.currentRevisionId ?? null);
  } catch (error) {
    if (error instanceof RevisionHeadRaceError) throw new RevisionFailure({ kind: 'revision_conflict', expectedRevisionId: head?.currentRevisionId ?? null, currentRevisionId: null });
    throw error;
  }
};

const assertNever = (value: never): never => { void value; throw new RevisionCommandError(); };
