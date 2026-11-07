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
- Use `SegmentedControl` for mutually exclusive inline choices. Its default appearance is the existing
  Theme Mode selector. Keep existing text sizes and weights through `typographyClassName`; compact
  toolbars can retain their dimensions with `itemClassName`. Do not give each consumer a separate
  selected-state palette or corner style. Dropdown menus, sliders and navigation tabs keep their own
  interaction semantics.
- Segmented controls expose one selected button and tab stop, arrow/Home/End navigation, disabled
  skipping and RTL support. Use `preserveFocus` for pointer-operated search filters so input focus
  stays in the associated search field.
- Use `TabsRoot` with `TabsList`, `TabsTrigger` and `TabsContent` for navigation between panels.
  Pass `unstyled` to those three parts when adopting them in an established design: it adds no
  presentation classes, inline styles or root wrapper. Keep the feature's existing classes and
  dimensions verbatim. The existing styled `Tabs` API retains its defaults.
- Provide the ordered tab values through `items` for dynamic navigation. Shared navigation owns
  one tab stop, selection, disabled skipping, arrow/Home/End keys and tab/panel IDs. Use
  `orientation="auto"` for a tab bar whose CSS switches between a row and a column.
- `useTabNavigation` exposes the same behavior for custom selection lists. Terminal panes and
  delegated-task rows use `selectionMode="buttons"` because several destinations can be visible
  together; keep their existing buttons and `aria-pressed` state. Row actions and rename editors
  remain separate controls. Use `getItemContainerProps` for rows with actions so removal and rename
  can recover focus without moving it away from another focused region.
- Feature-specific drag, reorder, close and split actions remain feature-owned. Their handlers run
  before shared keyboard handling; cancelled events and modified keys are respected.
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
- `motion-editor`: subtle reveal for an explicitly opened message editor.
- `motion-history`: quiet pending fade during conversation history changes.
- Spatial movement is disabled under `prefers-reduced-motion`.

## Status and feedback

Use `LoadingState`, `EmptyState`, `ErrorState`, and `StatusBadge` for consistent feedback. Use semantic `success`, `warning`, and `danger` tokens rather than palette-specific colors.

## Loading

- Keep the screen, panel or dialog frame visible. Place pending content inside that frame.
- Use `LoadingState` for a named initial load; `variant="inline"` fits smaller regions.
- Use `LoadingSkeleton` to announce a pending list once; its rows use the actual presentation through `SkeletonSurface`.
- Keep existing content during background refetches. Show a local indicator instead of replacing useful data.
- Use `Spinner` for busy controls. Set `aria-hidden="true"` when the parent already names or announces the work; label standalone spinners.
- `Button isLoading` retains its label, reserves the spinner slot and prevents duplicate clicks. Pass a boolean in both states to keep width stable. `IconButton isLoading` retains its accessible name.
- Use `Progress` with a real percentage when available; omit `value` for indeterminate work. Keep cancellation controls usable.
- Loading primitives use semantic color, icon and typography tokens and respect reduced motion. Live views and skeletons share lightweight presentation layouts; placeholders fill their content slots. Data hooks and action handlers stay in the live views.
- For a presentation that can render safely with known/default props, use `SkeletonSurface pending={loading}` around the actual view. It derives masks from rendered text, icons and controls; additions and conditional sections need no separate placeholder markup. Keep data fetching, subscriptions and service actions in the live controller: masking a component does not prevent its hooks from running.
- `SkeletonSurface` follows DOM mutations, resizing, scrolling and font loading, clips overflow and respects reduced motion. Nested surfaces announce loading once and pending content is hidden and inert. Unknown server conditions and list lengths still require default or cached data.
- Agent thinking and streaming feedback retain their dedicated indicators.

## Radius hierarchy

The foundation values remain `sm: 0.25rem`, `md: 0.5rem`, `lg: 0.75rem` and `xl: 1rem`.
Compact and default controls use `--radius-md`; large controls use `--radius-lg`.
Cards use `rounded-lg`; the shared dialog uses `rounded-xl`; pills and status dots use
`rounded-full`. Established feature panels and selectors may have their own explicit rounding.
Preserve those choices when sharing behavior; this table is not a bulk migration instruction.

## Standardization without redesign

Existing feature appearances are supported designs. Refactor behavior behind their current DOM,
classes and slots. Do not replace custom segmented selectors with action buttons, apply new font
roles to existing text, or bulk-normalize spacing, radii or palette classes. A visual redesign is
separate work.

1. **Status:** use `StatusBadge` for the shared status vocabulary. Its default badge appearance stays
   unchanged. Use `appearance="plain"`, an explicit label and the feature's existing classes when
   adopting it in an established inline status. This preserves the existing dot, icon, typography
   and palette choices; it does not add a badge background or a second indicator.
2. **Forms:** `FormField` owns the normal shared field layout. Custom forms use
   `useFieldAccessibility` to share label/description/error IDs and required semantics without adding
   layout wrappers. Keep validation rules in the feature. Focus the first invalid field, retain entered
   data on failure, and clear an editor only after successful persistence. Existing validation copy
   and presentation remain owned by the form.
3. **Actions:** `Button` and `IconButton` share `actionVariants`. They default to `type="button"`;
   submit actions explicitly use `type="submit"`. Loading blocks repeat activation. Icon actions need
   an accessible name. Inline choice selectors use `SegmentedControl`, retaining their labels, icons and existing typography.
4. **Dialogs:** use the existing Radix-based `Dialog` and `ConfirmationModal`. Controlled dialogs
   restore the focused opener unless the consumer handles close focus. The caller owns confirmation
   completion and pending state. Pending confirmations block Escape, outside dismissal and both
   action buttons; failed operations keep the dialog available for retry or cancellation.
5. **Feedback:** `EmptyState` and `ErrorState` share content slots while keeping their different
   padding, icons and recovery behavior. The existing application toaster remains the success/error
   host. `shared/lib/feedback.ts` owns safe error-copy fallback; operation owners retain their contextual
   messages and notification options. Do not emit a second notification for the same mutation.
6. **Type and geometry:** the existing foundation CSS remains the source of truth. `controlSizes`
   shares the current compact/default/large aliases across buttons and inputs. Keep existing feature
   overrides, user font settings and selector dimensions. The appearance-contract tests cover the
   shared control variants, feedback, confirmation layout, theme modes, MCP form layouts and stylesheet
   values. Change those baselines only for an intentional design change.
