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
  rectSortingStrategy,
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
  ImagePlus,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Monitor,
  Plus,
  Save,
  Search,
  Smartphone,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useState, type ChangeEvent, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react';
import { seedProjects } from '../data/projects';
import {
  optimizePhotoForDirectUpload,
  processMediaUpload,
  readImageDimensions,
  registerPublicMediaAsset,
  toImageVariantSet,
} from '../lib/admin-media';
import { fallbackHomeHeroVideos, mapHomeHeroVideo, type HomeHeroVideo } from '../lib/home-hero';
import { normalizeMediaUrl } from '../lib/media';
import { mapProjectRow } from '../lib/projects';
import {
  PROJECT_CATEGORIES,
  categoryLabels,
  type FloorPlanGroup,
  type ImageVariantSet,
  type Project,
  type ProjectCategory,
  type ProjectImage,
} from '../lib/project-types';
import { getBrowserSupabaseClient } from '../lib/supabase-browser';

type AdminSection = 'content' | 'specs' | 'media' | 'plans' | 'seo';
type AdminView = 'projects' | 'home-hero';
type Toast = { tone: 'success' | 'error'; message: string } | null;

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const mediaWorkerEnabled = import.meta.env.PUBLIC_MEDIA_WORKER_ENABLED === 'true';

function normalizedSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function getPublishRequirements(project: Project) {
  return [
    { label: 'Project name', complete: Boolean(project.title.trim()), section: 'content' as AdminSection },
    { label: 'Valid public URL', complete: slugPattern.test(normalizedSlug(project.slug)), section: 'seo' as AdminSection },
    { label: 'Address', complete: Boolean(project.address.trim()), section: 'content' as AdminSection },
    { label: 'Price', complete: Boolean(project.price.trim()), section: 'content' as AdminSection },
    { label: 'Category', complete: project.categories.length > 0, section: 'content' as AdminSection },
    { label: 'Card description', complete: Boolean(project.shortDescription.trim()), section: 'content' as AdminSection },
    { label: 'Full description', complete: Boolean(project.fullDescription.trim()), section: 'content' as AdminSection },
    { label: 'Catalog cover', complete: Boolean(project.coverUrl), section: 'media' as AdminSection },
    { label: 'Page hero', complete: Boolean(project.heroUrl), section: 'media' as AdminSection },
    { label: 'Intro image', complete: Boolean(project.introImageUrl), section: 'media' as AdminSection },
    { label: 'Video poster', complete: project.heroType !== 'video' || Boolean(project.heroPosterUrl), section: 'media' as AdminSection },
  ];
}

function projectReadiness(project: Project) {
  const requirements = getPublishRequirements(project);
  return Math.round((requirements.filter((item) => item.complete).length / requirements.length) * 100);
}

function withTimeout<T>(operation: PromiseLike<T>, timeoutMs = 10000): Promise<T> {
  return Promise.race([
    Promise.resolve(operation),
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('Supabase request timed out')), timeoutMs);
    }),
  ]);
}

const emptyProject = (sortOrder: number): Project => ({
  id: crypto.randomUUID(),
  slug: 'new-project',
  title: 'New project',
  address: '',
  price: '',
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
  updatedAt: new Date().toISOString(),
});

function projectToRow(project: Project) {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    address: project.address,
    card_address: project.cardAddress,
    price: project.price,
    short_description: project.shortDescription,
    full_description: project.fullDescription,
    intro_title: project.introTitle,
    categories: project.categories,
    status: project.status,
    sort_order: project.sortOrder,
    cover_url: project.coverUrl,
    cover_focal_x: project.coverFocalX,
    cover_focal_y: project.coverFocalY,
    hero_type: project.heroType,
    hero_variant: project.heroVariant,
    hero_sound_enabled: project.heroSoundEnabled,
    hero_idle_ui: project.heroIdleUi,
    hero_url: project.heroUrl,
    hero_mobile_url: project.heroMobileUrl ?? null,
    hero_poster_url: project.heroPosterUrl,
    hero_focal_x: project.heroFocalX,
    hero_focal_y: project.heroFocalY,
    intro_image_url: project.introImageUrl,
    brochure_url: project.brochureUrl,
    map_query: project.mapQuery,
    map_url: project.mapUrl,
    characteristics: project.characteristics,
    benefits: project.benefits,
    floor_plan_groups: project.floorPlanGroups,
    image_variants: project.imageVariants ?? { version: 1, images: {} },
    nearby_places: project.nearbyPlaces,
    seo_title: project.seoTitle || `${project.title} — MIRACON`,
    seo_description: project.seoDescription || project.shortDescription,
  };
}

function projectImagesToRows(project: Project) {
  return [...project.cardImages, ...project.gallery].map((image, index) => ({
    id: image.id,
    url: image.url,
    storage_path: image.storagePath ?? null,
    alt: image.alt,
    role: image.role,
    sort_order: image.sortOrder ?? index,
    width: image.width ?? null,
    height: image.height ?? null,
    focal_x: image.focalX ?? 50,
    focal_y: image.focalY ?? 50,
  }));
}

function homeHeroVideoToRow(video: HomeHeroVideo) {
  return {
    id: video.id,
    title: video.title,
    project_id: video.projectId,
    desktop_url: video.desktopUrl,
    desktop_storage_path: video.desktopStoragePath,
    mobile_url: video.mobileUrl,
    mobile_storage_path: video.mobileStoragePath,
    sort_order: video.sortOrder,
    is_active: video.isActive,
  };
}

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

function addImageVariant(
  images: Record<string, ImageVariantSet>,
  url: string,
  variants: ImageVariantSet,
) {
  return { ...images, [normalizeMediaUrl(url)]: variants };
}

