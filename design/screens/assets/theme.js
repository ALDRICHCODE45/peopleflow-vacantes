/* PeopleFlow design tokens — shared Tailwind config for all screen mockups.
   Loaded after the Tailwind Play CDN script, before it processes. */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        base: '#0C0912',
        surface: '#15121F',
        surface2: '#171226',
        elevated: '#1A1626',
        line: '#262233',
        ink: '#F6F2FF',
        muted: '#A79FBF',
        brand: '#9336EA',
        glow: '#B266FF',
        cyan: '#22D3EE',
        grass: '#22C55E',
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
