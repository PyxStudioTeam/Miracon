import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Eye,
  FileText,
  Film,
  GripVertical,
  History,
  ImagePlus,
  Inbox,
  KeyRound,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Plus,
  RotateCcw,
  Save,
  Search,
  Smartphone,
  Trash2,
  Upload,
  Users,
  UserX,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode, type SyntheticEvent } from 'react';
import { AdminApi, type AdminUser, type PendingProposal, type RevisionHistoryItem, type SessionState } from './admin-api';
import { isValidRemainingUnits, parseRemainingUnitsInput } from './remaining-units';
import { seedProjects } from '../data/projects';
import {
  optimizePhotoForDirectUpload,
} from '../lib/admin-media';
import { type HomeHeroVideo } from '../lib/home-hero';
import { normalizeMediaUrl } from '../lib/media';
import {
  PROJECT_CATEGORIES,
  categoryLabels,
  type Project,
  type ProjectCategory,
  type ProjectImage,
  type ProjectLocaleTranslation,
} from '../lib/project-types';
import {
  defaultSiteSettings,
  isValidTermsPdfUrl,
  type SiteSettings,
} from '../lib/site-settings-shared';

type AdminSection = 'content' | 'specs' | 'media' | 'plans' | 'seo';
type AdminView = 'projects' | 'home-hero' | 'site-settings' | 'proposals' | 'users';
type Toast = { tone: 'success' | 'error'; message: string } | null;

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const benefitIconAccept = 'image/svg+xml,image/jpeg,image/png,image/webp,image/avif,.svg,.jpg,.jpeg,.png,.webp,.avif';

function normalizedSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function getPublishRequirements(project: Project) {
  const heroMediaComplete = project.heroType === 'image'
    ? Boolean(project.heroUrl)
    : project.heroVideos.length > 0 && project.heroVideos.every((video) => Boolean(video.desktopUrl));
  const requirements = [
    { label: 'Project name', complete: Boolean(project.title.trim()), section: 'content' as AdminSection },
    { label: 'Valid public URL', complete: slugPattern.test(normalizedSlug(project.slug)), section: 'seo' as AdminSection },
    { label: 'Address', complete: Boolean(project.address.trim()), section: 'content' as AdminSection },
    { label: 'Price', complete: Boolean(project.price.trim()), section: 'content' as AdminSection },
    { label: 'Category', complete: project.categories.length > 0, section: 'content' as AdminSection },
    { label: 'Card description', complete: Boolean(project.shortDescription.trim()), section: 'content' as AdminSection },
    { label: 'Full description', complete: Boolean(project.fullDescription.trim()), section: 'content' as AdminSection },
    { label: 'Catalog cover', complete: Boolean(project.coverUrl), section: 'media' as AdminSection },
    { label: 'Page hero', complete: heroMediaComplete, section: 'media' as AdminSection },
    { label: 'Intro image', complete: Boolean(project.introImageUrl), section: 'media' as AdminSection },
    { label: 'Video poster', complete: project.heroType !== 'video' || Boolean(project.heroVideos[0]?.posterUrl), section: 'media' as AdminSection },
  ];
  if (project.walkthroughVideoEnabled) {
    requirements.push({ label: 'Walkthrough video', complete: project.walkthroughVideos.length > 0 && project.walkthroughVideos.every((video) => Boolean(video.desktopUrl)), section: 'media' });
  }
  return requirements;
}

function projectReadiness(project: Project) {
  const requirements = getPublishRequirements(project);
  return Math.round((requirements.filter((item) => item.complete).length / requirements.length) * 100);
}

function pauseOtherAdminVideos(event: SyntheticEvent<HTMLVideoElement>) {
  document.querySelectorAll<HTMLVideoElement>('.admin-app video').forEach((video) => {
    if (video !== event.currentTarget) video.pause();
  });
}

function syncLegacyVideoFields(project: Project): Project {
  const firstHero = project.heroVideos[0];
  const firstWalkthrough = project.walkthroughVideos[0];
  return {
    ...project,
    heroVariant: project.heroType === 'video' ? 'immersive' : project.heroVariant,
    heroIdleUi: project.heroType === 'video',
    ...(project.heroType === 'video' ? {
      heroUrl: firstHero?.desktopUrl ?? '',
      heroMobileUrl: firstHero?.mobileUrl ?? null,
      heroPosterUrl: firstHero?.posterUrl ?? null,
    } : {}),
    walkthroughVideoDesktopUrl: firstWalkthrough?.desktopUrl ?? '',
    walkthroughVideoMobileUrl: firstWalkthrough?.mobileUrl ?? null,
    walkthroughVideoPosterUrl: firstWalkthrough?.posterUrl ?? null,
  };
}

const emptyProject = (sortOrder: number): Project => ({
  id: crypto.randomUUID(),
  slug: 'new-project',
  title: 'New project',
  address: '',
  price: '',
  remainingUnits: null,
  shortDescription: '',
  fullDescription: '',
  introTitle: 'A New Place to Live',
  categories: [],
  status: 'draft',
  sortOrder,
  coverUrl: '',
  coverFocalX: 50,
  coverFocalY: 50,
  heroType: 'image',
  heroVariant: 'standard',
  heroSoundEnabled: false,
  heroIdleUi: false,
  heroUrl: '',
  heroMobileUrl: null,
  heroPosterUrl: null,
  heroVideos: [],
  walkthroughVideoEnabled: false,
  walkthroughVideoTitle: 'Virtual walkthrough',
  walkthroughVideoDesktopUrl: '',
  walkthroughVideoMobileUrl: null,
  walkthroughVideoPosterUrl: null,
  walkthroughVideos: [],
  heroFocalX: 50,
  heroFocalY: 50,
  introImageUrl: '',
  brochureUrl: null,
  mapQuery: '',
  mapUrl: '',
  cardAddress: '',
  cardImages: [],
  gallery: [],
  imageVariants: { version: 1, images: {} },
  characteristics: [
    { id: crypto.randomUUID(), label: 'Bedrooms', value: '', icon: 'bed' },
    { id: crypto.randomUUID(), label: 'Bathrooms', value: '', icon: 'bath' },
    { id: crypto.randomUUID(), label: 'Area', value: '', icon: 'area' },
    { id: crypto.randomUUID(), label: 'Levels', value: '', icon: 'levels' },
  ],
  benefits: [],
  floorPlanGroups: [],
  nearbyPlaces: [],
  seoTitle: '',
  seoDescription: '',
  translations: {},
  updatedAt: new Date().toISOString(),
});

function emptyHomeHeroVideo(sortOrder: number): HomeHeroVideo {
  return {
    id: crypto.randomUUID(),
    title: `Hero video ${sortOrder + 1}`,
    projectId: null,
    desktopUrl: '',
    desktopStoragePath: null,
    mobileUrl: null,
    mobileStoragePath: null,
    sortOrder,
    isActive: false,
  };
}

function pruneImageVariants(project: Project): Project {
  const referenced = new Set([
    project.coverUrl,
    project.heroType === 'image' ? project.heroUrl : '',
    project.heroPosterUrl ?? '',
    project.walkthroughVideoPosterUrl ?? '',
    ...project.heroVideos.map((video) => video.posterUrl ?? ''),
    ...project.walkthroughVideos.map((video) => video.posterUrl ?? ''),
    project.introImageUrl,
    ...project.cardImages.map((image) => image.url),
    ...project.gallery.map((image) => image.url),
    ...project.floorPlanGroups.flatMap((group) => group.plans.map((plan) => plan.imageUrl)),
  ].filter(Boolean).map(normalizeMediaUrl));
  const currentImages = project.imageVariants?.images ?? {};
  return {
    ...project,
    imageVariants: {
      version: 1,
      images: Object.fromEntries(Object.entries(currentImages).filter(([url]) => referenced.has(normalizeMediaUrl(url)))),
    },
  };
}

function pruneTranslations(project: Project): Project {
  const translation = project.translations?.el;
  if (!translation) return project;

  const characteristicIds = new Set(project.characteristics.map((item) => item.id));
  const benefitIds = new Set(project.benefits.map((item) => item.id));
  const imageIds = new Set([...project.cardImages, ...project.gallery].map((item) => item.id));
  const floorPlanGroups = Object.fromEntries(project.floorPlanGroups.flatMap((group) => {
    const translatedGroup = translation.floorPlanGroups?.[group.id];
    if (!translatedGroup) return [];
    const planIds = new Set(group.plans.map((plan) => plan.id));
    return [[group.id, {
      ...translatedGroup,
      plans: Object.fromEntries(Object.entries(translatedGroup.plans ?? {}).filter(([id]) => planIds.has(id))),
    }]];
  }));

  return {
    ...project,
    translations: {
      ...project.translations,
      el: {
        ...translation,
        characteristics: Object.fromEntries(Object.entries(translation.characteristics ?? {}).filter(([id]) => characteristicIds.has(id))),
        benefits: Object.fromEntries(Object.entries(translation.benefits ?? {}).filter(([id]) => benefitIds.has(id))),
        floorPlanGroups,
        imageAlts: Object.fromEntries(Object.entries(translation.imageAlts ?? {}).filter(([id]) => imageIds.has(id))),
      },
    },
  };
}

function BrandMark() {
  return <div className="admin-brand-mark"><img src="/img/logo_mark.svg" alt="MIRACON" /></div>;
}

function BrandLockup() {
  return (
    <div className="admin-brand-lockup">
      <BrandMark />
      <div><strong>MIRACON</strong><span>DESK</span></div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="admin-loading">
      <BrandMark />
      <LoaderCircle className="spin" size={24} />
      <span>Loading administration desk...</span>
    </div>
  );
}

