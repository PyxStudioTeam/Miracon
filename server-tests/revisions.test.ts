import { describe, expect, it } from 'vitest';
import { sha256 } from '../src/lib/server/auth/crypto';
import { RevisionAccessError, RevisionPersistenceError, RevisionService, type RevisionPool, type RevisionQueryResult, type RevisionTransaction } from '../src/lib/server/revisions';

const token = 'opaque-session-token';
const headId = '4c4e0a24-0e6a-4f37-91f0-813768e0a7da';
const targetId = '2d57a00e-4240-419a-8cbe-40fd4b2bfb3d';
const timestamp = '2026-08-29T00:00:00.000Z';
const settings = {
  aggregateType: 'site_settings' as const,
  aggregateId: 'singleton' as const,
  settings: {
    id: 1 as const,
    footer_terms_visible: false,
    footer_terms_pdf_url: '',
    footer_privacy_visible: false,
    footer_privacy_pdf_url: '',
    footer_cookie_visible: false,
    footer_cookie_pdf_url: '',
    updated_at: timestamp,
  },
};

type Fixture = {
  readonly role?: 'editor' | 'owner';
  readonly currentRevisionId?: string;
  readonly failAt?: string;
  readonly targetState?: 'approved' | 'pending';
  readonly materializedSnapshot?: unknown;
};

class RecordingTransaction implements RevisionTransaction {
  readonly statements: string[] = [];
  released = false;

  constructor(private readonly fixture: Fixture) {}

  async query(text: string, values?: readonly unknown[]): Promise<RevisionQueryResult> {
    this.statements.push(text);
    const marker = /\/\* revision:([a-z-]+) \*\//u.exec(text)?.[1] ?? text.trim().toLowerCase();
    if (marker === this.fixture.failAt) throw new Error('injected database failure');
    const rows = this.rows(marker, values);
    return { rows, rowCount: rows.length };
  }

  release(): void {
    this.released = true;
  }

  private rows(marker: string, values?: readonly unknown[]): readonly Readonly<Record<string, unknown>>[] {
    switch (marker) {
      case 'discover-session': return [{ id: 'session-1', admin_user_id: 1, session_token_hash: sha256(token) }];
      case 'lock-admin': return [{ id: 1 }];
      case 'lock-session': return [{ actor_id: 1, session_id: 'session-1', role: this.fixture.role ?? 'owner' }];
      case 'load-head': return [{ current_revision_id: this.fixture.currentRevisionId ?? headId, current_revision_number: 1, snapshot: settings }];
      case 'allocate-revision': return [{ revision_number: 2 }];
      case 'resolve-revision': return [{ aggregate_type: 'site_settings', aggregate_id: 'singleton' }];
      case 'load-revision': {
        const approved = this.fixture.targetState === 'approved';
        return [{ id: targetId, aggregate_type: 'site_settings', aggregate_id: 'singleton', revision_number: 2,
          state: approved ? 'approved' : 'pending', action: 'proposal', snapshot: settings, expected_revision_id: headId,
          created_by: 2, approved_by: approved ? 1 : null, created_at: new Date(timestamp), approved_at: approved ? new Date(timestamp) : null }];
      }
      case 'insert-revision': return [{ id: targetId, created_at: new Date(timestamp), approved_at: values?.[3] === 'approved' ? new Date(timestamp) : null }];
      case 'transition-revision': return [{ approved_at: values?.[1] === 'approved' ? new Date(timestamp) : null }];
      case 'materialize-revision': return [{ snapshot: this.fixture.materializedSnapshot ?? settings }];
      case 'validate-media': return Array.isArray(values?.[0]) ? values[0].map((id) => ({ id })) : [];
      case 'advance-head': return [{ current_revision_id: targetId }];
      default: return [];
    }
  }
}

class RecordingPool implements RevisionPool {
  readonly transaction: RecordingTransaction;

  constructor(fixture: Fixture = {}) {
    this.transaction = new RecordingTransaction(fixture);
  }

  connect(): Promise<RevisionTransaction> {
    return Promise.resolve(this.transaction);
  }
}

const proposal = () => ({
  action: 'proposal' as const,
  aggregateType: 'site_settings' as const,
  aggregateId: 'singleton',
  snapshot: settings,
  expectedRevisionId: headId,
  mediaFileIds: [],
});

