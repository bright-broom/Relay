/** The only three source colors. Every surface, state and interaction derives here. */
export const palette = {
  main: '#0B0B0D',
  sub: '#FFFFFF',
  accent: '#0171E3',
} as const;

type PaletteRole = keyof typeof palette;
const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const mix = (base: string, overlay: string, amount: number) => {
  const target = channels(overlay);
  return '#' + channels(base).map((value, i) => Math.round(value * (1 - amount) + target[i] * amount).toString(16).padStart(2, '0')).join('').toUpperCase();
};
const alpha = (hex: string, opacity: number) => `rgb(${channels(hex).join(' ')} / ${opacity})`;

/** base + overlay × amount; no independent gray or status palette. */
/** @public Invoked by scripts/check.ts; source is loaded through esbuild. */
export const colorRecipes = {
  'surface': ['sub', 'main', 0], 'subtle': ['sub', 'main', 0.035],
  'input': ['sub', 'main', 0], 'ink': ['main', 'sub', 0],
  'muted': ['main', 'sub', 0.36], 'line': ['sub', 'main', 0.10],
  'control': ['main', 'sub', 0.45],
  'accent': ['accent', 'main', 0], 'accent-hover': ['accent', 'main', 0.14],
  'accent-pressed': ['accent', 'main', 0.26], 'on-accent': ['sub', 'main', 0],
} as const satisfies Record<string, readonly [PaletteRole, PaletteRole, number]>;
/** @public Invoked by scripts/check.ts; source is loaded through esbuild. */
export const colorTokens = Object.fromEntries(Object.entries(colorRecipes).map(([key, [base, overlay, amount]]) =>
  [key, mix(palette[base], palette[overlay], amount)]
)) as Record<keyof typeof colorRecipes, string>;

/** Shared scales. Framework-independent source; never edit generated CSS. */
const primitives = {
  'font': 'system-ui, -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif',
  'text-sm': '0.875rem', 'text-base': '1rem',
  'text-md': '1.125rem', 'text-lg': '1.5rem', 'text-xl': '2rem',
  'title-mobile': '1.5rem', 'metric-size': '1.5rem',
  'medium': '500', 'semibold': '600', 'leading': '1.75', 'heading-leading': '1.4', 'section-leading': '1.5', 'label-leading': '1.5', 'letter-normal': '0', 'space-0': '0', 'space-1': '0.25rem', 'space-2': '0.5rem', 'space-3': '0.75rem',
  'space-4': '1rem', 'space-5': '1.5rem', 'space-6': '2rem', 'space-7': '3rem',
  'radius-sm': '0.25rem', 'radius-card': '0.25rem', 'radius-panel': '0.5rem', 'radius-pill': '999px',
  'border-width': '1px', 'focus-width': '2px', 'focus-gap': '3px',
  'action': '3rem', 'touch': '2.75rem', 'row': '3.5rem', 'icon': '1.25rem',
  'sidebar': '4.5rem', 'topbar': '3rem', 'content-max': '96rem', 'reading': '45rem',
  'aside': '21rem', 'table-min': '52rem', 'field-min': '8rem', 'dialog-max': '44rem',
  'desktop-gutter': '3rem', 'mobile-gutter': '1.5rem', 'backdrop': alpha(palette.main, 0.35), 'floating-shadow': `0 16px 64px ${alpha(palette.main, 0.14)}`,
  'fast': '160ms', 'reduced-motion': '0ms',
  'disabled-opacity': '0.55', 'nav-z': '10', 'toast-z': '30',
  } as const;

/** Roles are bound once here; component CSS must not pick a new size. */
const componentTokens = {
  'type-page': primitives['text-lg'], 'type-page-mobile': primitives['title-mobile'],
  'type-section': primitives['text-md'], 'type-subheading': primitives['text-md'],
  'type-body': primitives['text-base'], 'type-label': primitives['text-sm'],
  'price-amount': '3rem', 'price-amount-wide': '4rem',
  'price-secondary': primitives['text-xl'], 'price-content-max': '68rem',
  'price-bar-height': primitives['space-3'],
  // Runtime comparison ratio; it does not define a new design value.
  'comparison-share': '0%',
  'gap-related': primitives['space-3'], 'gap-group': primitives['space-5'],
  'gap-section': primitives['space-7'], 'panel-padding': primitives['space-5'],
  // 72:44 approximates the golden ratio; narrow screens use 64px while preserving the 44px target.
  'sidebar-mobile': '4rem',
  'sidebar-mobile-padding': 'calc((var(--sidebar-mobile) - var(--touch) - var(--border-width)) / 2)',
  'rail-padding': 'calc((var(--sidebar) - var(--touch) - var(--border-width)) / 2)', 'tooltip-max': '14rem', 'notification-dot': primitives['space-2'],
  'narrow-gutter': primitives['space-4'], 'tablet-gutter': primitives['space-6'],
  'confirmation-overlay-z': '30', 'confirmation-z': '31',
  'overlay-z': '20', 'dialog-z': '21', 'tooltip-z': '40',
  'safe-inline-start': 'env(safe-area-inset-left)', 'safe-inline-end': 'env(safe-area-inset-right)',
  'viewport-block': '100dvh', 'viewport-offset': '0px',
} as const;

export const tokens = { ...colorTokens, ...primitives, ...componentTokens } as const;

/** @public Invoked by scripts/build.ts; source is loaded through esbuild. */
export const breakpoints = { narrow: '30rem', mobile: '48rem', compact: '64rem', short: '32rem', columns: '36rem', table: '56rem' } as const;
