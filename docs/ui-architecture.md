# UI ownership and acceptance

`@agentctl/ui` exposes its root component API and `theme.css`. Foundations own semantic color,
typography, spacing, elevation and motion tokens. Primitive directories own one generic
interaction; patterns compose generic layout/feedback; components own reusable controlled
presentation. App features own session/provider/workspace data, queries, mutations and routing.
The package boundary checker rejects product packages, application imports, Node runtime,
query/store/router dependencies and networking. Public entry enforcement rejects relative
source bypasses as well as undeclared package subpaths.

| Accepted area                                     | Review and retained design                                                                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundations and theme                             | Keep existing token layers and reduced-motion policy; no app state, runtime initialization or hidden networking                                                                                                                       |
| Button, IconButton, Input, Kbd                    | Keep controlled DOM props, explicit accessible icon labels, loading/disabled behavior, semantic size aliases and focus styles                                                                                                         |
| Dialog, Dropdown, Popover, Switch                 | Keep Radix interaction owners and bounded floating surfaces; caller supplies labels and product action policy; no second overlay framework                                                                                            |
| Select                                            | Keep the established menu-based picker; selected items expose `menuitemradio`/`aria-checked`; forward label, description, error and required semantics to the trigger                                                                 |
| SegmentedControl                                  | Keep Theme Mode's existing appearance, controlled exclusive choices, one tab stop, disabled skipping, RTL-aware arrow/Home/End keys and input-preserving pointer selection; feature adapters retain typography and compact dimensions |
| Tabs                                              | Keep roving focus/automatic selection, disabled skipping and Home/End behavior; compose consumer key/click handlers and respect preventDefault                                                                                        |
| Tooltip                                           | Keep delayed and recently-active presentation; balance global activity through effect lifetime; label the focused child with a tooltip description; never move focus on open/close                                                    |
| FormField                                         | Own label and validation IDs; only reference a rendered description; propagate validation to Input and Select                                                                                                                         |
| ConfirmationModal                                 | Keep generic confirmation policy and pending state; use DialogDescription so confirmation text is accessible                                                                                                                          |
| Card, GlassPanel, Badge, SkeletonSurface, Spinner | Keep distinct surface, decoration and progress responsibilities; status vocabulary remains generic                                                                                                                                    |
| SearchBar, SearchHighlight                        | Keep controlled search input/clear action and pure text matching; caller owns search execution                                                                                                                                        |
| ImagePreview                                      | Keep URL/status/retry inputs; caller owns upload lifecycle; local view state and explicit dialog label belong here                                                                                                                    |
| MessageEditor                                     | Keep controlled async save/error presentation and IME-safe keyboard behavior; caller owns persistence                                                                                                                                 |
| EmptyState, ErrorState, LoadingState              | Keep distinct feedback semantics and caller-supplied action/retry callbacks                                                                                                                                                           |
| ListRow, PageHeader, SplitPanel, StatusBadge      | Keep generic layout/status composition; product labels and permissions stay in consuming features                                                                                                                                     |
| Web gallery and feature adapters                  | Gallery stays app-owned and lazily loaded only in development or an explicit gallery build; composer/settings/session previews use reviewed public feature entries                                                                    |

No product composition required relocation. Existing semantic aliases remain supported; components
with different focus, overlay or layout responsibilities are deliberately retained separately.
The acceptance inventory covers all UI source/CSS files through the workspace ownership ledger.

`pnpm ui:check` creates an isolated gallery build and reviews the actual `/_dev/ui` route in
Chrome with synthetic read-only API fixtures. It captures desktop and narrow viewport screenshots,
checks page containment, dialog naming, initial focus, Escape dismissal and focus restoration.
The normal production build excludes the gallery. `accessibility.test.tsx` tests public exports,
select validation IDs, tab keyboard behavior, confirmation text/Escape and tooltip keyboard focus;
existing FormField and MessageEditor tests remain. Both renderer builds and app journey checks
exercise consuming adapters. This is focused accessibility acceptance, not a claim of an exhaustive
assistive-technology or WCAG audit.

## Loading feedback

`Spinner` is the shared glyph for controls and `LoadingState` composes it with a single polite
status. `SkeletonSurface` derives placeholder shapes, color and motion; `LoadingSkeleton` announces a whole
placeholder group once. `Progress` distinguishes measured percentages from indeterminate work.
Busy buttons keep their label, reserve the indicator slot and block duplicate submissions.
Regression tests in `packages/ui/src/loading.test.tsx` cover status semantics, decorative glyphs,
button recovery and progress bounds. Appearance follows the existing theme and semantic size tokens.

SkeletonSurface derives loading masks from an actual presentation tree. Its observer lifetime is
limited to pending surfaces, nested regions share their status, and the live DOM remains mounted
when loading ends. It does not sandbox child effects: fetches, subscriptions and provider actions
remain in feature controllers. SkeletonSurface.test.tsx exercises automatic additions, conditions,
resizing, scrolling, interaction blocking, cleanup and state preservation.
