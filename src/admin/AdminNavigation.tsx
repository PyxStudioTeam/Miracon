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

export type AdminNavView = 'projects' | 'home-hero' | 'pages-home' | 'pages-visa' | 'pages-shared' | 'contacts' | 'branding' | 'legal' | 'proposals' | 'users';

type NavItem = {
  view: AdminNavView;
  label: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
  page?: boolean;
  homepageSection?: boolean;
};

const groups: { id: string; label: string; items: NavItem[] }[] = [
  {
    id: 'content',
    label: 'Content',
    items: [
      { view: 'projects', label: 'Projects', icon: LayoutGrid },
      { view: 'home-hero', label: 'Hero videos', icon: Film, page: true, homepageSection: true },
      { view: 'pages-home', label: 'Page text', icon: FileText, page: true, homepageSection: true },
      { view: 'pages-visa', label: 'Golden Visa', icon: FileText, page: true },
      { view: 'pages-shared', label: 'Shared blocks', icon: FileText, page: true },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    items: [
      { view: 'contacts', label: 'Enquiries', icon: Inbox },
      { view: 'proposals', label: 'Review changes', icon: Inbox, ownerOnly: true },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { view: 'branding', label: 'Logo, name & contacts', icon: Palette },
      { view: 'legal', label: 'Legal documents', icon: ScrollText },
      { view: 'users', label: 'Users', icon: Users, ownerOnly: true },
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
  const currentGroup = groups.find((group) => group.items.some((item) => item.view === view)) ?? groups[0];
  const [expandedGroup, setExpandedGroup] = useState(currentGroup.id);
  const current = currentGroup.items.find((item) => item.view === view);

  useEffect(() => {
    setExpandedGroup(currentGroup.id);
  }, [currentGroup.id]);

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
          <span className="admin-nav-trigger-caption">{open ? 'Close menu' : currentGroup.label}</span>
          <strong>{current?.label ?? 'Choose section'}</strong>
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <div id="admin-nav-menu" className={`admin-nav-menu${open ? ' is-open' : ''}`}>
        {groups.map((group) => (
          <section className="admin-nav-group" aria-label={group.label} key={group.id}>
            <h2>
              <button
                type="button"
                className="admin-nav-heading"
                aria-expanded={expandedGroup === group.id}
                aria-controls={`admin-nav-${group.id}`}
                onClick={() => setExpandedGroup((currentId) => currentId === group.id ? '' : group.id)}
              >
                {group.label}<ChevronDown size={15} aria-hidden="true" />
              </button>
            </h2>
            <div id={`admin-nav-${group.id}`} className="admin-nav-group-items" hidden={expandedGroup !== group.id}>
              {group.items.filter((item) => !item.ownerOnly || isOwner).map((item) => {
                const Icon = item.icon;
                const active = item.view === view;
                return (
                  <div key={item.view}>
                    {item.view === 'home-hero' && <><h3 className="admin-nav-subheading">Pages</h3><h4 className="admin-nav-page-heading">Homepage</h4></>}
                    <button
                      data-admin-view={item.view}
                      type="button"
                      className={`admin-nav-item${item.page ? ' is-page' : ''}${item.homepageSection ? ' is-homepage-section' : ''}${active ? ' active' : ''}`}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => {
                        onChange(item.view);
                        setOpen(false);
                      }}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span className="admin-nav-title">{item.label}</span>
                      {item.view === 'proposals' && pendingProposalsCount > 0 && (
                        <span className="nav-counter-badge" aria-label={`${pendingProposalsCount} pending changes`}>{pendingProposalsCount}</span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <a className="admin-nav-item admin-nav-external" href="/" target="_blank" rel="noopener noreferrer">
          <ExternalLink size={18} aria-hidden="true" />
          <span className="admin-nav-title">Open website</span>
        </a>
      </div>
    </nav>
  );
}
