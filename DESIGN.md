# MIRACON Design System

## 1. Atmosphere & Identity
MIRACON pairs a warm cream editorial surface with deep Aegean blue, restrained gold, video-led real-estate imagery, and translucent header controls. Preserve the established Gilroy typography, glass treatment, and purposeful CTA motion; responsive work must reflow existing content rather than alter the visual direction.

## 2. Color
| Role | Token | Value | Usage |
|---|---|---|---|
| Page surface | `--page-bg` / `--mobile-cream` | `#F7F4EE` | Page and compact surfaces |
| Primary blue | `--blue` | `#003C7B` | Brand controls and emphasis |
| Text blue | `--text` / `--mobile-blue` | `#00306A` / `#003075` | Editorial copy and mobile controls |
| Gold | `--gold` / `--mobile-gold` | `#B9853D` / `#B68A3D` | Section accents and links |
| White | `--white` | `#FFFFFF` | Inverse text and glass borders |
| Glass | `--glass` | `rgba(144, 144, 144, .1)` | Header navigation material |

## 3. Typography
- Primary family: `Gilroy`, with the existing `Plus Jakarta Sans` and Arial fallbacks.
- Desktop hero: 116px base, fluid below the 1920px composition.
- Compact homepage hero: `clamp(40px, 12vw, 48px)` with a dedicated, smaller Greek range.
- Header and filter labels retain their existing local scales; Greek remains naturally wrappable where the local rules allow it.

## 4. Spacing & Layout
- Content frame: `--frame-width: 1720px`; desktop gutters progressively reduce below 1920px and compact gutters are 20px.
- Homepage ownership: `mobile.css` owns the compact header and the only `<=600px` homepage hero flow. `style.css` owns desktop hero geometry from 601px upward and the desktop header grid from 1280px upward.
- Inner-page ownership: `inner-mobile.css` owns inner compact headers through 1279px and inner mobile hero flow through 760px. Desktop header controls resume at 1280px.
- The 1279px-to-1280px boundary is deliberate: compact controls below it, a three-column header grid at and above it.

## 5. Components
### Site Header
- **Structure**: logo, navigation, language control, contact control, compact language control, compact menu.
- **Variants**: desktop at `>=1280px`; compact below the boundary.
- **States**: visible, hidden-on-scroll, menu open, contact disclosure, hover, focus-visible.
- **Accessibility**: hidden controls are not keyboard targets; the compact menu exposes its state with ARIA.

### Homepage Hero
- **Structure**: media, subtitle, authored two-line title, stacked CTAs, scroll indicator.
- **Variants**: desktop composition from 601px; one natural compact flow at `<=600px`.
- **States**: video layer active, CTA hover/focus, reduced motion.
- **Layout**: content must never overlap the title or between CTAs.

### Project Filter Tabs
- **Structure**: real text label inside the tab plus a decorative circle layer.
- **States**: default, hover, focus-visible, active/pressed.
- **Accessibility**: one rendered label only; no pseudo-element label duplication.

## 6. Motion & Interaction
- Existing control transitions use roughly 150-420ms easing and must remain transform/opacity/color based.
- Keep `prefers-reduced-motion` overrides intact. No motion is added by this normalization.

## 7. Depth & Surface
MIRACON uses a mixed strategy: warm tonal cards, soft existing shadows, and the existing blurred glass gradient for header controls. Do not flatten or replace those materials while correcting responsive geometry.

## 8. Accessibility Constraints & Accepted Debt
- Maintain visible focus, keyboard-safe hidden header controls, no horizontal viewport overflow, and natural Greek wrapping without text or CTA collision.
- Accepted debt: legacy Figma-derived dimensions and raw values remain outside this responsive-ownership patch. They are documented, not consolidated, to avoid a visual redesign.
