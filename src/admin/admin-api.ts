import { z } from 'zod';
import { homepageVideosSchema, projectSchema, siteSettingsSchema } from '../lib/server/api-schemas';
import type { HomeHeroVideo } from '../lib/home-hero';
import type { Project } from '../lib/project-types';
import type { SiteSettings } from '../lib/site-settings-shared';

const sessionSchema = z.object({
  authenticated: z.literal(true),
  expiresAt: z.iso.datetime(),
  role: z.enum(['owner', 'editor']).optional(),
  email: z.string().optional(),
  adminUserId: z.number().optional(),
});
const csrfSchema = z.object({ csrfToken: z.string().min(1) });
const loginSchema = sessionSchema.extend({ csrfToken: z.string().min(1) });
const canonicalProjectSchema = projectSchema.extend({
  updatedAt: z.iso.datetime(),
  currentRevisionId: z.string().optional(),
  managedMedia: z.array(z.object({
    id: z.string(),
    relativeUrl: z.string(),
    relativePath: z.string(),
  })).optional(),
});
const projectsSchema = z.object({ projects: z.array(canonicalProjectSchema) });
const projectResponseSchema = z.object({
  project: canonicalProjectSchema,
  revision: z.unknown().optional(),
  isProposal: z.boolean().optional(),
});
const homeHeroResponseSchema = z.object({
  videos: homepageVideosSchema.shape.videos,
  currentRevisionId: z.string().nullable().optional(),
  revision: z.unknown().optional(),
  isProposal: z.boolean().optional(),
});
const settingsResponseSchema = z.object({
  settings: siteSettingsSchema,
  currentRevisionId: z.string().nullable().optional(),
  revision: z.unknown().optional(),
  isProposal: z.boolean().optional(),
});
const mediaSchema = z.object({
  id: z.string(),
  relativeUrl: z.string().min(1),
  relativePath: z.string().min(1),
  originalName: z.string().nullable(),
  mimeType: z.string().min(1),
  sizeBytes: z.number().nonnegative(),
  sha256: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
const mediaResponseSchema = z.object({ media: mediaSchema });
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const adminUserSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().min(1),
  role: z.enum(['owner', 'editor']),
  isActive: z.boolean(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
});
const usersListSchema = z.object({ users: z.array(adminUserSchema) });
const userResponseSchema = z.object({ user: adminUserSchema });

const pendingProposalSchema = z.object({
  id: z.string(),
  aggregateType: z.enum(['project', 'homepage_hero', 'site_settings']),
  aggregateId: z.string(),
  revisionNumber: z.number(),
  state: z.literal('pending'),
  action: z.literal('proposal'),
  snapshot: z.unknown(),
  expectedRevisionId: z.string().nullable(),
  createdBy: z.number(),
  creatorEmail: z.string(),
  creatorRole: z.enum(['owner', 'editor']),
  createdAt: z.string(),
  currentHeadRevisionId: z.string().nullable(),
});
const proposalsResponseSchema = z.object({ proposals: z.array(pendingProposalSchema) });

const revisionHistoryItemSchema = z.object({
  id: z.string(),
  aggregateType: z.enum(['project', 'homepage_hero', 'site_settings']),
  aggregateId: z.string(),
  revisionNumber: z.number(),
  state: z.enum(['pending', 'approved', 'rejected']),
  action: z.enum(['baseline', 'proposal', 'publish', 'rollback', 'delete']),
  snapshot: z.unknown(),
  expectedRevisionId: z.string().nullable(),
  createdBy: z.number().nullable(),
  creatorEmail: z.string().nullable(),
  creatorRole: z.enum(['owner', 'editor']).nullable(),
  approvedBy: z.number().nullable(),
  approverEmail: z.string().nullable(),
  approverRole: z.enum(['owner', 'editor']).nullable(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
});
const revisionHistoryResponseSchema = z.object({ revisions: z.array(revisionHistoryItemSchema) });

type MutationMethod = 'DELETE' | 'POST' | 'PUT';
type JsonMutationMethod = Exclude<MutationMethod, 'DELETE'>;

type AdminApiOptions = {
  readonly fetcher?: typeof fetch;
  readonly onUnauthorized?: () => void;
};

export type UploadedMedia = z.infer<typeof mediaSchema>;
export type SessionState = {
  readonly authenticated: boolean;
  readonly expiresAt?: string;
  readonly role?: 'owner' | 'editor';
  readonly email?: string;
  readonly adminUserId?: number;
};
export type AdminUser = z.infer<typeof adminUserSchema>;
export type PendingProposal = z.infer<typeof pendingProposalSchema>;
export type RevisionHistoryItem = z.infer<typeof revisionHistoryItemSchema>;

export type SaveProjectResult = {
  readonly project: Project;
  readonly revision?: unknown;
  readonly isProposal?: boolean;
};

export type SaveHomeHeroResult = {
  readonly videos: HomeHeroVideo[];
  readonly currentRevisionId?: string | null;
  readonly revision?: unknown;
  readonly isProposal?: boolean;
};

export type SaveSiteSettingsResult = {
  readonly settings: SiteSettings;
  readonly currentRevisionId?: string | null;
  readonly revision?: unknown;
  readonly isProposal?: boolean;
};

export class AdminApiError extends Error {
  readonly name = 'AdminApiError';

  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export class AdminApi {
  readonly #fetcher: typeof fetch;
  readonly #onUnauthorized?: () => void;
  #csrfToken: string | null = null;

  constructor({ fetcher = fetch, onUnauthorized }: AdminApiOptions = {}) {
    this.#fetcher = (input, init) => fetcher(input, init);
    this.#onUnauthorized = onUnauthorized;
  }

  async session(): Promise<SessionState> {
    const response = await this.#fetcher('/api/auth/session', { credentials: 'same-origin' });
    if (response.status === 401) return { authenticated: false };
    const session = await this.#response(response, sessionSchema);
    return {
      authenticated: session.authenticated,
      expiresAt: session.expiresAt,
      role: session.role,
      email: session.email,
      adminUserId: session.adminUserId,
    };
  }

  async login(email: string, password: string): Promise<SessionState> {
    const response = await this.#fetcher('/api/auth/login', this.#jsonRequest('POST', { email, password }));
    const session = await this.#response(response, loginSchema);
    this.#csrfToken = session.csrfToken;
    return {
      authenticated: true,
      expiresAt: session.expiresAt,
      role: session.role,
      email: session.email,
      adminUserId: session.adminUserId,
    };
  }

  async bootstrapCsrf(): Promise<void> {
    const response = await this.#fetcher('/api/auth/csrf', { credentials: 'same-origin', method: 'POST' });
    const result = await this.#response(response, csrfSchema);
    this.#csrfToken = result.csrfToken;
  }

  async logout(): Promise<void> {
    await this.#empty('/api/auth/logout', 'POST');
    this.#csrfToken = null;
  }

  // Users Management
  async listUsers(): Promise<AdminUser[]> {
    const response = await this.#fetcher('/api/admin/users', { credentials: 'same-origin' });
    return (await this.#response(response, usersListSchema)).users;
  }

  async createUser(email: string, password: string): Promise<AdminUser> {
    const response = await this.#fetcher('/api/admin/users', this.#mutationJson('POST', { email, password }));
    return (await this.#response(response, userResponseSchema)).user;
  }

  async rotateUser(adminId: number, options: { email?: string; password?: string }): Promise<void> {
    await this.#empty(`/api/admin/users/${adminId}`, 'PUT', options);
  }

  async deactivateUser(adminId: number): Promise<void> {
    await this.#empty(`/api/admin/users/${adminId}`, 'DELETE');
  }

  async revokeUserSessions(adminId: number): Promise<void> {
    await this.#empty(`/api/admin/users/${adminId}/revoke`, 'POST', {});
  }

  // Proposals & Revisions
  async listPendingProposals(): Promise<PendingProposal[]> {
    const response = await this.#fetcher('/api/admin/revisions?status=pending', { credentials: 'same-origin' });
    return (await this.#response(response, proposalsResponseSchema)).proposals;
  }

  async approveProposal(revisionId: string, expectedCurrentRevisionId: string | null): Promise<void> {
    await this.#empty(`/api/admin/revisions/${encodeURIComponent(revisionId)}/approve`, 'POST', {
      expectedCurrentRevisionId,
    });
  }

  async rejectProposal(revisionId: string, expectedCurrentRevisionId: string | null): Promise<void> {
    await this.#empty(`/api/admin/revisions/${encodeURIComponent(revisionId)}/reject`, 'POST', {
      expectedCurrentRevisionId,
    });
  }

  async getRevisionHistory(aggregateType: string, aggregateId: string): Promise<RevisionHistoryItem[]> {
    const query = new URLSearchParams({ aggregateType, aggregateId }).toString();
    const response = await this.#fetcher(`/api/admin/revisions?${query}`, { credentials: 'same-origin' });
    return (await this.#response(response, revisionHistoryResponseSchema)).revisions;
  }

  async rollbackRevision(targetRevisionId: string, expectedCurrentRevisionId: string): Promise<void> {
    await this.#empty('/api/admin/revisions/rollback', 'POST', {
      targetRevisionId,
      expectedCurrentRevisionId,
    });
  }

  // Projects
  async listProjects(): Promise<Project[]> {
    const response = await this.#fetcher('/api/admin/projects', { credentials: 'same-origin' });
    return (await this.#response(response, projectsSchema)).projects;
  }

  async saveProject(
    project: Project,
    options?: { expectedRevisionId?: string | null; mediaFileIds?: string[] },
  ): Promise<SaveProjectResult> {
    const payload = {
      project,
      expectedRevisionId: options?.expectedRevisionId ?? null,
      mediaFileIds: options?.mediaFileIds ?? [],
    };
    const response = await this.#fetcher('/api/admin/projects', this.#mutationJson('POST', payload));
    const data = await this.#response(response, projectResponseSchema);
    return {
      project: data.project,
      revision: data.revision,
      isProposal: data.isProposal,
    };
  }

  async reorderProjects(items: readonly { readonly id: string; readonly sortOrder: number }[]): Promise<void> {
    await this.#empty('/api/admin/projects/reorder', 'POST', { items });
  }

  async deleteProject(projectId: string, expectedCurrentRevisionId?: string): Promise<void> {
    const headers = this.#mutationHeaders();
    const request: RequestInit = {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...headers },
      method: 'DELETE',
      body: JSON.stringify({ expectedCurrentRevisionId: expectedCurrentRevisionId ?? '00000000-0000-0000-0000-000000000000' }),
    };
    const response = await this.#fetcher(`/api/admin/projects/${encodeURIComponent(projectId)}`, request);
    if (!response.ok) await this.#response(response, z.never());
  }

  // Home Hero Videos
  async listHomeHeroVideos(): Promise<{ videos: HomeHeroVideo[]; currentRevisionId: string | null }> {
    const response = await this.#fetcher('/api/admin/home-hero', { credentials: 'same-origin' });
    const data = await this.#response(response, homeHeroResponseSchema);
    return {
      videos: data.videos,
      currentRevisionId: data.currentRevisionId ?? null,
    };
  }

  async saveHomeHeroVideos(
    videos: readonly HomeHeroVideo[],
    options?: { expectedRevisionId?: string | null; mediaFileIds?: string[] },
  ): Promise<SaveHomeHeroResult> {
    const payload = {
      videos,
      expectedRevisionId: options?.expectedRevisionId,
      mediaFileIds: options?.mediaFileIds,
    };
    const response = await this.#fetcher('/api/admin/home-hero', this.#mutationJson('PUT', payload));
    const data = await this.#response(response, homeHeroResponseSchema);
    return {
      videos: data.videos,
      currentRevisionId: data.currentRevisionId ?? null,
      revision: data.revision,
      isProposal: data.isProposal,
    };
  }

  // Site Settings
  async getSiteSettings(): Promise<{ settings: SiteSettings; currentRevisionId: string | null }> {
    const response = await this.#fetcher('/api/admin/site-settings', { credentials: 'same-origin' });
    const data = await this.#response(response, settingsResponseSchema);
    return {
      settings: data.settings,
      currentRevisionId: data.currentRevisionId ?? null,
    };
  }

  async saveSiteSettings(
    settings: SiteSettings,
    options?: { expectedRevisionId?: string | null; mediaFileIds?: string[] },
  ): Promise<SaveSiteSettingsResult> {
    const payload = {
      ...settings,
      expectedRevisionId: options?.expectedRevisionId,
      mediaFileIds: options?.mediaFileIds,
    };
    const response = await this.#fetcher('/api/admin/site-settings', this.#mutationJson('PUT', payload));
    const data = await this.#response(response, settingsResponseSchema);
    return {
      settings: data.settings,
      currentRevisionId: data.currentRevisionId ?? null,
      revision: data.revision,
      isProposal: data.isProposal,
    };
  }

  // Media
  async uploadMedia(file: File): Promise<UploadedMedia> {
    const form = new FormData();
    form.set('file', file);
    const response = await this.#fetcher('/api/admin/media', {
      body: form,
      credentials: 'same-origin',
      headers: this.#mutationHeaders(),
      method: 'POST',
    });
    return (await this.#response(response, mediaResponseSchema)).media;
  }

  async #empty(path: string, method: MutationMethod, body?: unknown): Promise<void> {
    const request: RequestInit = method === 'DELETE'
      ? { credentials: 'same-origin', headers: this.#mutationHeaders(), method }
      : body === undefined
        ? { credentials: 'same-origin', headers: this.#mutationHeaders(), method }
        : this.#mutationJson(method, body);
    const response = await this.#fetcher(path, request);
    if (!response.ok) await this.#response(response, z.never());
  }

  #jsonRequest(method: JsonMutationMethod, body: unknown): RequestInit {
    return {
      body: JSON.stringify(body),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      method,
    };
  }

  #mutationJson(method: JsonMutationMethod, body: unknown): RequestInit {
    return {
      ...this.#jsonRequest(method, body),
      headers: { 'Content-Type': 'application/json', ...this.#mutationHeaders() },
    };
  }

  #mutationHeaders(): HeadersInit {
    if (!this.#csrfToken) throw new AdminApiError(403, 'csrf_missing', 'Your session needs to be refreshed');
    return { 'X-CSRF-Token': this.#csrfToken };
  }

  async #response<Schema extends z.ZodType>(response: Response, schema: Schema): Promise<z.output<Schema>> {
    if (!response.ok) {
      const parsed = errorSchema.safeParse(await response.json().catch(() => null));
      const error = new AdminApiError(response.status, parsed.data?.error.code ?? 'request_failed', parsed.data?.error.message ?? 'Unable to complete the request');
      if (response.status === 401) this.#onUnauthorized?.();
      throw error;
    }
    return schema.parse(await response.json());
  }
}
