"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import {
  applyThemeMode,
  readStoredThemeMode,
  resolveTheme,
  SYSTEM_DARK_QUERY,
  type ThemeMode,
} from "./theme-preferences";

/**
 * Minimal manual theme control.
 *
 * Defaults to the system preference until the first manual choice, then
 * alternates light and dark. Markup is state-independent: the three icons are always
 * rendered and globals.css reveals the one matching the resolved theme, so the
 * server render and the first client render agree (no hydration mismatch).
 * The pre-paint bootstrap in the root layout owns the initial application;
 * this control only handles user interaction and live OS-preference changes
 * while in system mode.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = React.useState<ThemeMode>("system");

  React.useEffect(() => {
    setMode(readStoredThemeMode(window.localStorage));
    const media = window.matchMedia(SYSTEM_DARK_QUERY);
    const syncSystemPreference = () => {
      if (readStoredThemeMode(window.localStorage) === "system") {
        applyThemeMode("system");
      }
    };
    media.addEventListener("change", syncSystemPreference);
    return () => media.removeEventListener("change", syncSystemPreference);
  }, []);

  const cycleThemeMode = () => {
    if (mode === "system") {
      // First interaction from the system default resolves to the opposite
      // theme, so the click always produces a visible change.
      const systemDark = window.matchMedia(SYSTEM_DARK_QUERY).matches;
      const next =
        resolveTheme("system", systemDark) === "dark" ? "light" : "dark";
      applyThemeMode(next);
      setMode(next);
      return;
    }
    const next: ThemeMode = mode === "light" ? "dark" : "light";
    applyThemeMode(next);
    setMode(next);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Cambiar tema"
      data-pf-theme-toggle=""
      onClick={cycleThemeMode}
      className={cn("size-10", className)}
    >
      <Sun aria-hidden="true" className="pf-icon-sun" />
      <Moon aria-hidden="true" className="pf-icon-moon" />
      <Monitor aria-hidden="true" className="pf-icon-system" />
    </Button>
  );
}