function pruneImageVariants(project: Project): Project {
  const referenced = new Set([
    project.coverUrl,
    project.heroType === 'image' ? project.heroUrl : '',
    project.heroPosterUrl ?? '',
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

function BrandMark() {
  return <span className="admin-brand-mark"><img src="/img/logo_mark.svg" alt="" /></span>;
}

function BrandLockup() {
  return <div className="admin-brand-lockup"><BrandMark /><span><strong>MIRACON</strong><small>Project desk</small></span></div>;
}

function LoadingScreen() {
  return <div className="admin-loading"><BrandMark /><LoaderCircle className="spin" size={20} /></div>;
}

function LoginScreen({ onLogin, error, loading }: { onLogin: (email: string, password: string) => void; error: string; loading: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    onLogin(email, password);
  }

  return (
    <main className="admin-login">
      <section className="login-visual">
        <div className="login-wordmark"><BrandLockup /></div>
        <div className="login-statement">
          <span className="eyebrow">Project Desk / 2026</span>
          <h1>Architecture<br />deserves an<br /><em>editorial</em> workspace.</h1>
        </div>
        <p>Private content system for MIRACON Constructions.</p>
      </section>
      <section className="login-panel">
        <form onSubmit={submit}>
          <span className="login-index">01 / SECURE ACCESS</span>
          <h2>Welcome back</h2>
          <p>Sign in with the administrator account.</p>
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label>
          {error && <div className="login-error"><CircleAlert size={16} />{error}</div>}
          <button className="primary-button login-button" disabled={loading}>{loading ? <LoaderCircle className="spin" size={18} /> : 'Enter project desk'}<ChevronRight size={18} /></button>
        </form>
      </section>
    </main>
  );
}

function SortableProjectRow({ project, onOpen, reorderEnabled }: { project: Project; onOpen: () => void; reorderEnabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id, disabled: !reorderEnabled });
  return (
    <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`project-row ${isDragging ? 'is-dragging' : ''}`}>
      <button className="drag-handle" {...attributes} {...listeners} disabled={!reorderEnabled} aria-label={`Reorder ${project.title}`}><GripVertical size={18} /></button>
      <button className="project-row-main" onClick={onOpen}>
        <img src={project.coverUrl || '/img/figma_hero.png'} alt="" />
        <span className="project-row-copy"><strong>{project.title}</strong><small>{project.address || 'Address not set'}</small></span>
        <span className="project-row-tags">{project.categories.map((category) => <i key={category}>{categoryLabels[category]}</i>)}</span>
        <span className={`status-pill ${project.status}`}><b></b>{project.status === 'published' ? 'Published' : 'Draft'}</span>
        <span className="project-updated"><b>{projectReadiness(project)}%</b>{new Date(project.updatedAt).toLocaleDateString('en-GB')}</span>
        <ChevronRight size={18} />
      </button>
    </article>
  );
}

function ProjectList({ projects, onOpen, onCreate, onReorder, onImport, canImport }: {
  projects: Project[];
  onOpen: (project: Project) => void;
  onCreate: () => void;
  onReorder: (event: DragEndEvent) => void;
  onImport: () => void;
  canImport: boolean;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'published' | 'draft'>('all');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const filtered = projects.filter((project) => (filter === 'all' || project.status === filter) && `${project.title} ${project.address}`.toLowerCase().includes(query.toLowerCase()));
  const reorderEnabled = filter === 'all' && !query.trim();

  return (
    <main className="admin-main">
      <header className="list-header">
        <div><span className="eyebrow">Portfolio / Projects</span><h1>Projects <sup>{projects.length.toString().padStart(2, '0')}</sup></h1></div>
        <button className="primary-button" onClick={onCreate}><Plus size={18} />New project</button>
      </header>
      <section className="portfolio-metrics">
        <div><span>Published</span><strong>{projects.filter((project) => project.status === 'published').length}</strong></div>
        <div><span>In draft</span><strong>{projects.filter((project) => project.status === 'draft').length}</strong></div>
        <div className="metric-wide"><span>Portfolio status</span><strong>{projects.length ? 'Active' : 'Awaiting content'}</strong><i></i></div>
      </section>
      <section className="project-table">
        <div className="table-tools">
          <div className="segmented-control">{(['all', 'published', 'draft'] as const).map((value) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div>
          <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" aria-label="Search projects" /></label>
        </div>
        {!reorderEnabled && <p className="reorder-note">Clear search and select All to reorder the portfolio.</p>}
        <div className="table-head"><span></span><span>Project</span><span>Categories</span><span>Status</span><span>Updated</span><span></span></div>
        {filtered.length > 0 ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
            <SortableContext items={filtered.map((project) => project.id)} strategy={verticalListSortingStrategy}>
              <div className="project-rows">{filtered.map((project) => <SortableProjectRow key={project.id} project={project} reorderEnabled={reorderEnabled} onOpen={() => onOpen(project)} />)}</div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="empty-projects"><LayoutGrid size={28} /><h3>No projects here</h3><p>Create a project or change the current filter.</p>{canImport && <button className="secondary-button" onClick={onImport}>Import current website projects</button>}</div>
        )}
      </section>
    </main>
  );
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
  const desktopUploadKey = `${video.id}:desktop`;
  const mobileUploadKey = `${video.id}:mobile`;

  return (
    <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`home-hero-card ${isDragging ? 'is-dragging' : ''}`}>
      <header>
        <button className="home-hero-drag" {...attributes} {...listeners} aria-label={`Reorder ${video.title}`}><GripVertical size={18} /></button>
        <span className="home-hero-order">{String(index + 1).padStart(2, '0')}</span>
        <div><strong>{video.title || 'Untitled video'}</strong><small>{video.isActive ? 'Visible on homepage' : 'Hidden from homepage'}</small></div>
        <label className="home-hero-toggle"><input type="checkbox" checked={video.isActive} onChange={(event) => onChange({ isActive: event.target.checked })} /><span></span>{video.isActive ? 'Active' : 'Hidden'}</label>
        <button className="home-hero-remove" onClick={onRemove} aria-label={`Remove ${video.title}`}><Trash2 size={17} /></button>
      </header>

      <div className="home-hero-card-body">
        <div className="home-hero-preview">
          {video.desktopUrl ? <video src={video.desktopUrl} muted playsInline controls preload="metadata" /> : <div><Film size={28} /><span>Upload a desktop video</span></div>}
        </div>

        <div className="home-hero-fields">
          <Field label="Internal title"><input value={video.title} onChange={(event) => onChange({ title: event.target.value })} /></Field>
          <Field label="Related project"><select value={video.projectId ?? ''} onChange={(event) => onChange({ projectId: event.target.value || null })}><option value="">General MIRACON video</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></Field>
          <div className="home-hero-assets">
            <div><Monitor size={20} /><span><strong>Desktop MP4</strong><small>{video.desktopUrl ? 'Uploaded' : 'Required for active videos'}</small></span><label><input type="file" accept="video/mp4" onChange={(event) => onUpload('desktop', event)} />{uploading === desktopUploadKey ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{video.desktopUrl ? 'Replace' : 'Upload'}</label></div>
            <div><Smartphone size={20} /><span><strong>Mobile MP4</strong><small>{video.mobileUrl ? 'Uploaded' : 'Desktop version will be used'}</small></span><label><input type="file" accept="video/mp4" onChange={(event) => onUpload('mobile', event)} />{uploading === mobileUploadKey ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{video.mobileUrl ? 'Replace' : 'Upload'}</label></div>
          </div>
        </div>
      </div>
    </article>
  );
}

function HomeHeroManager({
  initialVideos,
  projects,
  demo,
  onSaved,
  onToast,
}: {
  initialVideos: HomeHeroVideo[];
  projects: Project[];
  demo: boolean;
  onSaved: (videos: HomeHeroVideo[]) => void;
  onToast: (toast: Toast) => void;
}) {
  const [videos, setVideos] = useState<HomeHeroVideo[]>(() => structuredClone(initialVideos));
  const [savedVideos, setSavedVideos] = useState<HomeHeroVideo[]>(() => structuredClone(initialVideos));
  const [uploading, setUploading] = useState('');
  const [saving, setSaving] = useState(false);
  const supabase = getBrowserSupabaseClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const isDirty = JSON.stringify(videos) !== JSON.stringify(savedVideos);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDirty]);

  function updateVideo(id: string, patch: Partial<HomeHeroVideo>) {
    setVideos((current) => current.map((video) => video.id === id ? { ...video, ...patch } : video));
  }

  function reorderVideos(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    setVideos((current) => {
      const oldIndex = current.findIndex((video) => video.id === event.active.id);
      const newIndex = current.findIndex((video) => video.id === event.over?.id);
      return arrayMove(current, oldIndex, newIndex).map((video, index) => ({ ...video, sortOrder: index }));
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
      if (demo || !supabase) {
        const localUrl = URL.createObjectURL(file);
        updateVideo(id, kind === 'desktop'
          ? { desktopUrl: localUrl, desktopStoragePath: null }
          : { mobileUrl: localUrl, mobileStoragePath: null });
        return;
      }

      let publicUrl: string;
      let storagePath: string;
      if (mediaWorkerEnabled) {
        const media = await processMediaUpload(supabase, file, {
          kind: 'video',
          outputBucket: 'site-media',
          context: { target: 'home-hero', videoId: id, rendition: kind },
          profile: {
            video: kind === 'mobile'
              ? { max_width: 1080, max_height: 1920, crf: 25, preset: 'medium', audio_bitrate: '96k' }
              : { max_width: 1920, max_height: 1080, crf: 23, preset: 'medium', audio_bitrate: '128k' },
            poster: { width: kind === 'mobile' ? 720 : 1280, quality: 82, at_seconds: 1 },
          },
        });
        publicUrl = media.primaryUrl;
        storagePath = media.primaryPath;
      } else {
        const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
        storagePath = `home-hero/${id}/${kind}-${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage.from('site-media').upload(storagePath, file, {
          cacheControl: '31536000',
          contentType: 'video/mp4',
          upsert: false,
        });
        if (error) throw error;
        publicUrl = supabase.storage.from('site-media').getPublicUrl(storagePath).data.publicUrl;
      }
      updateVideo(id, kind === 'desktop'
        ? { desktopUrl: publicUrl, desktopStoragePath: storagePath }
        : { mobileUrl: publicUrl, mobileStoragePath: storagePath });
      onToast({ tone: 'success', message: `${kind === 'desktop' ? 'Desktop' : 'Mobile'} video ${mediaWorkerEnabled ? 'processed' : 'uploaded'}` });
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to upload video' });
    } finally {
      setUploading('');
    }
  }

  async function savePlaylist() {
    const normalized = videos.map((video, index) => ({ ...video, sortOrder: index }));
    const invalidActiveVideo = normalized.find((video) => video.isActive && !video.desktopUrl);
    if (invalidActiveVideo) {
      onToast({ tone: 'error', message: `Upload a desktop video for “${invalidActiveVideo.title}” before activating it` });
      return;
    }

    setSaving(true);
    try {
      if (!demo && supabase) {
        const { error } = await supabase.rpc('replace_homepage_videos', {
          p_items: normalized.map(homeHeroVideoToRow),
        });
        if (error) throw error;

        const nextPaths = new Set(normalized.flatMap((video) => [video.desktopStoragePath, video.mobileStoragePath]).filter((path): path is string => typeof path === 'string' && path.length > 0));
        const stalePaths = savedVideos
          .flatMap((video) => [video.desktopStoragePath, video.mobileStoragePath])
          .filter((path): path is string => typeof path === 'string' && path.length > 0)
          .filter((path) => !nextPaths.has(path));
        const legacyPaths = stalePaths.filter((path) => !path.startsWith('processed/'));
        if (legacyPaths.length) {
          const { error: cleanupError } = await supabase.storage.from('site-media').remove(legacyPaths);
          if (cleanupError) throw cleanupError;
        }
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }

      setVideos(normalized);
      setSavedVideos(structuredClone(normalized));
      onSaved(normalized);
      onToast({ tone: 'success', message: 'Homepage video order saved' });
    } catch (error) {
      onToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to save homepage videos' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="admin-main home-hero-manager">
      <header className="list-header">
        <div><span className="eyebrow">Homepage / Hero playlist</span><h1>Hero videos <sup>{videos.length.toString().padStart(2, '0')}</sup></h1><p>Videos play from top to bottom and repeat after the last item.</p></div>
        <div className="home-hero-actions"><button className="secondary-button" onClick={() => setVideos((current) => [...current, emptyHomeHeroVideo(current.length)])}><Plus size={18} />Add video</button><button className="primary-button" onClick={savePlaylist} disabled={saving || !isDirty}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}Save playlist</button></div>
      </header>

      <section className="home-hero-help"><Film size={22} /><div><strong>Playback rules</strong><p>Desktop is required. Mobile is optional and automatically replaces desktop below 600 px. Only the current and next videos are loaded.</p></div></section>

      {videos.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorderVideos}><SortableContext items={videos.map((video) => video.id)} strategy={verticalListSortingStrategy}><section className="home-hero-list">{videos.map((video, index) => <SortableHomeHeroVideo key={video.id} video={video} index={index} projects={projects} uploading={uploading} onChange={(patch) => updateVideo(video.id, patch)} onRemove={() => setVideos((current) => current.filter((item) => item.id !== video.id).map((item, itemIndex) => ({ ...item, sortOrder: itemIndex })))} onUpload={(kind, event) => uploadVideo(video.id, kind, event)} />)}</section></SortableContext></DndContext> : <section className="home-hero-empty"><Film size={30} /><h2>No hero videos</h2><p>Add a video to create the homepage playlist. Until then the built-in fallback remains visible.</p><button className="primary-button" onClick={() => setVideos([emptyHomeHeroVideo(0)])}><Plus size={18} />Add first video</button></section>}
    </main>
  );
}

function Field({ label, children, hint, wide = false }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return <label className={`editor-field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function FocalPointEditor({ label, imageUrl, x, y, onChange }: { label: string; imageUrl: string; x: number; y: number; onChange: (x: number, y: number) => void }) {
  function setPoint(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    onChange(
      Math.round(((event.clientX - rect.left) / rect.width) * 100),
      Math.round(((event.clientY - rect.top) / rect.height) * 100),
    );
  }

  return (
    <div className="focal-editor">
      <div><strong>{label}</strong><span>Click the important part of the image · {x}% / {y}%</span></div>
      <button type="button" onClick={setPoint} disabled={!imageUrl}>
        {imageUrl ? <img src={imageUrl} alt="" style={{ objectPosition: `${x}% ${y}%` }} /> : <ImagePlus size={24} />}
        {imageUrl && <i style={{ left: `${x}%`, top: `${y}%` }}></i>}
      </button>
    </div>
  );
}

function SortableImage({ image, onRemove, onAlt, onFocal }: { image: ProjectImage; onRemove: () => void; onAlt: (alt: string) => void; onFocal: (x: number, y: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: image.id });
  function selectFocus(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    onFocal(Math.round(((event.clientX - rect.left) / rect.width) * 100), Math.round(((event.clientY - rect.top) / rect.height) * 100));
  }
  return (
    <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`media-card ${isDragging ? 'is-dragging' : ''}`}>
      <div className="media-card-crop" onClick={selectFocus} title="Click to set the card focal point">
        <img src={image.url} alt={image.alt} style={{ objectPosition: `${image.focalX ?? 50}% ${image.focalY ?? 50}%` }} />
        <i style={{ left: `${image.focalX ?? 50}%`, top: `${image.focalY ?? 50}%` }}></i>
      </div>
      <button className="media-drag" {...attributes} {...listeners}><GripVertical size={17} /></button>
      <button className="media-remove" onClick={onRemove}><X size={15} /></button>
      <div className="media-card-meta"><input value={image.alt} onChange={(event) => onAlt(event.target.value)} placeholder="Alt text" /><span>{image.width && image.height ? `${image.width} × ${image.height}` : 'Original ratio'}</span></div>
    </article>
  );
}

function ImageCollection({ title, images, onChange, onUpload, uploading }: { title: string; images: ProjectImage[]; onChange: (images: ProjectImage[]) => void; onUpload: (files: FileList) => void; uploading: boolean }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  function dragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = images.findIndex((image) => image.id === event.active.id);
    const newIndex = images.findIndex((image) => image.id === event.over?.id);
    onChange(arrayMove(images, oldIndex, newIndex).map((image, index) => ({ ...image, sortOrder: index })));
  }
  return (
    <div className="image-collection">
      <div className="collection-heading"><div><h3>{title}</h3><span>{images.length} files · drag to reorder</span></div><label className="upload-button"><input type="file" accept="image/*" multiple onChange={(event) => event.target.files && onUpload(event.target.files)} />{uploading ? <LoaderCircle className="spin" size={17} /> : <ImagePlus size={17} />}Add images</label></div>
      {images.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={images.map((image) => image.id)} strategy={rectSortingStrategy}><div className="media-grid">{images.map((image) => <SortableImage key={image.id} image={image} onRemove={() => onChange(images.filter((item) => item.id !== image.id))} onAlt={(alt) => onChange(images.map((item) => item.id === image.id ? { ...item, alt } : item))} onFocal={(focalX, focalY) => onChange(images.map((item) => item.id === image.id ? { ...item, focalX, focalY } : item))} />)}</div></SortableContext></DndContext> : <div className="media-empty">No images uploaded</div>}
    </div>
  );
}

function ProjectEditor({ initialProject, onBack, onSaved, onDeleted, demo }: { initialProject: Project; onBack: () => void; onSaved: (project: Project) => void; onDeleted: (id: string) => void; demo: boolean }) {
  const [project, setProject] = useState<Project>(() => structuredClone(initialProject));
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initialProject));
  const [section, setSection] = useState<AdminSection>('content');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState('');
  const [toast, setToast] = useState<Toast>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState<Project['status'] | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<number | '100%'>(1440);
  const supabase = getBrowserSupabaseClient();
  const isDirty = JSON.stringify(project) !== savedSnapshot;
  const requirements = getPublishRequirements(project);
  const missingRequirements = requirements.filter((item) => !item.complete);
  const readiness = projectReadiness(project);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDirty]);

  function update<K extends keyof Project>(key: K, value: Project[K]) {
    setProject((current) => ({ ...current, [key]: value }));
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
    if (status === 'published' && missingRequirements.length > 0) {
      showToast({ tone: 'error', message: `Complete ${missingRequirements.length} required item${missingRequirements.length === 1 ? '' : 's'} before publishing` });
      setSection(missingRequirements[0].section);
      return false;
    }

    const nextProject = pruneImageVariants({ ...project, slug, status, updatedAt: new Date().toISOString(), seoTitle: project.seoTitle || `${project.title} — MIRACON`, seoDescription: project.seoDescription || project.shortDescription });
    setSaving(true);
    try {
      if (demo || !supabase) {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        setProject(nextProject);
        setSavedSnapshot(JSON.stringify(nextProject));
        onSaved(nextProject);
        showToast({ tone: 'success', message: status === 'published' ? 'Published in local demo' : 'Draft saved in local demo' });
        return true;
      }

      const { error } = await withTimeout(supabase.rpc('save_project_with_images', {
        p_project: projectToRow(nextProject),
        p_images: projectImagesToRows(nextProject),
      }), 20000);
      if (error) throw error;

      setProject(nextProject);
      setSavedSnapshot(JSON.stringify(nextProject));
      onSaved(nextProject);
      showToast({ tone: 'success', message: status === 'published' ? 'Project is live' : 'Draft saved' });
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

  async function uploadFiles(files: FileList, role: 'card' | 'gallery') {
    if (!supabase) {
      showToast({ tone: 'error', message: 'Connect Supabase to upload files' });
      return;
    }
    setUploading(role);
    const uploaded: { image: ProjectImage; variants?: ImageVariantSet }[] = [];
    try {
      for (const file of Array.from(files)) {
        try {
          if (mediaWorkerEnabled) {
            const media = await processMediaUpload(supabase, file, {
              kind: 'image',
              outputBucket: 'project-media',
              context: { target: 'project-image', projectId: project.id, role },
              profile: { image: { widths: [480, 768, 1280, 1920, 2400], avif_quality: 52, webp_quality: 82, primary_format: 'webp' } },
            });
            uploaded.push({
              image: {
                id: crypto.randomUUID(), url: media.primaryUrl, storagePath: media.primaryPath,
                alt: file.name.replace(/\.[^.]+$/, ''), role, sortOrder: 0,
                width: media.width, height: media.height, focalX: 50, focalY: 50,
              },
              variants: toImageVariantSet(media),
            });
          } else {
            const uploadFile = await optimizePhotoForDirectUpload(file);
            const dimensions = await readImageDimensions(uploadFile);
            const safeName = uploadFile.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
            const path = `${project.id}/${crypto.randomUUID()}-${safeName}`;
            const { error } = await supabase.storage.from('project-media').upload(path, uploadFile, {
              upsert: false,
              cacheControl: '31536000',
              contentType: uploadFile.type || undefined,
            });
            if (error) throw error;
            uploaded.push({ image: {
              id: crypto.randomUUID(),
              url: supabase.storage.from('project-media').getPublicUrl(path).data.publicUrl,
              storagePath: path,
              alt: file.name.replace(/\.[^.]+$/, ''),
              role,
              sortOrder: 0,
              width: dimensions.width || null,
              height: dimensions.height || null,
              focalX: 50,
              focalY: 50,
            } });
          }
        } catch (error) {
          showToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to process image' });
        }
      }
      const key = role === 'card' ? 'cardImages' : 'gallery';
      setProject((current) => ({
        ...current,
        [key]: [...current[key], ...uploaded.map((item) => item.image)].map((image, index) => ({ ...image, sortOrder: index })),
        imageVariants: {
          version: 1,
          images: uploaded.reduce(
            (images, item) => item.variants ? addImageVariant(images, item.image.url, item.variants) : images,
            current.imageVariants?.images ?? {},
          ),
        },
      }));
      if (uploaded.length) showToast({ tone: 'success', message: `${uploaded.length} image${uploaded.length === 1 ? '' : 's'} ${mediaWorkerEnabled ? 'processed' : 'uploaded'}` });
    } finally {
      setUploading('');
    }
  }

  async function uploadSingle(event: ChangeEvent<HTMLInputElement>, field: 'coverUrl' | 'heroUrl' | 'heroMobileUrl' | 'heroPosterUrl' | 'introImageUrl') {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !supabase) {
      showToast({ tone: 'error', message: 'Connect Supabase to upload files' });
      return;
    }
    setUploading(field);
    try {
      const kind = file.type.startsWith('video/') ? 'video' : 'image';
      if (field !== 'heroUrl' && field !== 'heroMobileUrl' && kind !== 'image') throw new Error('This slot accepts images only');
      if (field === 'heroMobileUrl' && kind !== 'video') throw new Error('Mobile hero must be an MP4 video');
      const mobileVideo = field === 'heroMobileUrl';
      let primaryUrl: string;
      let posterUrl: string | null = null;
      let variants: ImageVariantSet | null = null;
      if (mediaWorkerEnabled) {
        const media = await processMediaUpload(supabase, file, {
          kind,
          outputBucket: 'project-media',
          context: { target: field, projectId: project.id },
          profile: kind === 'image'
            ? { image: { widths: [480, 768, 1280, 1920, 2400], avif_quality: 52, webp_quality: 82, primary_format: 'webp' } }
            : {
                video: mobileVideo
                  ? { max_width: 1080, max_height: 1920, crf: 25, preset: 'medium', audio_bitrate: '96k' }
                  : { max_width: 1920, max_height: 1080, crf: 23, preset: 'medium', audio_bitrate: '128k' },
                poster: { width: mobileVideo ? 720 : 1280, quality: 82, at_seconds: 1 },
              },
        });
        primaryUrl = media.primaryUrl;
        posterUrl = media.posterUrl;
        if (kind === 'image') variants = toImageVariantSet(media);
      } else {
        if (kind === 'video' && (file.type !== 'video/mp4' || file.size > 50 * 1024 * 1024)) {
          throw new Error('Video must be an MP4 file smaller than 50 MB');
        }
        const uploadFile = kind === 'image' ? await optimizePhotoForDirectUpload(file) : file;
        const path = `${project.id}/${crypto.randomUUID()}-${uploadFile.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}`;
        const { error } = await supabase.storage.from('project-media').upload(path, uploadFile, {
          upsert: false,
          cacheControl: '31536000',
          contentType: uploadFile.type || undefined,
        });
        if (error) throw error;
        primaryUrl = supabase.storage.from('project-media').getPublicUrl(path).data.publicUrl;
      }
      setProject((current) => {
        const next = { ...current, [field]: primaryUrl } as Project;
        if (kind === 'image' && variants) {
          next.imageVariants = {
            version: 1,
            images: addImageVariant(current.imageVariants?.images ?? {}, primaryUrl, variants),
          };
        }
        if (field === 'heroUrl') {
          next.heroType = kind;
          if (kind === 'image') {
            next.heroMobileUrl = null;
            next.heroSoundEnabled = false;
            next.heroIdleUi = false;
          } else if (!next.heroPosterUrl && posterUrl) {
            next.heroPosterUrl = posterUrl;
          }
        }
        return next;
      });
      showToast({ tone: 'success', message: `${kind === 'video' ? 'Video' : 'Image'} ${mediaWorkerEnabled ? 'processed' : 'uploaded'}` });
    } catch (error) {
      showToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to process media' });
    } finally {
      setUploading('');
    }
  }

  async function uploadBrochure(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !supabase) {
      showToast({ tone: 'error', message: 'Connect Supabase to upload files' });
      return;
    }
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
      const path = `${project.id}/${crypto.randomUUID()}-${file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}`;
      const { error } = await supabase.storage.from('project-documents').upload(path, file, {
        upsert: false,
        cacheControl: '31536000',
        contentType: 'application/pdf',
      });
      if (error) throw error;
      const publicUrl = supabase.storage.from('project-documents').getPublicUrl(path).data.publicUrl;
      if (mediaWorkerEnabled) {
        await registerPublicMediaAsset(supabase, {
          bucketId: 'project-documents',
          objectPath: path,
          publicUrl,
          mimeType: 'application/pdf',
          sizeBytes: file.size,
        });
      }
      update('brochureUrl', publicUrl);
      showToast({ tone: 'success', message: 'Brochure uploaded' });
    } catch (error) {
      showToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to upload brochure' });
    } finally {
      setUploading('');
    }
  }

  async function uploadBenefitIcon(benefitId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !supabase) {
      showToast({ tone: 'error', message: 'Connect Supabase to upload SVG icons' });
      return;
    }
    if (file.type !== 'image/svg+xml' && !file.name.toLowerCase().endsWith('.svg')) {
      showToast({ tone: 'error', message: 'Benefit icons must be SVG files' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast({ tone: 'error', message: 'SVG icon must be smaller than 2 MB' });
      return;
    }

    const uploadKey = `benefit-${benefitId}`;
    setUploading(uploadKey);
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
    const path = `${project.id}/${crypto.randomUUID()}-${safeName}`;
    try {
      const { error } = await supabase.storage.from('project-media').upload(path, file, {
        contentType: 'image/svg+xml',
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) throw error;
      const icon = supabase.storage.from('project-media').getPublicUrl(path).data.publicUrl;
      if (mediaWorkerEnabled) {
        await registerPublicMediaAsset(supabase, {
          bucketId: 'project-media',
          objectPath: path,
          publicUrl: icon,
          mimeType: 'image/svg+xml',
          sizeBytes: file.size,
        });
      }
      setProject((current) => ({ ...current, benefits: current.benefits.map((benefit) => benefit.id === benefitId ? { ...benefit, icon } : benefit) }));
      showToast({ tone: 'success', message: 'Benefit icon uploaded' });
    } catch (error) {
      showToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to upload benefit icon' });
    } finally {
      setUploading('');
      event.target.value = '';
    }
  }

  async function uploadPlanImage(groupId: string, planId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !supabase) {
      showToast({ tone: 'error', message: 'Connect Supabase to upload files' });
      return;
    }
    setUploading(planId);
    try {
      let imageUrl: string;
      let variants: ImageVariantSet | null = null;
      if (mediaWorkerEnabled) {
        const media = await processMediaUpload(supabase, file, {
          kind: 'image',
          outputBucket: 'project-media',
          context: { target: 'floor-plan', projectId: project.id, groupId, planId },
          profile: { image: { widths: [768, 1280, 1920, 2400, 3000], avif_quality: 60, webp_quality: 88, primary_format: 'webp' } },
        });
        imageUrl = media.primaryUrl;
        variants = toImageVariantSet(media);
      } else {
        const uploadFile = await optimizePhotoForDirectUpload(file);
        const path = `${project.id}/${crypto.randomUUID()}-${uploadFile.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}`;
        const { error } = await supabase.storage.from('project-media').upload(path, uploadFile, {
          upsert: false,
          cacheControl: '31536000',
          contentType: uploadFile.type || undefined,
        });
        if (error) throw error;
        imageUrl = supabase.storage.from('project-media').getPublicUrl(path).data.publicUrl;
      }
      setProject((current) => ({
        ...current,
        floorPlanGroups: current.floorPlanGroups.map((group) => group.id === groupId
          ? { ...group, plans: group.plans.map((plan) => plan.id === planId ? { ...plan, imageUrl } : plan) }
          : group),
        ...(variants ? { imageVariants: {
          version: 1,
          images: addImageVariant(current.imageVariants?.images ?? {}, imageUrl, variants),
        } } : {}),
      }));
      showToast({ tone: 'success', message: `Floor plan ${mediaWorkerEnabled ? 'processed' : 'uploaded'}` });
    } catch (error) {
      showToast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to process floor plan' });
    } finally {
      setUploading('');
    }
  }

  async function removeProject() {
    if (!supabase || demo) {
      onDeleted(project.id);
      return;
    }
    let { error } = await supabase.rpc('delete_project', { p_project_id: project.id });
    if (error && (error.code === 'PGRST202' || /delete_project|schema cache/i.test(error.message))) {
      ({ error } = await supabase.from('projects').delete().eq('id', project.id));
    }
    if (error) {
      showToast({ tone: 'error', message: error.message });
      return;
    }
    for (const bucket of ['project-media', 'project-documents']) {
      const { data } = await supabase.storage.from(bucket).list(project.id, { limit: 1000 });
      if (data?.length) await supabase.storage.from(bucket).remove(data.map((file) => `${project.id}/${file.name}`));
    }
    onDeleted(project.id);
  }

  function toggleCategory(category: ProjectCategory) {
    update('categories', project.categories.includes(category) ? project.categories.filter((item) => item !== category) : [...project.categories, category]);
  }

  function addPlanGroup() {
    update('floorPlanGroups', [...project.floorPlanGroups, { id: crypto.randomUUID(), title: 'New plan type', plans: [] }]);
  }

  function updatePlanGroup(id: string, patch: Partial<FloorPlanGroup>) {
    update('floorPlanGroups', project.floorPlanGroups.map((group) => group.id === id ? { ...group, ...patch } : group));
  }

  const sections: { id: AdminSection; label: string }[] = [
    { id: 'content', label: 'Content' }, { id: 'specs', label: 'Features' }, { id: 'media', label: 'Media' }, { id: 'plans', label: 'Floor plans' }, { id: 'seo', label: 'SEO & URL' },
  ];

  return (
    <main className="editor-shell">
      <header className="editor-topbar">
        <button className="icon-text-button" onClick={requestBack}><ArrowLeft size={17} />Projects</button>
        <div className="editor-context"><BrandMark /><div className="editor-title"><span className={`status-dot ${project.status}`}></span><strong>{project.title}</strong><small>{project.status}</small>{isDirty && <em>Unsaved</em>}</div></div>
        <div className="editor-actions">
          <button className="secondary-button" onClick={openPreview}><Eye size={17} />Preview</button>
          <button className="secondary-button" onClick={() => save(project.status)} disabled={saving}><Save size={17} />{project.status === 'published' ? 'Save changes' : 'Save draft'}</button>
          <button className="primary-button" onClick={requestStatusChange} disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{project.status === 'published' ? 'Unpublish' : 'Publish'}</button>
        </div>
      </header>
      <div className="editor-layout">
        <aside className="editor-nav">
          <span className="eyebrow">Project editor</span>
          <div className="editor-readiness"><div><span>Content readiness</span><strong>{readiness}%</strong></div><i><b style={{ width: `${readiness}%` }}></b></i><small>{missingRequirements.length ? `${missingRequirements.length} required items left` : 'Ready to publish'}</small></div>
          {sections.map((item, index) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><i>{String(index + 1).padStart(2, '0')}</i>{item.label}<ChevronRight size={15} /></button>)}
          <button className="delete-project" onClick={() => setConfirmDelete(true)}><Trash2 size={16} />Delete project</button>
        </aside>
        <section className="editor-canvas">
          {section === 'content' && <>
            <div className="section-heading"><span>01 / Content</span><h2>Project identity</h2><p>The information used in the catalog card and the project page.</p></div>
            <div className="editor-form-grid">
              <Field label="Project name"><input value={project.title} onChange={(event) => update('title', event.target.value)} /></Field>
              <Field label="Project page address"><input value={project.address} onChange={(event) => update('address', event.target.value)} /></Field>
              <Field label="Homepage card location"><input value={project.cardAddress} onChange={(event) => update('cardAddress', event.target.value)} /></Field>
              <Field label="Price label"><input value={project.price} onChange={(event) => update('price', event.target.value)} placeholder="from 250 000 €" /></Field>
              <Field label="Map coordinates or search query"><input value={project.mapQuery} onChange={(event) => update('mapQuery', event.target.value)} /></Field>
              <Field label="Google Maps link"><input value={project.mapUrl} onChange={(event) => update('mapUrl', event.target.value)} /></Field>
              <Field label="Categories" wide><div className="category-select">{PROJECT_CATEGORIES.map((category) => <button type="button" key={category} className={project.categories.includes(category) ? 'active' : ''} onClick={() => toggleCategory(category)}>{project.categories.includes(category) && <Check size={14} />}{categoryLabels[category]}</button>)}</div></Field>
              <Field label="Short card description" wide hint={`${project.shortDescription.length}/420`}><textarea rows={4} maxLength={420} value={project.shortDescription} onChange={(event) => update('shortDescription', event.target.value)} /></Field>
              <Field label="Page intro heading" wide><input value={project.introTitle} onChange={(event) => update('introTitle', event.target.value)} /></Field>
              <Field label="Full project description" wide><textarea rows={10} value={project.fullDescription} onChange={(event) => update('fullDescription', event.target.value)} /></Field>
              <Field label="Nearby places / running line" wide hint="One item per line"><textarea rows={5} value={project.nearbyPlaces.join('\n')} onChange={(event) => update('nearbyPlaces', event.target.value.split('\n').filter(Boolean))} /></Field>
            </div>
          </>}
          {section === 'specs' && <>
            <div className="section-heading"><span>02 / Features</span><h2>Characteristics & benefits</h2><p>Structured facts used in the page highlights.</p></div>
            <div className="repeat-section"><div className="repeat-heading"><h3>Characteristics</h3><button onClick={() => update('characteristics', [...project.characteristics, { id: crypto.randomUUID(), label: 'Characteristic', value: '', icon: 'area' }])}><Plus size={16} />Add</button></div>{project.characteristics.map((item) => <div className="repeat-row" key={item.id}><select value={item.icon} onChange={(event) => update('characteristics', project.characteristics.map((current) => current.id === item.id ? { ...current, icon: event.target.value as typeof item.icon } : current))}><option value="bed">Bed</option><option value="bath">Bath</option><option value="area">Area</option><option value="levels">Levels</option></select><input value={item.label} onChange={(event) => update('characteristics', project.characteristics.map((current) => current.id === item.id ? { ...current, label: event.target.value } : current))} /><input value={item.value} onChange={(event) => update('characteristics', project.characteristics.map((current) => current.id === item.id ? { ...current, value: event.target.value } : current))} /><button onClick={() => update('characteristics', project.characteristics.filter((current) => current.id !== item.id))}><Trash2 size={16} /></button></div>)}</div>
            <div className="repeat-section"><div className="repeat-heading"><h3>Benefits</h3><button onClick={() => update('benefits', [...project.benefits, { id: crypto.randomUUID(), title: 'New benefit', icon: '/img/olympus-detail/icons/amenity-finish.svg' }])}><Plus size={16} />Add</button></div>{project.benefits.map((item) => <div className="repeat-row benefit-row" key={item.id}><div className="benefit-icon-preview"><img src={item.icon} alt="" /></div><input value={item.title} onChange={(event) => update('benefits', project.benefits.map((current) => current.id === item.id ? { ...current, title: event.target.value } : current))} /><label className="benefit-icon-upload"><input type="file" accept="image/svg+xml,.svg" onChange={(event) => uploadBenefitIcon(item.id, event)} />{uploading === `benefit-${item.id}` ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}Replace SVG</label><button onClick={() => update('benefits', project.benefits.filter((current) => current.id !== item.id))}><Trash2 size={16} /></button></div>)}</div>
          </>}
          {section === 'media' && <>
            <div className="section-heading"><span>03 / Media</span><h2>Visual materials</h2><p>Cover, page imagery, gallery and brochure.</p></div>
            <div className="hero-presentation-panel">
              <div className="presentation-heading"><div><span>Hero presentation</span><strong>{project.heroVariant === 'immersive' ? 'Immersive viewport' : 'Standard editorial'}</strong></div><div className="presentation-switch"><button type="button" className={project.heroVariant === 'standard' ? 'active' : ''} onClick={() => setProject((current) => ({ ...current, heroVariant: 'standard', heroIdleUi: false }))}>Standard</button><button type="button" className={project.heroVariant === 'immersive' ? 'active' : ''} onClick={() => update('heroVariant', 'immersive')}>Immersive</button></div></div>
              <div className="presentation-options">
                <label className={project.heroType !== 'video' ? 'disabled' : ''}><input type="checkbox" checked={project.heroSoundEnabled} disabled={project.heroType !== 'video'} onChange={(event) => update('heroSoundEnabled', event.target.checked)} /><span></span><div><strong>Sound control</strong><small>Allow visitors to enable video sound</small></div></label>
                <label className={project.heroType !== 'video' || project.heroVariant !== 'immersive' ? 'disabled' : ''}><input type="checkbox" checked={project.heroIdleUi} disabled={project.heroType !== 'video' || project.heroVariant !== 'immersive'} onChange={(event) => update('heroIdleUi', event.target.checked)} /><span></span><div><strong>Hide idle interface</strong><small>Let the video take over after inactivity</small></div></label>
              </div>
            </div>
            <div className="media-slots">
              {([['coverUrl', 'Catalog cover'], ['heroUrl', 'Page hero / desktop'], ['introImageUrl', 'Intro image']] as const).map(([field, label]) => <div className="media-slot" key={field}>{project[field] && !(field === 'heroUrl' && project.heroType === 'video') ? <img src={project[field]} alt="" /> : field === 'heroUrl' && project.heroType === 'video' ? <Film size={24} /> : <ImagePlus size={24} />}<div><strong>{label}</strong><span>{project[field] ? field === 'heroUrl' ? `${project.heroType} selected` : 'Image selected' : 'No media'}</span></div><label><input type="file" accept={field === 'heroUrl' ? 'image/*,video/mp4' : 'image/*'} onChange={(event) => uploadSingle(event, field)} />{uploading === field ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}Replace</label></div>)}
              {mediaWorkerEnabled && project.heroType === 'video' && <div className="media-slot"><Film size={24} /><div><strong>Page hero / mobile</strong><span>{project.heroMobileUrl ? 'Mobile video selected' : 'Desktop video will be used'}</span></div><label><input type="file" accept="video/mp4" onChange={(event) => uploadSingle(event, 'heroMobileUrl')} />{uploading === 'heroMobileUrl' ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{project.heroMobileUrl ? 'Replace' : 'Upload'}</label></div>}
              <div className="media-slot"><>{project.heroPosterUrl ? <img src={project.heroPosterUrl} alt="" /> : <ImagePlus size={24} />}</><div><strong>Video poster</strong><span>{project.heroPosterUrl ? 'Poster selected' : 'Shown before video loads'}</span></div><label><input type="file" accept="image/*" onChange={(event) => uploadSingle(event, 'heroPosterUrl')} />{uploading === 'heroPosterUrl' ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}Replace</label></div>
              <div className="media-slot document-slot"><FileText size={26} /><div><strong>PDF brochure</strong><span>{project.brochureUrl ? 'Document attached' : 'No document'}</span></div><label><input type="file" accept="application/pdf" onChange={uploadBrochure} />{uploading === 'brochure' ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}Upload</label></div>
            </div>
            <div className="focal-grid">
              <FocalPointEditor label="Hero focal point" imageUrl={project.heroType === 'image' ? project.heroUrl : project.heroPosterUrl ?? ''} x={project.heroFocalX} y={project.heroFocalY} onChange={(heroFocalX, heroFocalY) => setProject((current) => ({ ...current, heroFocalX, heroFocalY }))} />
              <FocalPointEditor label="Cover focal point" imageUrl={project.coverUrl} x={project.coverFocalX} y={project.coverFocalY} onChange={(coverFocalX, coverFocalY) => setProject((current) => ({ ...current, coverFocalX, coverFocalY }))} />
            </div>
            <ImageCollection title="Catalog card images" images={project.cardImages} onChange={(images) => update('cardImages', images)} onUpload={(files) => uploadFiles(files, 'card')} uploading={uploading === 'card'} />
            <ImageCollection title="Project gallery · original proportions" images={project.gallery} onChange={(images) => update('gallery', images)} onUpload={(files) => uploadFiles(files, 'gallery')} uploading={uploading === 'gallery'} />
          </>}
          {section === 'plans' && <>
            <div className="section-heading"><span>04 / Floor plans</span><h2>Plan collections</h2><p>Group plan images by apartment or villa type.</p></div>
            <div className="plan-groups">{project.floorPlanGroups.map((group) => <article className="plan-group-editor" key={group.id}><div className="plan-group-head"><input value={group.title} onChange={(event) => updatePlanGroup(group.id, { title: event.target.value })} /><button onClick={() => update('floorPlanGroups', project.floorPlanGroups.filter((item) => item.id !== group.id))}><Trash2 size={16} /></button></div>{group.plans.map((plan) => <div className="plan-row" key={plan.id}>{plan.imageUrl ? <img src={plan.imageUrl} alt="" /> : <ImagePlus size={20} />}<input value={plan.title} onChange={(event) => updatePlanGroup(group.id, { plans: group.plans.map((item) => item.id === plan.id ? { ...item, title: event.target.value } : item) })} /><label className="plan-upload"><input type="file" accept="image/*" onChange={(event) => uploadPlanImage(group.id, plan.id, event)} />{uploading === plan.id ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}Upload plan</label><button onClick={() => updatePlanGroup(group.id, { plans: group.plans.filter((item) => item.id !== plan.id) })}><X size={15} /></button></div>)}<button className="add-plan" onClick={() => updatePlanGroup(group.id, { plans: [...group.plans, { id: crypto.randomUUID(), title: 'Floor plan', imageUrl: '', alt: `${project.title} floor plan` }] })}><Plus size={16} />Add plan</button></article>)}</div>
            <button className="secondary-button" onClick={addPlanGroup}><Plus size={17} />Add plan collection</button>
          </>}
          {section === 'seo' && <>
            <div className="section-heading"><span>05 / SEO & URL</span><h2>Search appearance</h2><p>Control the public URL and search engine snippet.</p></div>
            <div className="editor-form-grid"><Field label="Page slug" wide hint={`Public URL: /projects/${normalizedSlug(project.slug)}`}><div className="slug-input"><span>/projects/</span><input value={project.slug} onBlur={() => update('slug', normalizedSlug(project.slug))} onChange={(event) => update('slug', event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'))} /></div></Field><Field label="SEO title" wide hint={`${project.seoTitle.length}/60`}><input value={project.seoTitle} maxLength={60} onChange={(event) => update('seoTitle', event.target.value)} /></Field><Field label="SEO description" wide hint={`${project.seoDescription.length}/160`}><textarea rows={5} value={project.seoDescription} maxLength={160} onChange={(event) => update('seoDescription', event.target.value)} /></Field></div>
            <div className="search-preview"><span>miracon.gr › projects › {project.slug}</span><h3>{project.seoTitle || `${project.title} — MIRACON`}</h3><p>{project.seoDescription || project.shortDescription || 'Add a description to preview the search result.'}</p></div>
          </>}
        </section>
      </div>
      {toast && <div className={`admin-toast ${toast.tone}`} role="status" aria-live="polite">{toast.tone === 'success' ? <Check size={17} /> : <CircleAlert size={17} />}{toast.message}</div>}
      {confirmDelete && <div className="modal-backdrop"><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><span><Trash2 size={20} /></span><h3 id="delete-title">Delete “{project.title}”?</h3><p>The project and its uploaded files will be permanently removed.</p><div><button className="secondary-button" onClick={() => setConfirmDelete(false)}>Cancel</button><button className="danger-button" onClick={removeProject}>Delete permanently</button></div></div></div>}
      {confirmLeave && <div className="modal-backdrop"><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="leave-title"><span><CircleAlert size={20} /></span><h3 id="leave-title">Discard unsaved changes?</h3><p>Your latest edits have not been saved and cannot be restored.</p><div><button className="secondary-button" onClick={() => setConfirmLeave(false)}>Continue editing</button><button className="danger-button" onClick={onBack}>Discard changes</button></div></div></div>}
      {confirmStatus && <div className="modal-backdrop"><div className="confirm-modal status-confirm" role="dialog" aria-modal="true" aria-labelledby="status-title"><span><Check size={20} /></span><h3 id="status-title">{confirmStatus === 'published' ? 'Publish this project?' : 'Remove project from the website?'}</h3><p>{confirmStatus === 'published' ? 'The saved project will become visible to every website visitor.' : 'The project will remain in the desk as a draft and its public page will be unavailable.'}</p><div><button className="secondary-button" onClick={() => setConfirmStatus(null)}>Cancel</button><button className="primary-button" disabled={saving} onClick={async () => { if (await save(confirmStatus)) setConfirmStatus(null); }}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{confirmStatus === 'published' ? 'Publish project' : 'Unpublish'}</button></div></div></div>}
      {previewOpen && <div className="responsive-preview"><header><div><strong>Responsive preview</strong><span>Save changes to refresh database content</span></div><div className="preview-sizes"><button className={previewWidth === 1440 ? 'active' : ''} onClick={() => setPreviewWidth(1440)}>Desktop</button><button className={previewWidth === 768 ? 'active' : ''} onClick={() => setPreviewWidth(768)}>Tablet</button><button className={previewWidth === 390 ? 'active' : ''} onClick={() => setPreviewWidth(390)}>Mobile</button><button className={previewWidth === '100%' ? 'active' : ''} onClick={() => setPreviewWidth('100%')}>Full</button></div><button className="preview-close" onClick={() => setPreviewOpen(false)}><X size={19} /></button></header><div className="preview-stage"><iframe title={`${project.title} responsive preview`} src={`/preview/${project.slug}`} style={{ width: previewWidth === '100%' ? '100%' : `${previewWidth}px` }} /></div></div>}
    </main>
  );
}

export default function AdminApp() {
  const supabase = getBrowserSupabaseClient();
  const demo = !supabase && import.meta.env.DEV;
  const configurationMissing = !supabase && !import.meta.env.DEV;
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(demo);
  const [authorized, setAuthorized] = useState(demo);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>(demo ? structuredClone(seedProjects) : []);
  const [homeHeroVideos, setHomeHeroVideos] = useState<HomeHeroVideo[]>(demo ? structuredClone(fallbackHomeHeroVideos) : []);
  const [view, setView] = useState<AdminView>('projects');
  const [selected, setSelected] = useState<Project | null>(null);
  const [globalToast, setGlobalToast] = useState<Toast>(null);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }

    const client = supabase;
    let active = true;

    async function initializeSession() {
      try {
        const { data: sessionData } = await withTimeout(client.auth.getSession());
        if (!sessionData.session) return;

        const { data: userData, error: userError } = await withTimeout(client.auth.getUser());
        if (userError || !userData.user) return;

        const { data: membership, error: membershipError } = await withTimeout(
          client.from('admin_users').select('user_id').eq('user_id', userData.user.id).maybeSingle(),
        );
        if (membershipError) throw membershipError;
        if (!active) return;

        setAuthenticated(true);
        setAuthorized(Boolean(membership));
        if (membership) await Promise.all([loadProjects(), loadHomeHeroVideos()]);
      } catch (error) {
        if (!active) return;
        setAuthenticated(false);
        setAuthorized(false);
        setLoginError(error instanceof Error ? error.message : 'Unable to connect to Supabase');
      } finally {
        if (active) setReady(true);
      }
    }

    initializeSession();
    return () => {
      active = false;
    };
  }, []);

  async function loadProjects() {
    if (!supabase) return;
    const { data, error } = await withTimeout(
      supabase.from('projects').select('*, project_images(*)').order('sort_order'),
    );
    if (error) setGlobalToast({ tone: 'error', message: error.message });
    else setProjects((data ?? []).map((row) => mapProjectRow(row)));
  }

  async function loadHomeHeroVideos() {
    if (!supabase) return;
    const { data, error } = await withTimeout(
      supabase.from('homepage_videos').select('*').order('sort_order'),
    );
    if (error) setGlobalToast({ tone: 'error', message: `Hero playlist: ${error.message}` });
    else setHomeHeroVideos((data ?? []).map((row) => mapHomeHeroVideo(row)));
  }

  async function login(email: string, password: string) {
    if (!supabase) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      const { data, error } = await withTimeout(supabase.auth.signInWithPassword({ email, password }));
      if (error || !data.user) {
        setLoginError(error?.message ?? 'Unable to sign in');
        return;
      }
      const { data: membership, error: membershipError } = await withTimeout(
        supabase.from('admin_users').select('user_id').eq('user_id', data.user.id).maybeSingle(),
      );
      if (membershipError) throw membershipError;
      setAuthenticated(true);
      setAuthorized(Boolean(membership));
      if (membership) await Promise.all([loadProjects(), loadHomeHeroVideos()]);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to connect to Supabase');
    } finally {
      setLoginLoading(false);
    }
  }

  async function logout() {
    if (demo) return;
    await supabase?.auth.signOut();
    setAuthenticated(false);
    setAuthorized(false);
    setProjects([]);
    setHomeHeroVideos([]);
  }

  async function reorder(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = projects.findIndex((project) => project.id === event.active.id);
    const newIndex = projects.findIndex((project) => project.id === event.over?.id);
    const reordered = arrayMove(projects, oldIndex, newIndex).map((project, index) => ({ ...project, sortOrder: index }));
    setProjects(reordered);
    if (supabase) {
      const { error } = await supabase.rpc('reorder_projects', { p_items: reordered.map((project) => ({ id: project.id, sort_order: project.sortOrder })) });
      if (error) setProjects(projects);
      setGlobalToast(error ? { tone: 'error', message: error.message } : { tone: 'success', message: 'Project order updated' });
    }
  }

  async function importSeed() {
    if (!supabase) return;
    for (const project of seedProjects) {
      const { error } = await supabase.rpc('save_project_with_images', {
        p_project: projectToRow(project),
        p_images: projectImagesToRows(project),
      });
      if (error) {
        setGlobalToast({ tone: 'error', message: error.message });
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
  if (configurationMissing) return <main className="access-denied"><BrandLockup /><CircleAlert size={28} /><h1>Admin is not configured</h1><p>Set the public Supabase URL and key before deploying the project desk.</p></main>;
  if (!authenticated) return <LoginScreen onLogin={login} error={loginError} loading={loginLoading} />;
  if (!authorized) return <main className="access-denied"><BrandMark /><CircleAlert size={28} /><h1>Access not granted</h1><p>This account is authenticated but is not listed in <code>admin_users</code>.</p><button className="secondary-button" onClick={logout}><LogOut size={16} />Sign out</button></main>;

  return (
    <div className="admin-app">
      {!selected && <aside className="admin-rail"><BrandLockup /><nav><button className={view === 'projects' ? 'active' : ''} title="Projects" onClick={() => setView('projects')}><LayoutGrid size={19} /><span>Projects</span></button><button className={view === 'home-hero' ? 'active' : ''} title="Homepage hero" onClick={() => setView('home-hero')}><Film size={19} /><span>Home hero</span></button><a href="/" target="_blank" rel="noreferrer"><ExternalLink size={19} /><span>View website</span></a></nav><div><span className="rail-env">{demo ? 'LOCAL MODE' : 'LIVE WORKSPACE'}</span>{!demo && <button onClick={logout} title="Sign out"><LogOut size={18} /><span>Sign out</span></button>}</div></aside>}
      {demo && !selected && <div className="demo-banner">Local demo mode · connect Supabase to persist changes and upload media</div>}
      {selected
        ? <ProjectEditor initialProject={selected} onBack={() => setSelected(null)} onSaved={saveToState} onDeleted={deleteFromState} demo={demo} />
        : view === 'home-hero'
          ? <HomeHeroManager initialVideos={homeHeroVideos} projects={projects} demo={demo} onSaved={setHomeHeroVideos} onToast={setGlobalToast} />
          : <ProjectList projects={projects} onOpen={setSelected} onCreate={() => setSelected(emptyProject(projects.length))} onReorder={reorder} onImport={importSeed} canImport={!demo && projects.length === 0} />}
      {globalToast && <div className={`admin-toast ${globalToast.tone}`} role="status" aria-live="polite">{globalToast.tone === 'success' ? <Check size={17} /> : <CircleAlert size={17} />}{globalToast.message}</div>}
    </div>
  );
}