function LoginScreen({ onLogin, error, loading }: { onLogin: (email: string, password: string) => Promise<void>; error: string; loading: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="admin-login">
      <div className="login-visual">
        <BrandLockup />
        <div>
          <span className="login-index">01 / ADMINISTRATION</span>
          <h2>A Place<br /><em>of Your Own</em></h2>
          <p>Sign in to manage projects, available units, hero videos, site legal documents, and revision governance.</p>
        </div>
        <span className="rail-env">SECURE GOVERNANCE WORKSPACE</span>
      </div>
      <div className="login-panel">
        <form onSubmit={(e) => { e.preventDefault(); onLogin(email, password); }}>
          <header>
            <span className="eyebrow">Sign in</span>
            <h1>Administration</h1>
            <p>Use your authorized owner or editor credentials.</p>
          </header>
          {error && <div className="login-error" role="alert"><CircleAlert size={17} />{error}</div>}
          <label><span>Administrator email</span><input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label><span>Password</span><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="primary-button" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Sign in</button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`editor-field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function collectProjectMediaUrls(project: Project): string[] {
  const urls = new Set<string>();
  const add = (val: unknown) => {
    if (typeof val === 'string' && val.trim()) urls.add(val.trim());
  };

  add(project.coverUrl);
  add(project.heroUrl);
  add(project.heroMobileUrl);
  add(project.heroPosterUrl);
  add(project.walkthroughVideoDesktopUrl);
  add(project.walkthroughVideoMobileUrl);
  add(project.walkthroughVideoPosterUrl);
  add(project.introImageUrl);
  add(project.brochureUrl);

  for (const v of project.heroVideos ?? []) {
    add(v.desktopUrl);
    add(v.mobileUrl);
    add(v.posterUrl);
  }
  for (const v of project.walkthroughVideos ?? []) {
    add(v.desktopUrl);
    add(v.mobileUrl);
    add(v.posterUrl);
  }
  for (const img of project.cardImages ?? []) {
    add(img.url);
    add(img.storagePath);
  }
  for (const img of project.gallery ?? []) {
    add(img.url);
    add(img.storagePath);
  }
  for (const b of project.benefits ?? []) {
    add(b.icon);
  }
  for (const g of project.floorPlanGroups ?? []) {
    for (const p of g.plans ?? []) {
      add(p.imageUrl);
    }
  }
  if (project.imageVariants?.images) {
    for (const set of Object.values(project.imageVariants.images)) {
      for (const c of set.avif ?? []) add(c.src);
      for (const c of set.webp ?? []) add(c.src);
    }
  }

  return Array.from(urls);
}

function SortableProjectRow({
  project,
  onOpen,
  canReorder = true,
}: {
  project: Project;
  onOpen: (project: Project) => void;
  canReorder?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
    disabled: !canReorder,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <article ref={setNodeRef} style={style} className="project-row">
      {canReorder && (
        <button className="drag-handle" {...attributes} {...listeners} title="Drag to reorder"><GripVertical size={16} /></button>
      )}
      <div className="project-row-main" onClick={() => onOpen(project)}>
        {project.coverUrl ? <img src={project.coverUrl} alt={project.title} /> : <div className="project-row-cover-placeholder"><ImagePlus size={20} /></div>}
        <div className="project-row-copy">
          <strong>{project.title}</strong>
          <span>{project.address || 'Address not set'}</span>
          {project.remainingUnits !== null && (
            <span style={{ fontSize: '11px', color: 'var(--admin-gold)', marginLeft: '8px' }}>
              ({project.remainingUnits === 0 ? 'Sold out' : `${project.remainingUnits} units left`})
            </span>
          )}
        </div>
        <div className="project-row-tags">
          {project.categories.map((c) => <i key={c}>{categoryLabels[c]}</i>)}
        </div>
        <span className={`status-pill ${project.status}`}>{project.status}</span>
        <ChevronRight size={18} />
      </div>
    </article>
  );
}

function ProjectList({
  projects,
  onOpen,
  onCreate,
  onReorder,
  onImport,
  canImport,
  canReorder = true,
}: {
  projects: Project[];
  onOpen: (project: Project) => void;
  onCreate: () => void;
  onReorder: (event: DragEndEvent) => void;
  onImport: () => void;
  canImport: boolean;
  canReorder?: boolean;
}) {
  const [query, setQuery] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return projects;
    return projects.filter((p) => p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q) || p.address.toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <main className="admin-main">
      <header className="list-header">
        <div>
          <span className="eyebrow">Miracon portfolio</span>
          <h1>Projects <sup>{projects.length.toString().padStart(2, '0')}</sup></h1>
          <p>Organize, edit and publish real estate developments</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canImport && <button className="secondary-button" onClick={onImport}><Download size={16} />Import defaults</button>}
          <button className="primary-button" onClick={onCreate}><Plus size={18} />Create project</button>
        </div>
      </header>
      <div className="list-search">
        <Search size={18} className="list-search-icon" />
        <input
          type="text"
          placeholder="Search projects by name, address or slug..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="list-search-clear"
            onClick={() => setQuery('')}
            aria-label="Clear search"
          >
            <X size={15} />
          </button>
        )}
      </div>
      {filtered.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
          <SortableContext items={filtered.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <div className="project-rows">
              {filtered.map((p) => <SortableProjectRow key={p.id} project={p} onOpen={onOpen} canReorder={canReorder} />)}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="empty-projects">
          <ImagePlus size={36} />
          <h3>No projects found</h3>
          <p>{query ? 'No projects match your search query' : 'Create your first project to get started'}</p>
        </div>
      )}
    </main>
  );
}

function Download({ size = 16 }: { size?: number }) {
  return <Upload size={size} style={{ transform: 'rotate(180deg)' }} />;
}

function SortableHomeHeroVideo({
  video,
  index,
  projects,
  uploading,
  onChange,
  onRemove,
  onUpload,
}: {
  video: HomeHeroVideo;
  index: number;
  projects: Project[];
  uploading: string;
  onChange: (patch: Partial<HomeHeroVideo>) => void;
  onRemove: () => void;
  onUpload: (kind: 'desktop' | 'mobile', event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: video.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <article ref={setNodeRef} style={style} className="home-hero-card">
      <header className="home-hero-card-header">
        <div className="home-hero-ordering">
          <button className="drag-handle" type="button" {...attributes} {...listeners} aria-label={`Reorder hero video ${index + 1}`} title="Drag to reorder"><GripVertical size={16} /></button>
          <span className="home-hero-index" aria-label={`Playlist position ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
        </div>
        <div className="home-hero-identity">
          <label className="home-hero-title-field">
            <span>Video title</span>
            <input value={video.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Video title" />
          </label>
          <label className="home-hero-toggle">
            <input type="checkbox" checked={video.isActive} onChange={(e) => onChange({ isActive: e.target.checked })} />
            <span></span>{video.isActive ? 'Active' : 'Inactive'}
          </label>
        </div>
        <button className="danger-button home-hero-remove" type="button" onClick={onRemove} aria-label={`Remove hero video ${index + 1}`}><Trash2 size={16} /><span>Remove</span></button>
      </header>
      <div className="home-hero-card-body">
        <section className="home-hero-preview" aria-label="Visual preview">
          {video.desktopUrl ? <video src={video.desktopUrl} muted playsInline onPlay={pauseOtherAdminVideos} controls /> : <div className="home-hero-video-placeholder"><Film size={24} /><span>Upload desktop video</span></div>}
        </section>
        <div className="home-hero-fields">
          <label className="home-hero-project-field">
            <span>Linked project</span>
            <select value={video.projectId ?? ''} onChange={(e) => onChange({ projectId: e.target.value || null })}>
              <option value="">None (Homepage only)</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <section className="home-hero-assets" aria-label="Video uploads">
            <div>
              <Upload size={18} />
              <span><strong>Desktop video</strong><small>Required for active slides</small></span>
              <label>
                <input type="file" accept="video/mp4" aria-label="Upload desktop MP4" onChange={(e) => onUpload('desktop', e)} />
                {uploading === `${video.id}:desktop` ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}
                {video.desktopUrl ? 'Replace MP4' : 'Upload MP4'}
              </label>
            </div>
            <div>
              <Smartphone size={18} />
              <span><strong>Mobile video (optional)</strong><small>Used on narrow screens when supplied</small></span>
              <label>
                <input type="file" accept="video/mp4" aria-label="Upload mobile MP4" onChange={(e) => onUpload('mobile', e)} />
                {uploading === `${video.id}:mobile` ? <LoaderCircle className="spin" size={15} /> : <Smartphone size={15} />}
                {video.mobileUrl ? 'Replace MP4' : 'Upload MP4'}
              </label>
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}

function HomeHeroManager({
  initialVideos,
  projects,
  api,
  onSaved,
  onToast,
  role,
  currentRevisionId,
}: {
  initialVideos: HomeHeroVideo[];
  projects: Project[];
  api: AdminApi;
  onSaved: (videos: HomeHeroVideo[], currentRevisionId?: string | null) => void;
  onToast: (toast: Toast) => void;
  role: 'owner' | 'editor';
  currentRevisionId?: string | null;
}) {
  const [videos, setVideos] = useState<HomeHeroVideo[]>(() => structuredClone(initialVideos));
  const [savedVideos, setSavedVideos] = useState<HomeHeroVideo[]>(() => structuredClone(initialVideos));
  const [revisionId, setRevisionId] = useState<string | null>(() => currentRevisionId ?? null);
  const [uploading, setUploading] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const isDirty = JSON.stringify(videos) !== JSON.stringify(savedVideos);

  useEffect(() => {
    setVideos(structuredClone(initialVideos));
    setSavedVideos(structuredClone(initialVideos));
  }, [initialVideos]);

  useEffect(() => {
    setRevisionId(currentRevisionId ?? null);
  }, [currentRevisionId]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDirty]);

  function updateVideo(id: string, patch: Partial<HomeHeroVideo>) {
    setVideos((current) => current.map((v) => v.id === id ? { ...v, ...patch } : v));
  }

  function reorderVideos(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    setVideos((current) => {
      const oldIndex = current.findIndex((v) => v.id === event.active.id);
      const newIndex = current.findIndex((v) => v.id === event.over?.id);
      return arrayMove(current, oldIndex, newIndex).map((v, i) => ({ ...v, sortOrder: i }));
    });
  }

  async function uploadVideo(id: string, kind: 'desktop' | 'mobile', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.type !== 'video/mp4') {
      onToast({ tone: 'error', message: 'Only MP4 videos are supported' });
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      onToast({ tone: 'error', message: 'Video must be smaller than 50 MB' });
      return;
    }

    const uploadKey = `${id}:${kind}`;
    setUploading(uploadKey);
    try {
      const media = await api.uploadMedia(file);
      updateVideo(id, kind === 'desktop'
        ? { desktopUrl: media.relativeUrl, desktopStoragePath: media.relativePath }
        : { mobileUrl: media.relativeUrl, mobileStoragePath: media.relativePath });
      onToast({ tone: 'success', message: `${kind === 'desktop' ? 'Desktop' : 'Mobile'} video uploaded` });
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to upload video' });
    } finally {
      setUploading('');
    }
  }

  async function savePlaylist() {
    const normalized = videos.map((v, i) => ({ ...v, sortOrder: i }));
    const invalidActive = normalized.find((v) => v.isActive && !v.desktopUrl);
    if (invalidActive) {
      onToast({ tone: 'error', message: `Upload a desktop video for “${invalidActive.title}” before activating it` });
      return;
    }

    setSaving(true);
    try {
      const result = await api.saveHomeHeroVideos(normalized, { expectedRevisionId: revisionId });
      if (result.currentRevisionId !== undefined) {
        setRevisionId(result.currentRevisionId);
      }
      setVideos(normalized);
      setSavedVideos(structuredClone(normalized));
      onSaved(normalized, result.currentRevisionId);
      onToast({
        tone: 'success',
        message: result.isProposal ? 'Playlist proposal submitted for owner review' : 'Homepage video playlist saved',
      });
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to save homepage videos' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="admin-main home-hero-manager">
      <header className="list-header">
        <div>
          <span className="eyebrow">Homepage / Hero playlist</span>
          <h1>Hero videos <sup>{videos.length.toString().padStart(2, '0')}</sup></h1>
          <p>Videos play in sequence from top to bottom and loop continuously</p>
        </div>
        <div className="home-hero-actions" style={{ display: 'flex', gap: '8px' }}>
          <button className="secondary-button" onClick={() => setHistoryOpen(true)} title="View revision history"><History size={17} />History</button>
          <button className="secondary-button" onClick={() => setVideos((current) => [...current, emptyHomeHeroVideo(current.length)])}><Plus size={18} />Add video</button>
          <button className="primary-button" onClick={savePlaylist} disabled={saving || !isDirty}>
            {saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
            {role === 'owner' ? 'Save playlist' : 'Submit proposal'}
          </button>
        </div>
      </header>

      <section className="home-hero-help">
        <Film size={22} />
        <div>
          <strong>Playback rules</strong>
          <p>Desktop video is required. Mobile is optional and automatically displayed on narrow screens.</p>
        </div>
      </section>

      {videos.length ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorderVideos}>
          <SortableContext items={videos.map((v) => v.id)} strategy={verticalListSortingStrategy}>
            <section className="home-hero-list">
              {videos.map((v, i) => (
                <SortableHomeHeroVideo
                  key={v.id}
                  video={v}
                  index={i}
                  projects={projects}
                  uploading={uploading}
                  onChange={(patch) => updateVideo(v.id, patch)}
                  onRemove={() => setVideos((current) => current.filter((item) => item.id !== v.id).map((item, idx) => ({ ...item, sortOrder: idx })))}
                  onUpload={(kind, event) => uploadVideo(v.id, kind, event)}
                />
              ))}
            </section>
          </SortableContext>
        </DndContext>
      ) : (
        <section className="home-hero-empty">
          <Film size={30} />
          <h2>No hero videos</h2>
          <p>Add a video to configure the homepage playlist.</p>
          <button className="primary-button" onClick={() => setVideos([emptyHomeHeroVideo(0)])}><Plus size={18} />Add first video</button>
        </section>
      )}

      {historyOpen && (
        <RevisionHistoryDrawer
          isOpen={historyOpen}
          onClose={() => setHistoryOpen(false)}
          aggregateType="homepage_hero"
          aggregateId="singleton"
          title="Homepage Hero Playlist"
          role={role}
          api={api}
          currentRevisionId={revisionId ?? null}
          onRollbackSuccess={async () => {
            const data = await api.listHomeHeroVideos();
            setRevisionId(data.currentRevisionId);
            setVideos(data.videos);
            setSavedVideos(structuredClone(data.videos));
            onSaved(data.videos, data.currentRevisionId);
          }}
          onToast={onToast}
        />
      )}
    </main>
  );
}

type LegalVisibilityKey = 'footerTermsVisible' | 'footerPrivacyVisible' | 'footerCookieVisible';
type LegalUrlKey = 'footerTermsPdfUrl' | 'footerPrivacyPdfUrl' | 'footerCookiePdfUrl';

