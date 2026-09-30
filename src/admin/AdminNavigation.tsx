import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Film,
  Inbox,
  LayoutGrid,
  Palette,
  ScrollText,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type AdminNavView = 'projects' | 'home-hero' | 'pages' | 'contacts' | 'branding' | 'legal' | 'proposals' | 'users';

type NavItem = {
  view: AdminNavView;
  label: string;
  description: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
};

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Content',
    items: [
      { view: 'projects', label: 'Projects', description: 'Manage project listings', icon: LayoutGrid },
      { view: 'home-hero', label: 'Homepage hero', description: 'Featured media and projects', icon: Film },
      { view: 'pages', label: 'Page text', description: 'Edit website copy', icon: FileText },
    ],
  },
  {
    label: 'Inbox',
    items: [
      { view: 'contacts', label: 'Enquiries', description: 'Messages from visitors', icon: Inbox },
      { view: 'proposals', label: 'Review changes', description: 'Approve proposed edits', icon: Inbox, ownerOnly: true },
    ],
  },
  {
    label: 'Site',
    items: [
      { view: 'branding', label: 'Brand & contacts', description: 'Logo, color and footer details', icon: Palette },
      { view: 'legal', label: 'Legal PDFs', description: 'Website documents', icon: ScrollText },
      { view: 'users', label: 'Team', description: 'Manage access', icon: Users, ownerOnly: true },
    ],
  },
];

type AdminNavigationProps = {
  view: AdminNavView;
  onChange: (view: AdminNavView) => void;
  isOwner: boolean;
  pendingProposalsCount: number;
};

export default function AdminNavigation({ view, onChange, isOwner, pendingProposalsCount }: AdminNavigationProps) {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = groups.flatMap((group) => group.items).find((item) => item.view === view);

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const closeOutside = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [open]);

  return (
    <nav className="admin-navigation" aria-label="Admin sections" ref={navRef}>
      <button
        ref={triggerRef}
        type="button"
        className="admin-nav-trigger"
        aria-expanded={open}
        aria-controls="admin-nav-menu"
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="admin-nav-trigger-text">
          <span className="admin-nav-trigger-caption">{open ? 'Close menu' : 'Sections menu'}</span>
          <strong>{current?.label ?? 'Choose section'}</strong>
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <div id="admin-nav-menu" className={`admin-nav-menu${open ? ' is-open' : ''}`}>
        {groups.map((group) => (
          <section className="admin-nav-group" aria-label={group.label} key={group.label}>
            <h2 className="admin-nav-heading">{group.label}</h2>
            {group.items.filter((item) => !item.ownerOnly || isOwner).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.view}
                  data-admin-view={item.view}
                  type="button"
                  className={`admin-nav-item${view === item.view ? ' active' : ''}`}
                  aria-current={view === item.view ? 'page' : undefined}
                  onClick={() => {
                    onChange(item.view);
                    setOpen(false);
                  }}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span className="admin-nav-copy">
                    <span className="admin-nav-title">{item.label}</span>
                    <span className="admin-nav-description">{item.description}</span>
                  </span>
                  {item.view === 'proposals' && pendingProposalsCount > 0 && (
                    <span className="nav-counter-badge" aria-label={`${pendingProposalsCount} pending changes`}>{pendingProposalsCount}</span>
                  )}
                </button>
              );
            })}
          </section>
        ))}
        <a className="admin-nav-item admin-nav-external" href="/" target="_blank" rel="noopener noreferrer">
          <ExternalLink size={19} aria-hidden="true" />
          <span className="admin-nav-copy">
            <span className="admin-nav-title">Open website</span>
            <span className="admin-nav-description">Preview the public site</span>
          </span>
        </a>
      </div>
    </nav>
  );
}
