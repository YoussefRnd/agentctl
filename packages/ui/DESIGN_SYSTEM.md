# Agentctl UI design system

Shared primitives and semantic foundation classes are the source of truth for application UI. Prefer extending them over adding one-off combinations in feature code.

## Surfaces

- Use `GlassPanel` for major application regions.
- Use `bounded-glass-shell` outside `bounded-glass-surface` for floating glass UI. The shell owns the shadow; the surface owns blur, border, highlight, and clipping.
- Use `Card` for nested content. Cards are translucent surfaces by default and only blur with `intensity="high"`.
- Do not nest backdrop filters. Content inside a glass region should normally use a solid or translucent surface.

## Controls

- `control-compact`: 28px dense controls.
- `control-default`: 32px standard controls.
- `control-large`: 36px prominent controls.
- Use `Button`, `IconButton`, `Input`, and `Select` instead of recreating their interaction states.
- Disclosure controls must remain geometrically stable. Use `motion-disclosure`; do not add click scaling.
- Restrict `click-press` to primary or destructive actions.

## Typography

- `text-role-title`: section and state titles.
- `text-role-heading`: larger page headings.
- `text-role-body`: descriptions and body copy.
- `text-role-control`: buttons, fields, menus, and compact selectors.
- `text-role-label`: form and metadata labels.
- `text-role-caption`: supporting metadata.
- `text-role-eyebrow`: short uppercase section labels.
- `text-role-code`: identifiers and code values.

## Icons

- `icon-inline`: 12px metadata icons.
- `icon-compact`: 14px toolbar icons.
- `icon-default`: 16px standard controls.
- `icon-prominent`: 20px status and prominent action icons.
- Reserve larger icons for empty states and illustrations.

## Motion

- `motion-disclosure`: color-only trigger transitions.
- `motion-floating`: short fade and directional movement for menus and popovers.
- `motion-dialog`: restrained dialog entrance and exit.
- Spatial movement is disabled under `prefers-reduced-motion`.

## Status and feedback

Use `LoadingState`, `EmptyState`, `ErrorState`, and `StatusBadge` for consistent feedback. Use semantic `success`, `warning`, and `danger` tokens rather than palette-specific colors.

## Radius hierarchy

- Small items: `rounded-md`.
- Standard controls and menus: `rounded-lg`.
- Floating feature panels: `rounded-xl`.
- Dialogs and major panels: `rounded-2xl`.
- Pills and compact selectors: `rounded-full`.
