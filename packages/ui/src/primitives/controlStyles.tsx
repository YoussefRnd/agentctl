// Keep these classes in the existing shared Tailwind source glob (*.tsx).
/** Existing appearances shared by action primitives; selectors retain their own presentation. */
export const actionVariants = {
  solid: 'bg-accent text-brand-crust hover:opacity-90 click-press',
  outline: 'bg-transparent border border-border hover:bg-white/5 text-text-main click-press',
  ghost: 'bg-transparent hover:bg-white/5 text-text-muted hover:text-text-main click-press',
  danger: 'bg-danger text-white hover:opacity-90 click-press',
} as const;

/** Legacy and descriptive sizes resolve to the same existing CSS foundation classes. */
export const controlSizes = {
  sm: 'control-compact',
  compact: 'control-compact',
  md: 'control-default',
  default: 'control-default',
  lg: 'control-large',
  large: 'control-large',
} as const;
