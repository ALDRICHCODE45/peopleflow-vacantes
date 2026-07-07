/* ============================================================================
   PeopleFlow theme toggle button behavior.

   Usage (markup):
     <button data-pf-theme-toggle type="button" aria-label="Cambiar tema"
             class="relative grid h-9 w-9 place-items-center rounded-lg border border-line text-muted transition hover:border-brand/60 hover:text-ink">
       <i data-lucide="moon" class="pf-icon-moon h-[18px] w-[18px]"></i>
       <i data-lucide="sun"  class="pf-icon-sun  h-[18px] w-[18px]"></i>
     </button>

   The button must contain two lucide-driven icons with class `pf-icon-moon`
   and `pf-icon-sun`. One icon is shown per theme, controlled by CSS on
   `:root[data-theme=".."]` (defined in base.css) — so display swapping
   needs zero JS, only click + accessibility sync.

   Click handling is event-delegated: any element with `[data-pf-theme-toggle]`
   anywhere in the document becomes a toggle, even if added dynamically.
   ============================================================================ */

(function () {
  function syncToggleUI() {
    const isDark = window.PFTheme.current() === 'dark';
    const label  = isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';

    document.querySelectorAll('[data-pf-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-label', label);
      btn.setAttribute('aria-pressed', isDark ? 'false' : 'true');
      btn.setAttribute('data-current-theme', isDark ? 'dark' : 'light');
      btn.setAttribute('title', label);
    });
  }

  /* Event-delegated click — handles buttons added after page load. */
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-pf-theme-toggle]');
    if (!btn) return;
    e.preventDefault();
    window.PFTheme.toggle();
    /* `pf:themechange` event from theme.js will re-sync UI as well, but call
       directly too so the click feels instant before any async handlers. */
    syncToggleUI();
  });

  /* Cross-component sync hook — re-run when theme changes anywhere. */
  document.addEventListener('pf:themechange', syncToggleUI);

  /* Run on first paint (anti-flash script has already set data-theme by now). */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncToggleUI);
  } else {
    syncToggleUI();
  }

  /* Manual re-sync hook for screens that call lucide.createIcons() AFTER
     loading this file and want the accessibility attrs refreshed. */
  window.PFThemeSyncToggle = syncToggleUI;
})();