describe('RevisionService transactions', () => {
  it('locks identity and checks access before aggregate and revision writes', async () => {
    // Given
    const pool = new RecordingPool();

    // When
    const result = await new RevisionService(pool).execute(token, proposal());

    // Then
    expect(result.ok).toBe(true);
    const markers = pool.transaction.statements.join('\n');
    expect(markers.indexOf('revision:lock-admin')).toBeLessThan(markers.indexOf('revision:lock-session'));
    expect(markers.indexOf('revision:lock-session')).toBeLessThan(markers.indexOf('revision:lock-aggregate'));
    expect(markers.indexOf('revision:lock-aggregate')).toBeLessThan(markers.indexOf('revision:insert-revision'));
    expect(markers).not.toContain('revision:materialize');
    expect(pool.transaction.statements.at(-1)?.trim().toLowerCase()).toBe('commit');
    expect(pool.transaction.released).toBe(true);
  });

  it('rejects a live editor capability before aggregate access or writes', async () => {
    // Given
    const pool = new RecordingPool({ role: 'editor' });
    const command = { action: 'delete' as const, aggregateType: 'project' as const, aggregateId: 'project-1', expectedCurrentRevisionId: headId };

    // When / Then
    await expect(new RevisionService(pool).execute(token, command)).rejects.toEqual(new RevisionAccessError('forbidden'));
    expect(pool.transaction.statements.join('\n')).not.toMatch(/revision:(lock-aggregate|insert-revision)/u);
    expect(pool.transaction.statements.at(-1)?.trim().toLowerCase()).toBe('rollback');
    expect(pool.transaction.released).toBe(true);
  });

  it('returns a stale conflict and rolls back without writing', async () => {
    // Given
    const pool = new RecordingPool();
    const command = { ...proposal(), expectedRevisionId: targetId };

    // When
    const result = await new RevisionService(pool).execute(token, command);

    // Then
    expect(result).toEqual({ ok: false, error: { kind: 'revision_conflict', expectedRevisionId: targetId, currentRevisionId: headId } });
    expect(pool.transaction.statements.join('\n')).not.toContain('revision:insert-revision');
    expect(pool.transaction.statements.at(-1)?.trim().toLowerCase()).toBe('rollback');
  });

  it('rolls back, releases, and hides an injected PostgreSQL write failure', async () => {
    // Given
    const pool = new RecordingPool({ failAt: 'insert-revision' });

    // When / Then
    await expect(new RevisionService(pool).execute(token, proposal())).rejects.toBeInstanceOf(RevisionPersistenceError);
    expect(pool.transaction.statements.at(-1)?.trim().toLowerCase()).toBe('rollback');
    expect(pool.transaction.released).toBe(true);
  });

  it('self-publishes the submitted snapshot before advancing and auditing', async () => {
    // Given
    const pool = new RecordingPool();
    const command = { ...proposal(), action: 'publish' as const, confirmPublish: true as const, mediaFileIds: ['media-1'] };

    // When
    const result = await new RevisionService(pool).execute(token, command);

    // Then
    expect(result.ok).toBe(true);
    const markers = pool.transaction.statements.join('\n');
    expect(markers.indexOf('revision:materialize-revision')).toBeLessThan(markers.indexOf('revision:validate-media'));
    expect(markers.indexOf('revision:validate-media')).toBeLessThan(markers.indexOf('revision:insert-media'));
    expect(markers.indexOf('revision:insert-media')).toBeLessThan(markers.indexOf('revision:advance-head'));
    expect(markers.indexOf('revision:materialize-revision')).toBeLessThan(markers.indexOf('revision:advance-head'));
    expect(markers.indexOf('revision:advance-head')).toBeLessThan(markers.indexOf('revision:insert-audit'));
  });

  it('rejects a pending proposal without materializing or advancing the head', async () => {
    // Given
    const pool = new RecordingPool();

    // When
    const result = await new RevisionService(pool).execute(token, {
      action: 'reject', revisionId: targetId, expectedCurrentRevisionId: headId,
    });

    // Then
    expect(result.ok && result.value.state).toBe('rejected');
    const markers = pool.transaction.statements.join('\n');
    expect(markers).toContain('revision:transition-revision');
    expect(markers).toContain('revision:insert-audit');
    expect(markers).not.toMatch(/revision:(materialize|advance-head)/u);
  });

  it('creates a higher rollback revision from an approved historical target', async () => {
    // Given
    const pool = new RecordingPool({ targetState: 'approved' });

    // When
    const result = await new RevisionService(pool).execute(token, {
      action: 'rollback', targetRevisionId: targetId, expectedCurrentRevisionId: headId,
    });

    // Then
    expect(result.ok && result.value.action).toBe('rollback');
    const markers = pool.transaction.statements.join('\n');
    expect(markers).toContain('revision:copy-media');
    expect(markers).toContain('revision:materialize-revision');
    expect(markers).toContain('revision:advance-head');
  });

  it('rolls back when canonical readback differs from the approved revision snapshot', async () => {
    // Given
    const pool = new RecordingPool({ materializedSnapshot: {
      ...settings,
      settings: { ...settings.settings, footer_terms_visible: true, footer_terms_pdf_url: '/media/terms.pdf' },
    } });
    const command = { ...proposal(), action: 'publish' as const, confirmPublish: true as const };

    // When
    const result = await new RevisionService(pool).execute(token, command);

    // Then
    expect(result).toEqual({ ok: false, error: { kind: 'snapshot_invalid', aggregateType: 'site_settings', aggregateId: 'singleton' } });
    expect(pool.transaction.statements.join('\n')).not.toContain('revision:advance-head');
    expect(pool.transaction.statements.at(-1)?.trim().toLowerCase()).toBe('rollback');
  });
});
