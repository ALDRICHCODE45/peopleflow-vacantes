/**
 * Manual theme infrastructure shared by the pre-paint bootstrap and the theme
 * control.
 *
 * Mechanism contract (mirrors the approved HTML reference):
 * - `<html>` carries the resolved theme as the `data-theme` attribute AND the
 *   Tailwind `dark` class. Semantic tokens in globals.css flip on the class;
 *   system-preference rules in globals.css stay gated on
 *   `:root:not([data-theme])`, so an explicit manual choice always wins and a
 *   system default never fights it.
 * - The persisted choice lives in localStorage under THEME_STORAGE_KEY. No
 *   entry means "follow the system preference"; the key is removed when the
 *   user returns to system mode.
 * - THEME_BOOTSTRAP_SCRIPT is inlined in the root layout BEFORE first paint so
 *   the resolved theme applies without a flash, and its document mutations are
 *   covered by suppressHydrationWarning on <html>.
 */

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "pf-theme";
export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function normalizeThemeMode(value: unknown): ThemeMode {
 return value === "light" || value === "dark" ? value : "system";
}

export function readStoredThemeMode(
 storage?: Pick<Storage, "getItem"> | null,
): ThemeMode {
 if (!storage) return "system";
 try {
  return normalizeThemeMode(storage.getItem(THEME_STORAGE_KEY));
 } catch {
  // Private mode or a denied store behaves like "no explicit choice".
  return "system";
 }
}

export function persistThemeMode(
 mode: ThemeMode,
 storage?: Pick<Storage, "setItem" | "removeItem"> | null,
): void {
 if (!storage) return;
 try {
  if (mode === "system") storage.removeItem(THEME_STORAGE_KEY);
  else storage.setItem(THEME_STORAGE_KEY, mode);
 } catch {
  // Persistence is best-effort: private mode or quota errors must not break
  // the visual application below.
 }
}

export function resolveTheme(
 mode: ThemeMode,
 systemDark: boolean,
): ResolvedTheme {
 if (mode === "system") return systemDark ? "dark" : "light";
 return mode;
}

export function applyResolvedTheme(
 resolved: ResolvedTheme,
 doc: Document = window.document,
): void {
 doc.documentElement.classList.toggle("dark", resolved === "dark");
 doc.documentElement.setAttribute("data-theme", resolved);
}

/**
 * better-ui recipe: a theme flip transitions color/background/border/shadow on
 * nearly every element at once, which smears instead of snapping. Inject a
 * global transition kill, force a style flush, and let the caller restore on
 * the next animation frame.
 */
export function suppressTransitions(
 doc: Document = window.document,
): () => void {
 const style = doc.createElement("style");
 style.setAttribute("data-pf-theme-suppression", "");
 style.textContent = "*,*::before,*::after{transition:none !important}";
 doc.head.append(style);
 // Force a style/layout flush so the suppression is active before the theme
 // attributes change.
 void doc.documentElement.offsetWidth;
 return () => {
  style.remove();
 };
}

/**
 * Apply a mode end to end: persist the explicit choice (or clear it for
 * system), resolve the concrete theme, and apply it to the document without
 * transition smear.
 */
export function applyThemeMode(
 mode: ThemeMode,
 doc: Document = window.document,
): void {
 const view = doc.defaultView;
 const restore = suppressTransitions(doc);
 persistThemeMode(mode, view?.localStorage ?? null);
 if (mode === "system") {
  const systemDark = view?.matchMedia(SYSTEM_DARK_QUERY).matches ?? false;
  applyResolvedTheme(resolveTheme("system", systemDark), doc);
 } else {
  applyResolvedTheme(mode, doc);
 }
 if (view?.requestAnimationFrame) {
  view.requestAnimationFrame(() => restore());
 } else {
  restore();
 }
}

/**
 * Pre-paint bootstrap inlined in the root layout <head>-adjacent position:
 * applies the persisted manual choice, or resolves the OS preference, before
 * the first paint so neither the server render nor hydration reads browser
 * state. Storage access is guarded against denied stores.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var d=document.documentElement;var m=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(m!=="light"&&m!=="dark"){d.removeAttribute("data-theme");d.classList.toggle("dark",window.matchMedia(${JSON.stringify(SYSTEM_DARK_QUERY)}).matches);return;}d.classList.toggle("dark",m==="dark");d.setAttribute("data-theme",m);}catch(e){}})();`;
