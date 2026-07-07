/* ============================================================================
   PeopleFlow design tokens — shared Tailwind config (themable).

   Loaded after the Tailwind Play CDN script and before the first paint of
   utility classes. Color tokens are wired as follows:

   - SEMANTIC tokens (base, surface, surface2, elevated, line, ink, muted)
     are NOT defined as literal colors here. They are read from CSS custom
     properties on `:root[data-theme=".."]` (declared in assets/base.css)
     as space-separated RGB channels (e.g. `12 9 18`). Each token is then
     resolved through `rgb(var(--token) / <alpha-value>)`, which lets
     Tailwind opacity utilities keep working (`bg-base/40`, `text-muted/70`,
     `border-line/60`, `bg-surface/40`, etc.) and respects the live theme
     because the CSS var updates the moment `data-theme` flips.

   - ACCENT tokens (brand, glow, cyan, grass, magenta) are the brand identity
     and stay FIXED across themes. Adjust their luminosity only if they look
     illegible on a particular surface.

   - Theme switch API: this file also exposes `window.PFTheme.toggle()` for
     the toggle button (see assets/theme-toggle.js). The actual pre-paint
     application of `data-theme` lives in an INLINE script in <head> (see
     assets/theme-toggle.html) — it must run before Tailwind processes so
     no flash occurs.
   ============================================================================ */

(function () {
  /* --------------------- 1. Tailwind config extension --------------------- */
  /* Semantic tokens → resolve from CSS vars at render time. The `<alpha-value>`
     placeholder is replaced by Tailwind's engine with the alpha from each
     `bg-base/40`-style class. Channel-form `rgb(R G B / A)` with a var inside
     is supported in all modern browsers (Chrome 65+, Firefox 55+, Safari 12.1+). */
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          base:     'rgb(var(--base) / <alpha-value>)',
          surface:  'rgb(var(--surface) / <alpha-value>)',
          surface2: 'rgb(var(--surface2) / <alpha-value>)',
          elevated: 'rgb(var(--elevated) / <alpha-value>)',
          line:     'rgb(var(--line) / <alpha-value>)',
          ink:      'rgb(var(--ink) / <alpha-value>)',
          muted:    'rgb(var(--muted) / <alpha-value>)',

          /* Accent — brand identity, fixed in both themes */
          brand:   '#9336EA',
          glow:    '#B266FF',
          cyan:    '#22D3EE',
          grass:   '#22C55E',
          magenta: '#D946EF',
        },
        fontFamily: {
          display: ['"Clash Display"', 'system-ui', 'sans-serif'],
          sans: ['Inter', 'system-ui', 'sans-serif'],
          mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        },
      },
    },
  };

  /* --------------------- 2. Theme switching API ----------------------------- */
  /* Public helpers used by the toggle button. The inline anti-flash script in
     <head> owns the *initial* application of `data-theme`; this file owns
     the runtime toggle behavior and localStorage persistence. */
  const STORAGE_KEY = 'pf-theme';
  const THEMES = ['dark', 'light'];

  function getStored() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_e) {
      return null;
    }
  }

  function setStored(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (_e) {
      /* swallow (private mode, quota) */
    }
  }

  function currentTheme() {
    const attr = document.documentElement.getAttribute('data-theme');
    return THEMES.includes(attr) ? attr : 'dark';
  }

  function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    setStored(theme);
    /* Let any toggle button (and other listeners) re-sync icons/labels. */
    document.dispatchEvent(new CustomEvent('pf:themechange', { detail: { theme } }));
  }

  function toggleTheme() {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  /* Expose a tiny global API for the toggle button. Avoids polluting window
     with random globals — only one entry point: `window.PFTheme`. */
  window.PFTheme = {
    current: currentTheme,
    apply: applyTheme,
    toggle: toggleTheme,
    THEMES,
    STORAGE_KEY,
  };
})();