const legalDocumentFields: Array<{
  label: string;
  description: string;
  storageDirectory: string;
  visibilityKey: LegalVisibilityKey;
  urlKey: LegalUrlKey;
}> = [
  { label: 'Terms of Use', description: 'User agreement PDF in the website footer', storageDirectory: 'terms-of-use', visibilityKey: 'footerTermsVisible', urlKey: 'footerTermsPdfUrl' },
  { label: 'Privacy Policy', description: 'Privacy policy PDF in the website footer', storageDirectory: 'privacy-policy', visibilityKey: 'footerPrivacyVisible', urlKey: 'footerPrivacyPdfUrl' },
  { label: 'Cookie Policy', description: 'Cookie policy PDF in the website footer', storageDirectory: 'cookie-policy', visibilityKey: 'footerCookieVisible', urlKey: 'footerCookiePdfUrl' },
];

function SiteSettingsManager({
  initialSettings,
  api,
  onSaved,
  onToast,
  role,
  currentRevisionId,
}: {
  initialSettings: SiteSettings;
  api: AdminApi;
  onSaved: (settings: SiteSettings, currentRevisionId?: string | null) => void;
  onToast: (toast: Toast) => void;
  role: 'owner' | 'editor';
  currentRevisionId?: string | null;
}) {
  const [settings, setSettings] = useState<SiteSettings>(() => ({ ...initialSettings }));
  const [savedSettings, setSavedSettings] = useState<SiteSettings>(() => ({ ...initialSettings }));
  const [revisionId, setRevisionId] = useState<string | null>(() => currentRevisionId ?? null);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState<LegalUrlKey | null>(null);

  useEffect(() => {
    setSettings({ ...initialSettings });
    setSavedSettings({ ...initialSettings });
  }, [initialSettings]);

  useEffect(() => {
    setRevisionId(currentRevisionId ?? null);
  }, [currentRevisionId]);

  const documents = legalDocumentFields.map((document) => {
    const normalizedUrl = settings[document.urlKey].trim();
    const validUrl = isValidTermsPdfUrl(normalizedUrl);
    const visible = settings[document.visibilityKey];
    return {
      ...document,
      normalizedUrl,
      validUrl,
      visible,
      invalid: (Boolean(normalizedUrl) && !validUrl) || (visible && !validUrl),
    };
  });
  const hasInvalidDocument = documents.some((document) => document.invalid);
  const isDirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);

  async function uploadLegalDocument(document: typeof documents[number], event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      onToast({ tone: 'error', message: 'Legal documents must be PDF files' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      onToast({ tone: 'error', message: 'PDF document must be smaller than 25 MB' });
      return;
    }

    setUploadingDocument(document.urlKey);
    try {
      const media = await api.uploadMedia(file);
      setSettings((current) => ({ ...current, [document.urlKey]: media.relativeUrl }));
      onToast({ tone: 'success', message: `${document.label} PDF uploaded. Save settings to apply.` });
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to upload PDF document' });
    } finally {
      setUploadingDocument(null);
    }
  }

  async function saveSettings() {
    if (hasInvalidDocument) {
      onToast({ tone: 'error', message: 'Upload a PDF before enabling a legal document link' });
      return;
    }

    setSaving(true);
    try {
      const nextSettings: SiteSettings = {
        ...settings,
        footerTermsPdfUrl: settings.footerTermsPdfUrl.trim(),
        footerPrivacyPdfUrl: settings.footerPrivacyPdfUrl.trim(),
        footerCookiePdfUrl: settings.footerCookiePdfUrl.trim(),
      };
      const result = await api.saveSiteSettings(nextSettings, { expectedRevisionId: revisionId });
      if (result.currentRevisionId !== undefined) {
        setRevisionId(result.currentRevisionId);
      }
      setSettings(result.settings);
      setSavedSettings({ ...result.settings });
      onSaved(result.settings, result.currentRevisionId);
      onToast({
        tone: 'success',
        message: result.isProposal ? 'Site settings proposal submitted for owner review' : 'Site settings saved',
      });
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to save site settings' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="admin-main site-settings-manager">
      <header className="list-header">
        <div>
          <span className="eyebrow">Website / Legal documents</span>
          <h1>Site settings</h1>
          <p>Control legal PDFs displayed in the public footer</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="secondary-button" onClick={() => setHistoryOpen(true)} title="View revision history"><History size={17} />History</button>
          <button className="primary-button" onClick={saveSettings} disabled={saving || Boolean(uploadingDocument) || !isDirty || hasInvalidDocument}>
            {saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
            {role === 'owner' ? 'Save settings' : 'Submit proposal'}
          </button>
        </div>
      </header>

      <div className="site-settings-list">
        {documents.map((document) => (
          <section className="site-settings-card" key={document.urlKey}>
            <header>
              <span className="site-settings-icon"><FileText size={22} /></span>
              <div><strong>{document.label}</strong><small>{document.description}</small></div>
              <label className="home-hero-toggle site-settings-toggle">
                <input type="checkbox" checked={document.visible} onChange={(e) => setSettings((current) => ({ ...current, [document.visibilityKey]: e.target.checked }))} />
                <span></span>{document.visible ? 'Visible' : 'Hidden'}
              </label>
            </header>
            <div className="site-settings-document">
              <div><strong>{document.validUrl ? 'PDF uploaded' : 'No PDF uploaded'}</strong><small>Choose a PDF file up to 25 MB from your computer</small></div>
              <div className="site-settings-document-actions">
                {document.validUrl && <a href={document.normalizedUrl} target="_blank" rel="noreferrer">Open PDF <ExternalLink size={14} /></a>}
                <label>
                  <input type="file" accept="application/pdf,.pdf" onChange={(e) => uploadLegalDocument(document, e)} />
                  {uploadingDocument === document.urlKey ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
                  {document.validUrl ? 'Replace PDF' : 'Upload PDF'}
                </label>
              </div>
            </div>
            <div className={`site-settings-state ${document.invalid ? 'error' : ''}`}>
              {document.invalid ? <><CircleAlert size={17} /><span>Upload a PDF before this document can be shown</span></> : document.validUrl ? <><Check size={17} /><span>PDF is ready to use</span></> : <><Eye size={17} /><span>This document is hidden by default</span></>}
            </div>
          </section>
        ))}
      </div>

      {historyOpen && (
        <RevisionHistoryDrawer
          isOpen={historyOpen}
          onClose={() => setHistoryOpen(false)}
          aggregateType="site_settings"
          aggregateId="singleton"
          title="Site Settings & Legal PDFs"
          role={role}
          api={api}
          currentRevisionId={revisionId ?? null}
          onRollbackSuccess={async () => {
            const data = await api.getSiteSettings();
            setRevisionId(data.currentRevisionId);
            setSettings(data.settings);
            setSavedSettings({ ...data.settings });
            onSaved(data.settings, data.currentRevisionId);
          }}
          onToast={onToast}
        />
      )}
    </main>
  );
}

function RevisionHistoryDrawer({
  isOpen,
  onClose,
  aggregateType,
  aggregateId,
  title,
  role,
  api,
  currentRevisionId,
  onRollbackSuccess,
  onToast,
}: {
  isOpen: boolean;
  onClose: () => void;
  aggregateType: 'project' | 'homepage_hero' | 'site_settings';
  aggregateId: string;
  title: string;
  role: 'owner' | 'editor';
  api: AdminApi;
  currentRevisionId: string | null;
  onRollbackSuccess: () => Promise<void> | void;
  onToast: (toast: Toast) => void;
}) {
  const [revisions, setRevisions] = useState<RevisionHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmRollbackTarget, setConfirmRollbackTarget] = useState<RevisionHistoryItem | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoading(true);
    api.getRevisionHistory(aggregateType, aggregateId)
      .then((items) => {
        if (active) setRevisions(items);
      })
      .catch((error) => {
        if (active) onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to load history' });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [isOpen, aggregateType, aggregateId, api, onToast]);

  if (!isOpen) return null;

  async function handleRollback(target: RevisionHistoryItem) {
    if (!currentRevisionId) {
      onToast({ tone: 'error', message: 'Current head revision is missing' });
      return;
    }
    setRollingBack(true);
    try {
      await api.rollbackRevision(target.id, currentRevisionId);
      await onRollbackSuccess();
      onToast({ tone: 'success', message: `Rolled back to revision #${target.revisionNumber}` });
      setConfirmRollbackTarget(null);
      onClose();
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to rollback revision' });
    } finally {
      setRollingBack(false);
    }
  }

  function formatDateTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  return (
    <div className="history-drawer" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div className="history-panel">
        <header className="history-header">
          <div>
            <span className="eyebrow">{aggregateType.replace('_', ' ')} history</span>
            <h2 id="history-title">{title}</h2>
          </div>
          <button className="preview-close" onClick={onClose} aria-label="Close history"><X size={19} /></button>
        </header>
        <div className="history-content">
          {loading ? (
            <div className="admin-loading" style={{ minHeight: '200px', background: 'transparent', color: 'var(--admin-navy)' }}>
              <LoaderCircle className="spin" size={24} />
            </div>
          ) : revisions.length === 0 ? (
            <p style={{ color: 'var(--admin-muted)', textAlign: 'center', padding: '32px' }}>No recorded revisions yet</p>
          ) : (
            <div className="history-timeline">
              {revisions.map((item) => {
                const isHead = item.id === currentRevisionId;
                const canRollback = role === 'owner' && item.state === 'approved' && !isHead && currentRevisionId;
                return (
                  <div key={item.id} className={`history-entry ${isHead ? 'current-head' : ''}`}>
                    <div className="history-node">#{item.revisionNumber}</div>
                    <div className="history-entry-card">
                      <div className="history-entry-top">
                        <span className={`history-action-badge ${item.action}`}>{item.action}</span>
                        {isHead && <span className="status-pill published" style={{ fontSize: '10px' }}>Current Live</span>}
                      </div>
                      <div className="history-entry-meta">
                        <div><strong>By:</strong> {item.creatorEmail ?? 'System'} {item.creatorRole ? `(${item.creatorRole})` : ''}</div>
                        <div><strong>Date:</strong> {formatDateTime(item.createdAt)}</div>
                        {item.approvedBy && (
                          <div style={{ marginTop: '4px', color: 'var(--admin-green)' }}>
                            <strong>Approved by:</strong> {item.approverEmail ?? 'Owner'} {item.approvedAt ? `at ${formatDateTime(item.approvedAt)}` : ''}
                          </div>
                        )}
                        {item.state === 'rejected' && (
                          <div style={{ marginTop: '4px', color: 'var(--admin-red)' }}>
                            <strong>Status:</strong> Rejected
                          </div>
                        )}
                        {item.state === 'pending' && (
                          <div style={{ marginTop: '4px', color: 'var(--admin-gold)' }}>
                            <strong>Status:</strong> Pending review
                          </div>
                        )}
                      </div>
                      {canRollback && (
                        <button className="rollback-btn" onClick={() => setConfirmRollbackTarget(item)}>
                          <RotateCcw size={14} />Rollback to #{item.revisionNumber}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {confirmRollbackTarget && (
        <div className="modal-backdrop" style={{ zIndex: 1001 }}>
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="rollback-title">
            <span><RotateCcw size={20} /></span>
            <h3 id="rollback-title">Rollback to revision #{confirmRollbackTarget.revisionNumber}?</h3>
            <p>A new approved revision will restore content from this version live immediately.</p>
            <div>
              <button className="secondary-button" onClick={() => setConfirmRollbackTarget(null)} disabled={rollingBack}>Cancel</button>
              <button className="primary-button" onClick={() => handleRollback(confirmRollbackTarget)} disabled={rollingBack}>
                {rollingBack ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Confirm Rollback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UsersManager({
  api,
  currentUserEmail,
  onToast,
}: {
  api: AdminApi;
  currentUserEmail?: string;
  onToast: (toast: Toast) => void;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [rotateUserTarget, setRotateUserTarget] = useState<AdminUser | null>(null);
  const [rotatePassword, setRotatePassword] = useState('');
  const [rotating, setRotating] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<AdminUser | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AdminUser | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listUsers();
      setUsers(list);
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to load users' });
    } finally {
      setLoading(false);
    }
  }, [api, onToast]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  async function handleCreateUser() {
    if (!createEmail.trim() || !createPassword) {
      onToast({ tone: 'error', message: 'Email and password are required' });
      return;
    }
    const nonWs = [...createPassword].filter((c) => !/\s/u.test(c)).length;
    if (nonWs < 16) {
      onToast({ tone: 'error', message: 'Password must have at least 16 non-whitespace characters' });
      return;
    }
    setCreating(true);
    try {
      await api.createUser(createEmail.trim(), createPassword);
      onToast({ tone: 'success', message: `Editor account ${createEmail.trim()} created` });
      setCreateModalOpen(false);
      setCreateEmail('');
      setCreatePassword('');
      await loadUsers();
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to create user' });
    } finally {
      setCreating(false);
    }
  }

  async function handleRotatePassword() {
    if (!rotateUserTarget || !rotatePassword) return;
    const nonWs = [...rotatePassword].filter((c) => !/\s/u.test(c)).length;
    if (nonWs < 16) {
      onToast({ tone: 'error', message: 'Password must have at least 16 non-whitespace characters' });
      return;
    }
    setRotating(true);
    try {
      await api.rotateUser(rotateUserTarget.id, { password: rotatePassword });
      onToast({ tone: 'success', message: `Password updated for ${rotateUserTarget.email}. Active sessions revoked.` });
      setRotateUserTarget(null);
      setRotatePassword('');
      await loadUsers();
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to update password' });
    } finally {
      setRotating(false);
    }
  }

  async function handleDeactivate() {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await api.deactivateUser(deactivateTarget.id);
      onToast({ tone: 'success', message: `Account ${deactivateTarget.email} deactivated` });
      setDeactivateTarget(null);
      await loadUsers();
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to deactivate user' });
    } finally {
      setDeactivating(false);
    }
  }

  async function handleRevokeSessions() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await api.revokeUserSessions(revokeTarget.id);
      onToast({ tone: 'success', message: `All active sessions revoked for ${revokeTarget.email}` });
      setRevokeTarget(null);
      await loadUsers();
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to revoke sessions' });
    } finally {
      setRevoking(false);
    }
  }

  return (
    <main className="admin-main users-manager">
      <header className="list-header">
        <div>
          <span className="eyebrow">Governance / Access control</span>
          <h1>Team &amp; Users <sup>{users.length.toString().padStart(2, '0')}</sup></h1>
          <p>Manage administrator accounts. Editors create proposals; the Owner approves and publishes.</p>
        </div>
        <button className="primary-button" onClick={() => setCreateModalOpen(true)}>
          <Plus size={17} />Add Editor
        </button>
      </header>

      {loading ? (
        <div className="admin-loading" style={{ minHeight: '300px', background: 'transparent', color: 'var(--admin-navy)' }}>
          <LoaderCircle className="spin" size={28} />
        </div>
      ) : (
        <div className="users-table-card">
          <table className="users-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th>Last Active</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isCurrent = user.email.toLowerCase() === currentUserEmail?.toLowerCase();
                const isOwner = user.role === 'owner';
                return (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.email}</strong>
                      {isCurrent && <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--admin-gold)' }}>(You)</span>}
                    </td>
                    <td>
                      <span className={`role-badge ${user.role}`}>{user.role}</span>
                    </td>
                    <td>
                      <span className={`user-status ${user.isActive ? 'active' : 'deactivated'}`}>
                        <span className={`status-dot ${user.isActive ? 'published' : ''}`}></span>
                        {user.isActive ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--admin-muted)', fontSize: '12px' }}>
                      {new Date(user.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ color: 'var(--admin-muted)', fontSize: '12px' }}>
                      {user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never'}
                    </td>
                    <td>
                      <div className="user-actions">
                        {!isOwner && (
                          <>
                            <button className="action-btn" onClick={() => setRotateUserTarget(user)} title="Change password">
                              <KeyRound size={14} /> Password
                            </button>
                            <button className="action-btn" onClick={() => setRevokeTarget(user)} title="Revoke all active sessions">
                              <LogOut size={14} /> Revoke
                            </button>
                            {user.isActive && (
                              <button className="action-btn danger" onClick={() => setDeactivateTarget(user)} title="Deactivate account">
                                <UserX size={14} /> Deactivate
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Editor Modal */}
      {createModalOpen && (
        <div className="modal-backdrop">
          <div className="confirm-modal" style={{ maxWidth: '460px', textAlign: 'left' }} role="dialog" aria-modal="true">
            <h3 style={{ margin: '0 0 16px', fontFamily: 'Georgia, serif', fontSize: '22px' }}>Add Editor Account</h3>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--admin-muted)' }}>
              Editors can create and edit projects, home hero videos, and site settings as proposals for owner review.
            </p>
            <div style={{ display: 'grid', gap: '14px', width: '100%', marginBottom: '24px' }}>
              <div className="editor-field">
                <span>Email Address</span>
                <input type="email" placeholder="editor@miracon.gr" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} />
              </div>
              <div className="editor-field">
                <span>Password (min 16 characters)</span>
                <input type="password" placeholder="••••••••••••••••" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} />
                <small>{[...createPassword].filter((c) => !/\s/u.test(c)).length}/16 characters</small>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="secondary-button" onClick={() => setCreateModalOpen(false)} disabled={creating}>Cancel</button>
              <button className="primary-button" onClick={handleCreateUser} disabled={creating}>
                {creating ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}Create Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {rotateUserTarget && (
        <div className="modal-backdrop">
          <div className="confirm-modal" style={{ maxWidth: '460px', textAlign: 'left' }} role="dialog" aria-modal="true">
            <h3 style={{ margin: '0 0 16px', fontFamily: 'Georgia, serif', fontSize: '22px' }}>Reset Password</h3>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--admin-muted)' }}>
              Set a new password for <strong>{rotateUserTarget.email}</strong>. All active sessions will be revoked.
            </p>
            <div style={{ display: 'grid', gap: '14px', width: '100%', marginBottom: '24px' }}>
              <div className="editor-field">
                <span>New Password (min 16 characters)</span>
                <input type="password" placeholder="••••••••••••••••" value={rotatePassword} onChange={(e) => setRotatePassword(e.target.value)} />
                <small>{[...rotatePassword].filter((c) => !/\s/u.test(c)).length}/16 characters</small>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="secondary-button" onClick={() => setRotateUserTarget(null)} disabled={rotating}>Cancel</button>
              <button className="primary-button" onClick={handleRotatePassword} disabled={rotating}>
                {rotating ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Update Password
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate Confirm Modal */}
      {deactivateTarget && (
        <div className="modal-backdrop">
          <div className="confirm-modal" role="dialog" aria-modal="true">
            <span><UserX size={20} /></span>
            <h3>Deactivate {deactivateTarget.email}?</h3>
            <p>This editor will immediately lose access and cannot sign in.</p>
            <div>
              <button className="secondary-button" onClick={() => setDeactivateTarget(null)} disabled={deactivating}>Cancel</button>
              <button className="danger-button" onClick={handleDeactivate} disabled={deactivating}>
                {deactivating ? <LoaderCircle className="spin" size={17} /> : <UserX size={17} />}Deactivate Editor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Sessions Confirm Modal */}
      {revokeTarget && (
        <div className="modal-backdrop">
          <div className="confirm-modal" role="dialog" aria-modal="true">
            <span><LogOut size={20} /></span>
            <h3>Revoke all sessions for {revokeTarget.email}?</h3>
            <p>The user will be immediately logged out of all active browser sessions.</p>
            <div>
              <button className="secondary-button" onClick={() => setRevokeTarget(null)} disabled={revoking}>Cancel</button>
              <button className="danger-button" onClick={handleRevokeSessions} disabled={revoking}>
                {revoking ? <LoaderCircle className="spin" size={17} /> : <LogOut size={17} />}Revoke Sessions
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ProjectProposalVisual({ project }: { project: Record<string, unknown> }) {
  const coverUrl = String(project['cover_image_url'] || project['coverImageUrl'] || project['hero_poster_url'] || '');
  const title = String(project['title'] || 'Untitled Project');
  const category = String(project['category'] || '');
  const status = String(project['status'] || '');
  const city = String(project['city'] || project['location'] || '');
  const remainingUnits = project['remaining_units'] ?? project['remainingUnits'];
  const shortDesc = String(project['short_description'] || project['shortDescription'] || '');
  const images = (project['images'] as Array<{ id?: string; url: string; alt?: string }>) || [];
  const characteristics = (project['characteristics'] as Array<{ id?: string; label: string; value: string }>) || [];
  const floorPlans = (project['floor_plan_groups'] as Array<{ title: string; plans?: Array<{ title: string }> }>) || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', background: '#fff', padding: '14px', borderRadius: '8px', border: '1px solid var(--admin-line)' }}>
        {coverUrl ? (
          <img src={coverUrl} alt={title} style={{ width: '130px', height: '88px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--admin-line)', flexShrink: 0 }} />
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 style={{ margin: 0, fontSize: '18px', color: 'var(--admin-navy)', fontFamily: 'Georgia, serif' }}>{title}</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '8px 0 6px' }}>
            {category && <span className="role-badge owner">{category}</span>}
            {status && <span className="role-badge editor">{status}</span>}
            {remainingUnits !== undefined && remainingUnits !== null && (
              <span className="role-badge" style={{ background: '#eef2f6', color: 'var(--admin-navy)' }}>
                {String(remainingUnits)} {Number(remainingUnits) === 1 ? 'unit left' : 'units left'}
              </span>
            )}
          </div>
          {city && <div style={{ fontSize: '13px', color: 'var(--admin-muted)' }}>📍 {city}</div>}
        </div>
      </div>

      {shortDesc && (
        <div style={{ background: '#fff', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--admin-line)', fontSize: '13px', lineHeight: '1.5', color: '#2d3748' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--admin-gold)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.05em' }}>
            Description
          </div>
          {shortDesc}
        </div>
      )}

      {characteristics.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--admin-navy)', marginBottom: '8px' }}>
            Characteristics ({characteristics.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
            {characteristics.map((c, i) => (
              <div key={c.id || i} style={{ background: '#fff', border: '1px solid var(--admin-line)', borderRadius: '6px', padding: '8px 10px' }}>
                <div style={{ fontSize: '11px', color: 'var(--admin-muted)', textTransform: 'uppercase' }}>{c.label}</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--admin-navy)', marginTop: '2px' }}>{c.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {images.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--admin-navy)', marginBottom: '8px' }}>
            Gallery Images ({images.length})
          </div>
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '6px' }}>
            {images.map((img, i) => (
              <div key={img.id || i} style={{ flexShrink: 0, width: '84px', textAlign: 'center' }}>
                <img src={img.url} alt={img.alt || ''} style={{ width: '84px', height: '60px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--admin-line)' }} />
                {img.alt && <div style={{ fontSize: '10px', color: 'var(--admin-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>{img.alt}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {floorPlans.length > 0 && (
        <div style={{ background: '#fff', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--admin-line)', fontSize: '13px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--admin-gold)', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.05em' }}>
            Floor Plan Groups ({floorPlans.length})
          </div>
          <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--admin-navy)' }}>
            {floorPlans.map((g, i) => (
              <li key={i} style={{ marginBottom: '4px' }}>
                <strong>{g.title}</strong> {g.plans?.length ? `(${g.plans.length} plan sheets)` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function HeroProposalVisual({ videos }: { videos: Array<Record<string, unknown>> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--admin-navy)', marginBottom: '4px' }}>
        Hero Videos Playlist ({videos.length} videos)
      </div>
      {videos.map((vid, i) => {
        const isActive = Boolean(vid['is_active'] ?? vid['isActive']);
        const title = String(vid['title'] || `Video #${i + 1}`);
        const desktopUrl = String(vid['desktop_url'] || vid['desktopUrl'] || '');
        const mobileUrl = String(vid['mobile_url'] || vid['mobileUrl'] || '');

        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', padding: '12px 16px', borderRadius: '6px', border: '1px solid var(--admin-line)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 600, color: 'var(--admin-navy)', fontSize: '14px' }}>{title}</span>
                <span className={`role-badge ${isActive ? 'owner' : ''}`} style={{ fontSize: '11px', background: isActive ? undefined : '#e2e8f0', color: isActive ? undefined : '#64748b' }}>
                  {isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--admin-muted)', marginTop: '4px', wordBreak: 'break-all' }}>
                🖥️ {desktopUrl || 'No desktop video'} {mobileUrl ? `| 📱 ${mobileUrl}` : ''}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SettingsProposalVisual({ settings }: { settings: Record<string, unknown> }) {
  const items = [
    { label: 'Company Name', value: settings['company_name'] ?? settings['companyName'] },
    { label: 'Email', value: settings['contact_email'] ?? settings['contactEmail'] },
    { label: 'Phone', value: settings['contact_phone'] ?? settings['contactPhone'] },
    { label: 'Address', value: settings['office_address'] ?? settings['officeAddress'] },
    { label: 'Privacy Policy PDF', value: settings['privacy_policy_pdf_url'] ?? settings['privacyPolicyPdfUrl'] },
    { label: 'Terms PDF', value: settings['terms_pdf_url'] ?? settings['termsPdfUrl'] },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--admin-navy)', marginBottom: '4px' }}>
        Updated Site Settings
      </div>
      {items.map((item, i) => (
        item.value ? (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', background: '#fff', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--admin-line)', fontSize: '13px' }}>
            <span style={{ color: 'var(--admin-muted)', fontWeight: 500 }}>{item.label}:</span>
            <span style={{ color: 'var(--admin-navy)', fontWeight: 600, maxWidth: '60%', textAlign: 'right', wordBreak: 'break-all' }}>{String(item.value)}</span>
          </div>
        ) : null
      ))}
    </div>
  );
}

function ProposalReviewContent({ proposal }: { proposal: PendingProposal }) {
  const [viewMode, setViewMode] = useState<'visual' | 'json'>('visual');
  const snap = proposal.snapshot as Record<string, unknown>;

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
        <button
          type="button"
          className={viewMode === 'visual' ? 'primary-button' : 'secondary-button'}
          style={{ minHeight: '32px', height: '32px', padding: '0 14px', fontSize: '12px' }}
          onClick={() => setViewMode('visual')}
        >
          Visual summary
        </button>
        <button
          type="button"
          className={viewMode === 'json' ? 'primary-button' : 'secondary-button'}
          style={{ minHeight: '32px', height: '32px', padding: '0 14px', fontSize: '12px' }}
          onClick={() => setViewMode('json')}
        >
          Raw JSON
        </button>
      </div>

      <div style={{ maxHeight: '400px', overflowY: 'auto', background: 'var(--admin-paper)', padding: '16px', borderRadius: '8px', border: '1px solid var(--admin-line)', marginBottom: '24px' }}>
        {viewMode === 'json' ? (
          <pre style={{ margin: 0, fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace' }}>
            {JSON.stringify(proposal.snapshot, null, 2)}
          </pre>
        ) : proposal.aggregateType === 'project' ? (
          <ProjectProposalVisual project={(snap['project'] as Record<string, unknown>) ?? snap} />
        ) : proposal.aggregateType === 'homepage_hero' ? (
          <HeroProposalVisual videos={(snap['videos'] as Array<Record<string, unknown>>) ?? []} />
        ) : proposal.aggregateType === 'site_settings' ? (
          <SettingsProposalVisual settings={(snap['settings'] as Record<string, unknown>) ?? snap} />
        ) : (
          <pre style={{ margin: 0, fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace' }}>
            {JSON.stringify(proposal.snapshot, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function ProposalsManager({
  api,
  onToast,
  onRefreshProposalsCount,
  onProposalApproved,
}: {
  api: AdminApi;
  onToast: (toast: Toast) => void;
  onRefreshProposalsCount: () => void;
  onProposalApproved?: () => Promise<void>;
}) {
  const [proposals, setProposals] = useState<PendingProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewingProposal, setReviewingProposal] = useState<PendingProposal | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const loadProposals = useCallback(async () => {
    setLoading(true);
    try {
      const items = await api.listPendingProposals();
      setProposals(items);
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to load proposals' });
    } finally {
      setLoading(false);
    }
  }, [api, onToast]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  async function handleApprove(proposal: PendingProposal) {
    setProcessingId(proposal.id);
    try {
      await api.approveProposal(proposal.id, proposal.expectedRevisionId);
      onToast({ tone: 'success', message: `Proposal #${proposal.revisionNumber} approved and published to live website` });
      setReviewingProposal(null);
      await loadProposals();
      await onProposalApproved?.();
      onRefreshProposalsCount();
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to approve proposal' });
    } finally {
      setProcessingId(null);
    }
  }

  async function handleReject(proposal: PendingProposal) {
    setProcessingId(proposal.id);
    try {
      await api.rejectProposal(proposal.id, proposal.expectedRevisionId);
      onToast({ tone: 'success', message: `Proposal #${proposal.revisionNumber} rejected` });
      setReviewingProposal(null);
      await loadProposals();
      onRefreshProposalsCount();
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to reject proposal' });
    } finally {
      setProcessingId(null);
    }
  }

  function getProposalTitle(proposal: PendingProposal): string {
    const snap = proposal.snapshot as Record<string, unknown>;
    if (proposal.aggregateType === 'project') {
      const proj = snap['project'] as Record<string, unknown> | null;
      return proj ? String(proj['title'] ?? 'Project') : `Deleted project (${proposal.aggregateId})`;
    }
    if (proposal.aggregateType === 'homepage_hero') return 'Homepage Hero Playlist';
    if (proposal.aggregateType === 'site_settings') return 'Site Settings';
    return proposal.aggregateType;
  }

  function formatDateTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  return (
    <main className="admin-main proposals-manager">
      <header className="list-header">
        <div>
          <span className="eyebrow">Governance / Approvals</span>
          <h1>Pending Proposals <sup>{proposals.length.toString().padStart(2, '0')}</sup></h1>
          <p>Review and approve change proposals submitted by editors before publishing live</p>
        </div>
      </header>

      {loading ? (
        <div className="admin-loading" style={{ minHeight: '300px', background: 'transparent', color: 'var(--admin-navy)' }}>
          <LoaderCircle className="spin" size={28} />
        </div>
      ) : proposals.length === 0 ? (
        <div className="empty-projects">
          <Check size={36} style={{ color: 'var(--admin-green)' }} />
          <h3>All caught up!</h3>
          <p>No pending change proposals waiting for your review</p>
        </div>
      ) : (
        <div className="proposals-list">
          {proposals.map((proposal) => {
            const isProcessing = processingId === proposal.id;
            return (
              <section key={proposal.id} className="proposal-card">
                <div className="proposal-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span className="eyebrow">{proposal.aggregateType.replace('_', ' ')}</span>
                    <span className="history-action-badge proposal">Proposal #{proposal.revisionNumber}</span>
                  </div>
                  <h3>{getProposalTitle(proposal)}</h3>
                  <div className="proposal-meta">
                    <span><strong>Proposed by:</strong> {proposal.creatorEmail} ({proposal.creatorRole})</span>
                    <span><strong>Date:</strong> {formatDateTime(proposal.createdAt)}</span>
                  </div>
                </div>
                <div className="proposal-actions">
                  <button className="secondary-button" onClick={() => setReviewingProposal(proposal)}>
                    <Eye size={16} />Review
                  </button>
                  <button className="action-btn danger" onClick={() => handleReject(proposal)} disabled={isProcessing}>
                    {isProcessing ? <LoaderCircle className="spin" size={15} /> : <X size={15} />}Reject
                  </button>
                  <button className="primary-button" onClick={() => handleApprove(proposal)} disabled={isProcessing}>
                    {isProcessing ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Approve &amp; Publish
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Review & Diff Modal */}
      {reviewingProposal && (
        <div className="modal-backdrop">
          <div className="confirm-modal" style={{ maxWidth: '720px', textAlign: 'left', width: '92vw' }} role="dialog" aria-modal="true">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <span className="eyebrow">{reviewingProposal.aggregateType.replace('_', ' ')} proposal #{reviewingProposal.revisionNumber}</span>
                <h3 style={{ margin: '4px 0 0', fontFamily: 'Georgia, serif', fontSize: '22px' }}>{getProposalTitle(reviewingProposal)}</h3>
              </div>
              <button className="preview-close" onClick={() => setReviewingProposal(null)}><X size={19} /></button>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--admin-muted)', marginBottom: '16px' }}>
              Proposed by <strong>{reviewingProposal.creatorEmail}</strong> on {formatDateTime(reviewingProposal.createdAt)}
            </div>
            <ProposalReviewContent proposal={reviewingProposal} />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="danger-button" onClick={() => handleReject(reviewingProposal)} disabled={Boolean(processingId)}>
                <X size={16} />Reject proposal
              </button>
              <button className="primary-button" onClick={() => handleApprove(reviewingProposal)} disabled={Boolean(processingId)}>
                {processingId === reviewingProposal.id ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Approve &amp; Publish to live
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ProjectEditor({
  initialProject,
  onBack,
  onSaved,
  onDeleted,
  api,
  role,
}: {
  initialProject: Project;
  onBack: () => void;
  onSaved: (project: Project) => void;
  onDeleted: (id: string) => void;
  api: AdminApi;
  role: 'owner' | 'editor';
}) {
  const [project, setProject] = useState<Project>(() => ({ ...initialProject }));
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initialProject));
  const [section, setSection] = useState<AdminSection>('content');
  const [editingLocale, setEditingLocale] = useState<'en' | 'el'>('en');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState('');
  const [toast, setToast] = useState<Toast>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState<Project['status'] | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<number | '100%'>(1440);

  const mediaMapRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const managed = (initialProject as Project & { managedMedia?: readonly { id: string; relativeUrl?: string; relativePath?: string }[] }).managedMedia ?? [];
    for (const m of managed) {
      if (m.id) {
        mediaMapRef.current.set(m.id, m.id);
        if (m.relativeUrl) mediaMapRef.current.set(m.relativeUrl, m.id);
        if (m.relativePath) mediaMapRef.current.set(m.relativePath, m.id);
      }
    }
  }, [initialProject]);

  const missingRequirements = useMemo(() => getPublishRequirements(project).filter((item) => !item.complete), [project]);
  const readiness = useMemo(() => projectReadiness(project), [project]);
  const isDirty = useMemo(() => JSON.stringify(project) !== savedSnapshot, [project, savedSnapshot]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDirty]);

  function update<Key extends keyof Project>(key: Key, value: Project[Key]) {
    setProject((current) => ({ ...current, [key]: value }));
  }

  const greek = project.translations?.el ?? {};
  function updateGreek(patch: Partial<ProjectLocaleTranslation>) {
    setProject((current) => ({
      ...current,
      translations: { ...current.translations, el: { ...current.translations?.el, ...patch } },
    }));
  }

  function showToast(nextToast: Toast) {
    setToast(nextToast);
    window.setTimeout(() => setToast(null), 3200);
  }

  async function save(status = project.status): Promise<boolean> {
    const slug = normalizedSlug(project.slug);
    if (!project.title.trim() || !slugPattern.test(slug)) {
      showToast({ tone: 'error', message: 'Project name and a valid URL slug are required' });
      setSection(project.title.trim() ? 'seo' : 'content');
      return false;
    }
    if (!isValidRemainingUnits(project.remainingUnits)) {
      showToast({ tone: 'error', message: 'Remaining units must be a nonnegative whole number' });
      setSection('content');
      return false;
    }
    if (status === 'published' && missingRequirements.length > 0 && role === 'owner') {
      showToast({ tone: 'error', message: `Complete ${missingRequirements.length} required item${missingRequirements.length === 1 ? '' : 's'} before publishing` });
      setSection(missingRequirements[0].section);
      return false;
    }

    const nextProject = pruneTranslations(pruneImageVariants(syncLegacyVideoFields({
      ...project,
      slug,
      status,
      updatedAt: new Date().toISOString(),
      seoTitle: project.seoTitle || `${project.title} — MIRACON`,
      seoDescription: project.seoDescription || project.shortDescription,
    })));

    const referencedUrls = collectProjectMediaUrls(nextProject);
    const mediaFileIdSet = new Set<string>();
    const existingManaged = (project as Project & { managedMedia?: readonly { id: string; relativeUrl?: string; relativePath?: string }[] }).managedMedia ?? [];
    for (const m of existingManaged) {
      if (m.id && (referencedUrls.includes(m.relativeUrl ?? '') || referencedUrls.includes(m.relativePath ?? ''))) {
        mediaFileIdSet.add(m.id);
      }
    }
    for (const url of referencedUrls) {
      const id = mediaMapRef.current.get(url);
      if (id) mediaFileIdSet.add(id);
    }
    const mediaFileIds = Array.from(mediaFileIdSet);

    setSaving(true);
    try {
      const result = await api.saveProject(nextProject, {
        expectedRevisionId: (project as Project & { currentRevisionId?: string }).currentRevisionId ?? null,
        mediaFileIds,
      });
      const returnedManaged = (result.project as Project & { managedMedia?: readonly { id: string; relativeUrl?: string; relativePath?: string }[] }).managedMedia ?? [];
      for (const m of returnedManaged) {
        if (m.id) {
          mediaMapRef.current.set(m.id, m.id);
          if (m.relativeUrl) mediaMapRef.current.set(m.relativeUrl, m.id);
          if (m.relativePath) mediaMapRef.current.set(m.relativePath, m.id);
        }
      }
      setProject(result.project);
      setSavedSnapshot(JSON.stringify(result.project));
      onSaved(result.project);
      showToast({
        tone: 'success',
        message: result.isProposal ? 'Proposal submitted for owner review' : status === 'published' ? 'Project is live' : 'Draft saved',
      });
      return true;
    } catch (error) {
      showToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to save the project' });
      return false;
    } finally {
      setSaving(false);
    }
  }

  function requestBack() {
    if (isDirty) setConfirmLeave(true);
    else onBack();
  }

  function requestStatusChange() {
    const nextStatus = project.status === 'published' ? 'draft' : 'published';
    if (nextStatus === 'published' && missingRequirements.length > 0) {
      showToast({ tone: 'error', message: `Complete ${missingRequirements.length} required item${missingRequirements.length === 1 ? '' : 's'} before publishing` });
      setSection(missingRequirements[0].section);
      return;
    }
    setConfirmStatus(nextStatus);
  }

  function openPreview() {
    if (isDirty) {
      showToast({ tone: 'error', message: 'Save your changes before opening preview' });
      return;
    }
    setPreviewOpen(true);
  }

  async function uploadFiles(files: FileList, roleType: 'card' | 'gallery') {
    setUploading(roleType);
    const uploaded: ProjectImage[] = [];
    try {
      for (const file of Array.from(files)) {
        try {
          const uploadFile = await optimizePhotoForDirectUpload(file);
          const media = await api.uploadMedia(uploadFile);
          mediaMapRef.current.set(media.id, media.id);
          mediaMapRef.current.set(media.relativeUrl, media.id);
          mediaMapRef.current.set(media.relativePath, media.id);
          uploaded.push({ id: crypto.randomUUID(), url: media.relativeUrl, storagePath: media.relativePath, alt: file.name.replace(/\.[^.]+$/, ''), role: roleType, sortOrder: 0, width: media.width ?? null, height: media.height ?? null, focalX: 50, focalY: 50 });
        } catch (error) {
          showToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to process image' });
        }
      }
      const key = roleType === 'card' ? 'cardImages' : 'gallery';
      setProject((current) => ({
        ...current,
        [key]: [...current[key], ...uploaded].map((image, index) => ({ ...image, sortOrder: index })),
      }));
      if (uploaded.length) showToast({ tone: 'success', message: `${uploaded.length} image${uploaded.length === 1 ? '' : 's'} uploaded` });
    } finally {
      setUploading('');
    }
  }

  async function uploadSingle(event: ChangeEvent<HTMLInputElement>, field: 'coverUrl' | 'heroUrl' | 'introImageUrl') {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(field);
    try {
      if (!file.type.startsWith('image/')) throw new Error('This slot accepts images only');
      const uploadFile = await optimizePhotoForDirectUpload(file);
      const media = await api.uploadMedia(uploadFile);
      mediaMapRef.current.set(media.id, media.id);
      mediaMapRef.current.set(media.relativeUrl, media.id);
      mediaMapRef.current.set(media.relativePath, media.id);
      setProject((current) => {
        const next = { ...current, [field]: media.relativeUrl } as Project;
        if (field === 'heroUrl') {
          next.heroType = 'image';
          next.heroVariant = 'standard';
          next.heroMobileUrl = null;
          next.heroSoundEnabled = false;
          next.heroIdleUi = false;
        }
        return next;
      });
      showToast({ tone: 'success', message: 'Image uploaded' });
    } catch (error) {
      showToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to process media' });
    } finally {
      setUploading('');
    }
  }

  async function uploadBrochure(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showToast({ tone: 'error', message: 'Brochure must be a PDF file' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      showToast({ tone: 'error', message: 'PDF brochure must be smaller than 25 MB' });
      return;
    }
    setUploading('brochure');
    try {
      const media = await api.uploadMedia(file);
      mediaMapRef.current.set(media.id, media.id);
      mediaMapRef.current.set(media.relativeUrl, media.id);
      mediaMapRef.current.set(media.relativePath, media.id);
      update('brochureUrl', media.relativeUrl);
      showToast({ tone: 'success', message: 'Brochure uploaded' });
    } catch (error) {
      showToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to upload brochure' });
    } finally {
      setUploading('');
    }
  }

  async function removeProject() {
    setSaving(true);
    try {
      await api.deleteProject(project.id, (project as Project & { currentRevisionId?: string }).currentRevisionId);
      onDeleted(project.id);
    } catch (error) {
      showToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to delete project' });
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  function toggleCategory(category: ProjectCategory) {
    update('categories', project.categories.includes(category) ? project.categories.filter((item) => item !== category) : [...project.categories, category]);
  }

  const sections: { id: AdminSection; label: string }[] = [
    { id: 'content', label: 'Content' }, { id: 'specs', label: 'Features' }, { id: 'media', label: 'Media' }, { id: 'plans', label: 'Floor plans' }, { id: 'seo', label: 'SEO & URL' },
  ];

  return (
    <main className="editor-shell">
      <header className="editor-topbar">
        <button className="icon-text-button" onClick={requestBack}><ArrowLeft size={17} />Projects</button>
        <div className="editor-context">
          <BrandMark />
          <div className="editor-title">
            <span className={`status-dot ${project.status}`}></span>
            <strong>{project.title}</strong>
            <small>{project.status}</small>
            {isDirty && <em>Unsaved</em>}
          </div>
        </div>
        <div className="editor-actions">
          <button className="secondary-button" onClick={() => setHistoryOpen(true)} title="View revision history"><History size={17} />History</button>
          <button className="secondary-button" onClick={openPreview}><Eye size={17} />Preview</button>
          {role === 'owner' ? (
            <>
              <button className="secondary-button" onClick={() => save(project.status)} disabled={saving}><Save size={17} />{project.status === 'published' ? 'Save changes' : 'Save draft'}</button>
              <button className="primary-button" onClick={requestStatusChange} disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{project.status === 'published' ? 'Unpublish' : 'Publish'}</button>
            </>
          ) : (
            <button className="primary-button" onClick={() => save(project.status)} disabled={saving}>
              {saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}Submit proposal
            </button>
          )}
        </div>
      </header>

      <div className="editor-layout">
        <aside className="editor-nav">
          <span className="eyebrow">Project editor</span>
          <div className="editor-readiness"><div><span>Content readiness</span><strong>{readiness}%</strong></div><i><b style={{ width: `${readiness}%` }}></b></i><small>{missingRequirements.length ? `${missingRequirements.length} required items left` : 'Ready to publish'}</small></div>
          {sections.map((item, index) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><i>{String(index + 1).padStart(2, '0')}</i>{item.label}<ChevronRight size={15} /></button>)}
          {role === 'owner' && <button className="delete-project" onClick={() => setConfirmDelete(true)}><Trash2 size={16} />Delete project</button>}
        </aside>

        <section className="editor-canvas">
          <div className="editor-locale-toolbar">
            <div><strong>Content language</strong><span>{editingLocale === 'el' ? 'Greek fields are optional; empty values fall back to English' : 'English is the source content and controls shared structure'}</span></div>
            <div className="presentation-switch" role="group" aria-label="Content language"><button type="button" className={editingLocale === 'en' ? 'active' : ''} onClick={() => setEditingLocale('en')}>EN</button><button type="button" className={editingLocale === 'el' ? 'active' : ''} onClick={() => setEditingLocale('el')}>ΕΛ</button></div>
          </div>

          {section === 'content' && editingLocale === 'en' && <>
            <div className="section-heading"><span>01 / Content</span><h2>Project identity</h2><p>The information used in the catalog card and the project page</p></div>
            <div className="editor-form-grid">
              <Field label="Project name"><input value={project.title} onChange={(e) => update('title', e.target.value)} /></Field>
              <Field label="Project page address"><input value={project.address} onChange={(e) => update('address', e.target.value)} /></Field>
              <Field label="Homepage card location"><input value={project.cardAddress} onChange={(e) => update('cardAddress', e.target.value)} /></Field>
              <Field label="Price label"><input value={project.price} onChange={(e) => update('price', e.target.value)} placeholder="from 250 000 €" /></Field>
              <Field label="Remaining units" hint="Shared availability (leave blank if unspecified, 0 for sold out)"><input type="number" min={0} step={1} value={project.remainingUnits ?? ''} onChange={(e) => { const remainingUnits = parseRemainingUnitsInput(e.target.value); if (remainingUnits === undefined) { showToast({ tone: 'error', message: 'Remaining units must be a nonnegative whole number' }); return; } update('remainingUnits', remainingUnits); }} /></Field>
              <Field label="Map coordinates or search query"><input value={project.mapQuery} onChange={(e) => update('mapQuery', e.target.value)} /></Field>
              <Field label="Google Maps link"><input value={project.mapUrl} onChange={(e) => update('mapUrl', e.target.value)} /></Field>
              <Field label="Categories" wide><div className="category-select">{PROJECT_CATEGORIES.map((category) => <button type="button" key={category} className={project.categories.includes(category) ? 'active' : ''} onClick={() => toggleCategory(category)}>{project.categories.includes(category) && <Check size={14} />}{categoryLabels[category]}</button>)}</div></Field>
              <Field label="Short card description" wide hint={`${project.shortDescription.length}/420`}><textarea rows={4} maxLength={420} value={project.shortDescription} onChange={(e) => update('shortDescription', e.target.value)} /></Field>
              <Field label="Page intro heading" wide><input value={project.introTitle} onChange={(e) => update('introTitle', e.target.value)} /></Field>
              <Field label="Full project description" wide><textarea rows={10} value={project.fullDescription} onChange={(e) => update('fullDescription', e.target.value)} /></Field>
              <Field label="Nearby places / running line" wide hint="One item per line"><textarea rows={5} value={project.nearbyPlaces.join('\n')} onChange={(e) => update('nearbyPlaces', e.target.value.split('\n').filter(Boolean))} /></Field>
            </div>
          </>}

          {section === 'content' && editingLocale === 'el' && <>
            <div className="section-heading"><span>01 / Ελληνικά</span><h2>Project identity</h2><p>Translate visitor-facing content. Leave a field empty to use its English value</p></div>
            <div className="editor-form-grid">
              <Field label="Project name"><input value={greek.title ?? ''} placeholder={project.title} onChange={(e) => updateGreek({ title: e.target.value })} /></Field>
              <Field label="Project page address"><input value={greek.address ?? ''} placeholder={project.address} onChange={(e) => updateGreek({ address: e.target.value })} /></Field>
              <Field label="Homepage card location"><input value={greek.cardAddress ?? ''} placeholder={project.cardAddress} onChange={(e) => updateGreek({ cardAddress: e.target.value })} /></Field>
              <Field label="Price label"><input value={greek.price ?? ''} placeholder={project.price} onChange={(e) => updateGreek({ price: e.target.value })} /></Field>
              <Field label="Short card description" wide hint={`${(greek.shortDescription ?? '').length}/420`}><textarea rows={4} maxLength={420} value={greek.shortDescription ?? ''} placeholder={project.shortDescription} onChange={(e) => updateGreek({ shortDescription: e.target.value })} /></Field>
              <Field label="Page intro heading" wide><input value={greek.introTitle ?? ''} placeholder={project.introTitle} onChange={(e) => updateGreek({ introTitle: e.target.value })} /></Field>
              <Field label="Full project description" wide><textarea rows={10} value={greek.fullDescription ?? ''} placeholder={project.fullDescription} onChange={(e) => updateGreek({ fullDescription: e.target.value })} /></Field>
              <Field label="Nearby places / running line" wide hint="One item per line"><textarea rows={5} value={(greek.nearbyPlaces ?? []).join('\n')} placeholder={project.nearbyPlaces.join('\n')} onChange={(e) => updateGreek({ nearbyPlaces: e.target.value.split('\n').filter(Boolean) })} /></Field>
            </div>
          </>}

          {section === 'specs' && editingLocale === 'en' && <>
            <div className="section-heading"><span>02 / Features</span><h2>Characteristics &amp; Benefits</h2><p>Numeric parameters and qualitative advantages of the property</p></div>
            <section className="repeat-section">
              <header className="repeat-heading"><h3>Characteristics</h3></header>
              {project.characteristics.map((char) => (
                <div key={char.id} className="repeat-row">
                  <select value={char.icon} onChange={(e) => update('characteristics', project.characteristics.map((c) => c.id === char.id ? { ...c, icon: e.target.value as any } : c))}>
                    <option value="bed">Bedrooms</option><option value="bath">Bathrooms</option><option value="area">Area</option><option value="levels">Levels</option>
                  </select>
                  <input value={char.label} placeholder="Label" onChange={(e) => update('characteristics', project.characteristics.map((c) => c.id === char.id ? { ...c, label: e.target.value } : c))} />
                  <input value={char.value} placeholder="Value (e.g. 4 beds)" onChange={(e) => update('characteristics', project.characteristics.map((c) => c.id === char.id ? { ...c, value: e.target.value } : c))} />
                </div>
              ))}
            </section>
            <section className="repeat-section">
              <header className="repeat-heading">
                <h3>Benefits</h3>
                <button type="button" onClick={() => update('benefits', [...project.benefits, { id: crypto.randomUUID(), title: 'New benefit', icon: '' }])}><Plus size={15} />Add benefit</button>
              </header>
              {project.benefits.map((b) => (
                <div key={b.id} className="benefit-row">
                  {b.icon ? <img src={b.icon} alt="" className="benefit-icon-preview" /> : <div className="benefit-icon-preview"><ImagePlus size={18} /></div>}
                  <input value={b.title} onChange={(e) => update('benefits', project.benefits.map((item) => item.id === b.id ? { ...item, title: e.target.value } : item))} />
                  <label className="benefit-icon-upload">
                    <input type="file" accept={benefitIconAccept} onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const media = await api.uploadMedia(file);
                        mediaMapRef.current.set(media.id, media.id);
                        mediaMapRef.current.set(media.relativeUrl, media.id);
                        mediaMapRef.current.set(media.relativePath, media.id);
                        update('benefits', project.benefits.map((item) => item.id === b.id ? { ...item, icon: media.relativeUrl } : item));
                        showToast({ tone: 'success', message: 'Benefit icon uploaded' });
                      } catch (err) {
                        showToast({ tone: 'error', message: err instanceof Error ? err.message : 'Upload failed' });
                      }
                    }} />
                    {uploading === `benefit-${b.id}` ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />}Upload icon
                  </label>
                  <button type="button" onClick={() => update('benefits', project.benefits.filter((item) => item.id !== b.id))}><Trash2 size={16} /></button>
                </div>
              ))}
            </section>
          </>}

          {section === 'specs' && editingLocale === 'el' && <>
            <div className="section-heading"><span>02 / Ελληνικά</span><h2>Characteristics &amp; Benefits</h2><p>Greek translations for property features</p></div>
            <section className="repeat-section">
              <header className="repeat-heading"><h3>Characteristics</h3></header>
              {project.characteristics.map((char) => (
                <div key={char.id} className="repeat-row">
                  <span>{char.icon}</span>
                  <input value={greek.characteristics?.[char.id]?.label ?? ''} placeholder={char.label} onChange={(e) => updateGreek({ characteristics: { ...greek.characteristics, [char.id]: { ...greek.characteristics?.[char.id], label: e.target.value } } })} />
                  <input value={greek.characteristics?.[char.id]?.value ?? ''} placeholder={char.value} onChange={(e) => updateGreek({ characteristics: { ...greek.characteristics, [char.id]: { ...greek.characteristics?.[char.id], value: e.target.value } } })} />
                </div>
              ))}
            </section>
            <section className="repeat-section">
              <header className="repeat-heading"><h3>Benefits</h3></header>
              {project.benefits.map((b) => (
                <div key={b.id} className="benefit-row">
                  {b.icon ? <img src={b.icon} alt="" className="benefit-icon-preview" /> : <div className="benefit-icon-preview"><ImagePlus size={18} /></div>}
                  <input value={greek.benefits?.[b.id]?.title ?? ''} placeholder={b.title} onChange={(e) => updateGreek({ benefits: { ...greek.benefits, [b.id]: { title: e.target.value } } })} />
                </div>
              ))}
            </section>
          </>}

          {section === 'media' && <>
            <div className="section-heading"><span>03 / Media</span><h2>Photos, Hero &amp; Videos</h2><p>Catalog cover, page hero media, and image gallery</p></div>
            <div className="media-slots">
              <div className="media-slot">
                {project.coverUrl ? <img src={project.coverUrl} alt="Cover" /> : <div className="media-slot-placeholder"><ImagePlus size={24} /></div>}
                <div><strong>Catalog cover image</strong><p>Shown in project listings and cards</p></div>
                <label className="action-btn"><input type="file" accept="image/*" onChange={(e) => uploadSingle(e, 'coverUrl')} />{uploading === 'coverUrl' ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}Change</label>
              </div>
              <div className="media-slot">
                {project.introImageUrl ? <img src={project.introImageUrl} alt="Intro" /> : <div className="media-slot-placeholder"><ImagePlus size={24} /></div>}
                <div><strong>Intro banner image</strong><p>Used in the introductory section</p></div>
                <label className="action-btn"><input type="file" accept="image/*" onChange={(e) => uploadSingle(e, 'introImageUrl')} />{uploading === 'introImageUrl' ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}Change</label>
              </div>
              <div className="media-slot">
                <div className="media-slot-placeholder"><FileText size={24} /></div>
                <div><strong>PDF Brochure</strong><p>{project.brochureUrl ? 'Brochure uploaded' : 'No brochure PDF uploaded'}</p></div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {project.brochureUrl && <a href={project.brochureUrl} target="_blank" rel="noreferrer" className="action-btn">Open PDF</a>}
                  <label className="action-btn"><input type="file" accept="application/pdf,.pdf" onChange={uploadBrochure} />{uploading === 'brochure' ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}Upload</label>
                </div>
              </div>
            </div>

            <section className="repeat-section" style={{ marginTop: '36px' }}>
              <header className="repeat-heading">
                <div>
                  <h3 style={{ margin: 0 }}>Catalog card photos ({project.cardImages.length})</h3>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--admin-muted)' }}>
                    Preview photos displayed on the project card in catalog listings (3 recommended)
                  </p>
                </div>
                <label className="primary-button" style={{ cursor: 'pointer' }}>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => e.target.files && uploadFiles(e.target.files, 'card')}
                  />
                  {uploading === 'card' ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
                  Upload photos
                </label>
              </header>
              {project.cardImages.length === 0 ? (
                <div style={{ marginTop: '16px', padding: '16px', border: '1px dashed var(--admin-line)', borderRadius: '4px', color: 'var(--admin-muted)', fontSize: '13px' }}>
                  No card photos uploaded yet. Upload 3 photos to appear in catalog previews.
                </div>
              ) : (
                <div className="media-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '14px', marginTop: '16px' }}>
                  {project.cardImages.map((img) => (
                    <div key={img.id} style={{ position: 'relative', border: '1px solid var(--admin-line)', borderRadius: '4px', overflow: 'hidden' }}>
                      <img src={img.url} alt={img.alt} style={{ width: '100%', height: '120px', objectFit: 'cover' }} />
                      <button
                        type="button"
                        onClick={() => update('cardImages', project.cardImages.filter((item) => item.id !== img.id))}
                        style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.65)', color: 'white', border: 0, borderRadius: '50%', width: '28px', height: '28px', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
                        title="Remove photo"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="repeat-section" style={{ marginTop: '36px' }}>
              <header className="repeat-heading">
                <div>
                  <h3 style={{ margin: 0 }}>Gallery photos ({project.gallery.length})</h3>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--admin-muted)' }}>
                    Interior and exterior gallery photos displayed in the project page slider
                  </p>
                </div>
                <label className="primary-button" style={{ cursor: 'pointer' }}>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => e.target.files && uploadFiles(e.target.files, 'gallery')}
                  />
                  {uploading === 'gallery' ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
                  Upload photos
                </label>
              </header>
              {project.gallery.length === 0 ? (
                <div style={{ marginTop: '16px', padding: '16px', border: '1px dashed var(--admin-line)', borderRadius: '4px', color: 'var(--admin-muted)', fontSize: '13px' }}>
                  Gallery is empty. The public website will automatically fall back to showing catalog card photos.
                </div>
              ) : (
                <div className="media-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '14px', marginTop: '16px' }}>
                  {project.gallery.map((img) => (
                    <div key={img.id} style={{ position: 'relative', border: '1px solid var(--admin-line)', borderRadius: '4px', overflow: 'hidden' }}>
                      <img src={img.url} alt={img.alt} style={{ width: '100%', height: '120px', objectFit: 'cover' }} />
                      <button
                        type="button"
                        onClick={() => update('gallery', project.gallery.filter((item) => item.id !== img.id))}
                        style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.65)', color: 'white', border: 0, borderRadius: '50%', width: '28px', height: '28px', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
                        title="Remove photo"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>}

          {section === 'plans' && <>
            <div className="section-heading"><span>04 / Floor plans</span><h2>Floor plan layouts</h2><p>Group layouts by type and upload floor plan schematics</p></div>
            <button type="button" className="secondary-button" onClick={() => update('floorPlanGroups', [...project.floorPlanGroups, { id: crypto.randomUUID(), title: 'Standard Villas', plans: [] }])}><Plus size={16} />Add floor plan group</button>
            <div style={{ display: 'grid', gap: '24px', marginTop: '20px' }}>
              {project.floorPlanGroups.map((group) => (
                <section key={group.id} className="repeat-section" style={{ border: '1px solid var(--admin-line)', padding: '20px', borderRadius: '4px', background: 'white' }}>
                  <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <input value={group.title} onChange={(e) => update('floorPlanGroups', project.floorPlanGroups.map((g) => g.id === group.id ? { ...g, title: e.target.value } : g))} style={{ fontSize: '18px', fontWeight: 600, border: '1px solid var(--admin-line)', padding: '6px 10px', borderRadius: '3px' }} />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <label className="secondary-button" style={{ cursor: 'pointer' }}>
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const media = await api.uploadMedia(file);
                            mediaMapRef.current.set(media.id, media.id);
                            mediaMapRef.current.set(media.relativeUrl, media.id);
                            mediaMapRef.current.set(media.relativePath, media.id);
                            const newPlan = { id: crypto.randomUUID(), title: 'Ground Floor', imageUrl: media.relativeUrl, alt: 'Floor plan' };
                            update('floorPlanGroups', project.floorPlanGroups.map((g) => g.id === group.id ? { ...g, plans: [...g.plans, newPlan] } : g));
                            showToast({ tone: 'success', message: 'Plan layout uploaded' });
                          } catch (err) {
                            showToast({ tone: 'error', message: err instanceof Error ? err.message : 'Upload failed' });
                          }
                        }} />
                        <Plus size={15} />Add plan schematic
                      </label>
                      <button type="button" className="danger-button icon-text-button" onClick={() => update('floorPlanGroups', project.floorPlanGroups.filter((g) => g.id !== group.id))}><Trash2 size={16} /></button>
                    </div>
                  </header>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                    {group.plans.map((plan) => (
                      <div key={plan.id} style={{ border: '1px solid var(--admin-line)', borderRadius: '4px', padding: '10px', background: 'var(--admin-paper)' }}>
                        <img src={plan.imageUrl} alt={plan.alt} style={{ width: '100%', height: '120px', objectFit: 'contain', background: 'white', border: '1px solid #eee' }} />
                        <input value={plan.title} onChange={(e) => update('floorPlanGroups', project.floorPlanGroups.map((g) => g.id === group.id ? { ...g, plans: g.plans.map((p) => p.id === plan.id ? { ...p, title: e.target.value } : p) } : g))} style={{ marginTop: '8px', width: '100%', padding: '4px 8px', fontSize: '13px' }} />
                        <button type="button" onClick={() => update('floorPlanGroups', project.floorPlanGroups.map((g) => g.id === group.id ? { ...g, plans: g.plans.filter((p) => p.id !== plan.id) } : g))} style={{ marginTop: '6px', color: 'var(--admin-red)', background: 'none', border: 0, cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}><Trash2 size={12} />Remove plan</button>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>}

          {section === 'seo' && <>
            <div className="section-heading"><span>05 / SEO &amp; URL</span><h2>Search engine optimization</h2><p>Custom URL slug, meta tags and search preview</p></div>
            <div className="editor-form-grid">
              <Field label="URL slug" wide hint="Unique lowercase path segment"><input value={project.slug} onChange={(e) => update('slug', normalizedSlug(e.target.value))} /></Field>
              <Field label="SEO meta title" wide hint={`${project.seoTitle.length}/60`}><input maxLength={60} value={project.seoTitle} placeholder={`${project.title} — MIRACON`} onChange={(e) => update('seoTitle', e.target.value)} /></Field>
              <Field label="SEO meta description" wide hint={`${project.seoDescription.length}/160`}><textarea rows={4} maxLength={160} value={project.seoDescription} placeholder={project.shortDescription} onChange={(e) => update('seoDescription', e.target.value)} /></Field>
            </div>
            <div className="search-preview">
              <span>miracon.gr › projects › {project.slug}</span>
              <h3>{project.seoTitle || `${project.title} — MIRACON`}</h3>
              <p>{project.seoDescription || project.shortDescription || 'Exclusive modern villas and residences in Greece by MIRACON.'}</p>
            </div>
          </>}
        </section>
      </div>

      {toast && <div className={`admin-toast ${toast.tone}`} role="status" aria-live="polite">{toast.tone === 'success' ? <Check size={17} /> : <CircleAlert size={17} />}{toast.message}</div>}
      {confirmDelete && <div className="modal-backdrop"><div className="confirm-modal" role="dialog" aria-modal="true"><span><Trash2 size={20} /></span><h3>Delete “{project.title}”?</h3><p>The project will be permanently marked deleted.</p><div><button className="secondary-button" onClick={() => setConfirmDelete(false)}>Cancel</button><button className="danger-button" onClick={removeProject}>Delete permanently</button></div></div></div>}
      {confirmLeave && <div className="modal-backdrop"><div className="confirm-modal" role="dialog" aria-modal="true"><span><CircleAlert size={20} /></span><h3>Discard unsaved changes?</h3><p>Your latest edits have not been saved.</p><div><button className="secondary-button" onClick={() => setConfirmLeave(false)}>Continue editing</button><button className="danger-button" onClick={onBack}>Discard changes</button></div></div></div>}
      {confirmStatus && <div className="modal-backdrop"><div className="confirm-modal status-confirm" role="dialog" aria-modal="true"><span><Check size={20} /></span><h3>{confirmStatus === 'published' ? 'Publish this project?' : 'Unpublish this project?'}</h3><p>{confirmStatus === 'published' ? 'The saved project will be live for all website visitors.' : 'The project will be moved back to draft status.'}</p><div><button className="secondary-button" onClick={() => setConfirmStatus(null)}>Cancel</button><button className="primary-button" disabled={saving} onClick={async () => { if (await save(confirmStatus)) setConfirmStatus(null); }}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{confirmStatus === 'published' ? 'Publish project' : 'Unpublish'}</button></div></div></div>}
      {previewOpen && <div className="responsive-preview"><header><div><strong>Responsive preview · {editingLocale.toUpperCase()}</strong><span>Save changes to refresh preview</span></div><div className="preview-sizes"><button className={previewWidth === 1440 ? 'active' : ''} onClick={() => setPreviewWidth(1440)}>Desktop</button><button className={previewWidth === 768 ? 'active' : ''} onClick={() => setPreviewWidth(768)}>Tablet</button><button className={previewWidth === 390 ? 'active' : ''} onClick={() => setPreviewWidth(390)}>Mobile</button><button className={previewWidth === '100%' ? 'active' : ''} onClick={() => setPreviewWidth('100%')}>Full</button></div><button className="preview-close" onClick={() => setPreviewOpen(false)}><X size={19} /></button></header><div className="preview-stage"><iframe title={`${project.title} responsive preview`} src={`${editingLocale === 'el' ? '/el' : ''}/preview/${project.slug}`} style={{ width: previewWidth === '100%' ? '100%' : `${previewWidth}px` }} /></div></div>}
      {historyOpen && <RevisionHistoryDrawer isOpen={historyOpen} onClose={() => setHistoryOpen(false)} aggregateType="project" aggregateId={project.id} title={project.title} role={role} api={api} currentRevisionId={(project as Project & { currentRevisionId?: string }).currentRevisionId ?? null} onRollbackSuccess={async () => { const list = await api.listProjects(); const updated = list.find((p) => p.id === project.id); if (updated) { setProject(updated); setSavedSnapshot(JSON.stringify(updated)); onSaved(updated); } }} onToast={showToast} />}
    </main>
  );
}

export default function AdminApp() {
  const [ready, setReady] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>({ authenticated: false });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [homeHeroVideos, setHomeHeroVideos] = useState<HomeHeroVideo[]>([]);
  const [homeHeroRevisionId, setHomeHeroRevisionId] = useState<string | null>(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>({ ...defaultSiteSettings });
  const [siteSettingsRevisionId, setSiteSettingsRevisionId] = useState<string | null>(null);
  const [pendingProposalsCount, setPendingProposalsCount] = useState(0);
  const [view, setView] = useState<AdminView>('projects');
  const [selected, setSelected] = useState<Project | null>(null);
  const [globalToast, setGlobalToast] = useState<Toast>(null);

  const clearSession = useCallback(() => {
    setSessionState({ authenticated: false });
    setProjects([]);
    setHomeHeroVideos([]);
    setSiteSettings({ ...defaultSiteSettings });
    setSelected(null);
    setPendingProposalsCount(0);
  }, []);

  const api = useMemo(() => new AdminApi({ onUnauthorized: clearSession }), [clearSession]);

  const loadPendingProposalsCount = useCallback(async () => {
    try {
      const proposals = await api.listPendingProposals();
      setPendingProposalsCount(proposals.length);
    } catch {
      // ignore
    }
  }, [api]);

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch (error) {
      setGlobalToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to load projects' });
    }
  }, [api]);

  const loadHomeHeroVideos = useCallback(async () => {
    try {
      const data = await api.listHomeHeroVideos();
      setHomeHeroVideos(data.videos);
      setHomeHeroRevisionId(data.currentRevisionId);
    } catch (error) {
      setGlobalToast({ tone: 'error', message: `Hero playlist: ${error instanceof Error ? error.message : 'Unable to load'}` });
    }
  }, [api]);

  const loadSiteSettings = useCallback(async () => {
    try {
      const data = await api.getSiteSettings();
      setSiteSettings(data.settings);
      setSiteSettingsRevisionId(data.currentRevisionId);
    } catch (error) {
      setGlobalToast({ tone: 'error', message: `Site settings: ${error instanceof Error ? error.message : 'Unable to load'}` });
    }
  }, [api]);

  useEffect(() => {
    let active = true;

    async function initializeSession() {
      try {
        const session = await api.session();
        if (!session.authenticated) return;
        await api.bootstrapCsrf();
        if (!active) return;
        setSessionState(session);
        await Promise.all([
          loadProjects(),
          loadHomeHeroVideos(),
          loadSiteSettings(),
          session.role === 'owner' ? loadPendingProposalsCount() : Promise.resolve(),
        ]);
      } catch (error) {
        if (!active) return;
        clearSession();
        setLoginError(error instanceof Error ? error.message : 'Unable to connect to the server');
      } finally {
        if (active) setReady(true);
      }
    }

    initializeSession();
    return () => { active = false; };
  }, [api, clearSession, loadProjects, loadHomeHeroVideos, loadSiteSettings, loadPendingProposalsCount]);

  async function login(email: string, password: string) {
    setLoginLoading(true);
    setLoginError('');
    try {
      const session = await api.login(email, password);
      await api.bootstrapCsrf();
      setSessionState(session);
      await Promise.all([
        loadProjects(),
        loadHomeHeroVideos(),
        loadSiteSettings(),
        session.role === 'owner' ? loadPendingProposalsCount() : Promise.resolve(),
      ]);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to sign in');
    } finally {
      setLoginLoading(false);
    }
  }

  async function logout() {
    try {
      await api.logout();
    } finally {
      clearSession();
    }
  }

  async function reorder(event: DragEndEvent) {
    if (!isOwner || !event.over || event.active.id === event.over.id) return;
    const oldIndex = projects.findIndex((project) => project.id === event.active.id);
    const newIndex = projects.findIndex((project) => project.id === event.over?.id);
    const reordered = arrayMove(projects, oldIndex, newIndex).map((project, index) => ({ ...project, sortOrder: index }));
    setProjects(reordered);
    try {
      await api.reorderProjects(reordered.map((project) => ({ id: project.id, sortOrder: project.sortOrder })));
      setGlobalToast({ tone: 'success', message: 'Project order updated' });
    } catch (error) {
      setProjects(projects);
      setGlobalToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to reorder projects' });
    }
  }

  async function importSeed() {
    for (const project of seedProjects) {
      const syncedProject = syncLegacyVideoFields(project);
      try {
        await api.saveProject(syncedProject);
      } catch (error) {
        setGlobalToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to import projects' });
        return;
      }
    }
    await loadProjects();
    setGlobalToast({ tone: 'success', message: 'Current website projects imported' });
  }

  function saveToState(project: Project) {
    setProjects((current) => current.some((item) => item.id === project.id) ? current.map((item) => item.id === project.id ? project : item) : [...current, project]);
    setSelected(project);
  }

  function deleteFromState(id: string) {
    setProjects((current) => current.filter((project) => project.id !== id));
    setSelected(null);
  }

  if (!ready) return <LoadingScreen />;
  if (!sessionState.authenticated) return <LoginScreen onLogin={login} error={loginError} loading={loginLoading} />;

  const userRole = sessionState.role ?? 'editor';
  const isOwner = userRole === 'owner';

  return (
    <div className="admin-app">
      {!selected && (
        <aside className="admin-rail">
          <BrandLockup />
          <nav>
            <button className={view === 'projects' ? 'active' : ''} title="Projects" onClick={() => setView('projects')}>
              <LayoutGrid size={19} />
              <span>Projects</span>
            </button>
            <button className={view === 'home-hero' ? 'active' : ''} title="Homepage hero" onClick={() => setView('home-hero')}>
              <Film size={19} />
              <span>Home hero</span>
            </button>
            <button className={view === 'site-settings' ? 'active' : ''} title="Site settings" onClick={() => setView('site-settings')}>
              <FileText size={19} />
              <span>Site settings</span>
            </button>
            {isOwner && (
              <>
                <button className={view === 'proposals' ? 'active' : ''} title="Approvals" onClick={() => setView('proposals')}>
                  <Inbox size={19} />
                  <span>Proposals</span>
                  {pendingProposalsCount > 0 && <span className="nav-counter-badge">{pendingProposalsCount}</span>}
                </button>
                <button className={view === 'users' ? 'active' : ''} title="Users" onClick={() => setView('users')}>
                  <Users size={19} />
                  <span>Users</span>
                </button>
              </>
            )}
            <a href="/" target="_blank" rel="noreferrer">
              <ExternalLink size={19} />
              <span>View website</span>
            </a>
          </nav>
          <div>
            <div className="rail-user-section">
              <span className="rail-user-email" title={sessionState.email ?? ''}>{sessionState.email ?? 'Administrator'}</span>
              <span className={`role-badge ${userRole}`}>{userRole}</span>
            </div>
            <span className="rail-env">LIVE WORKSPACE</span>
            <button onClick={logout} title="Sign out"><LogOut size={18} /><span>Sign out</span></button>
          </div>
        </aside>
      )}

      {selected ? (
        <ProjectEditor
          initialProject={selected}
          onBack={() => setSelected(null)}
          onSaved={saveToState}
          onDeleted={deleteFromState}
          api={api}
          role={userRole}
        />
      ) : view === 'home-hero' ? (
        <HomeHeroManager
          initialVideos={homeHeroVideos}
          projects={projects}
          api={api}
          onSaved={(videos, revisionId) => {
            setHomeHeroVideos(videos);
            if (revisionId !== undefined) {
              setHomeHeroRevisionId(revisionId);
            }
          }}
          onToast={setGlobalToast}
          role={userRole}
          currentRevisionId={homeHeroRevisionId}
        />
      ) : view === 'site-settings' ? (
        <SiteSettingsManager
          initialSettings={siteSettings}
          api={api}
          onSaved={(settings, revisionId) => {
            setSiteSettings(settings);
            if (revisionId !== undefined) {
              setSiteSettingsRevisionId(revisionId);
            }
          }}
          onToast={setGlobalToast}
          role={userRole}
          currentRevisionId={siteSettingsRevisionId}
        />
      ) : view === 'proposals' && isOwner ? (
        <ProposalsManager
          api={api}
          onToast={setGlobalToast}
          onRefreshProposalsCount={loadPendingProposalsCount}
          onProposalApproved={async () => {
            await Promise.all([loadProjects(), loadHomeHeroVideos(), loadSiteSettings()]);
          }}
        />
      ) : view === 'users' && isOwner ? (
        <UsersManager
          api={api}
          currentUserEmail={sessionState.email}
          onToast={setGlobalToast}
        />
      ) : (
        <ProjectList
          projects={projects}
          onOpen={setSelected}
          onCreate={() => setSelected(emptyProject(projects.length))}
          onReorder={reorder}
          onImport={importSeed}
          canImport={projects.length === 0}
          canReorder={isOwner}
        />
      )}

      {globalToast && (
        <div className={`admin-toast ${globalToast.tone}`} role="status" aria-live="polite">
          {globalToast.tone === 'success' ? <Check size={17} /> : <CircleAlert size={17} />}
          {globalToast.message}
        </div>
      )}
    </div>
  );
}
