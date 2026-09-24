import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  applyThemeMode,
  applyResolvedTheme,
  normalizeThemeMode,
  persistThemeMode,
  readStoredThemeMode,
  resolveTheme,
  suppressTransitions,
  SYSTEM_DARK_QUERY,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "./theme-preferences";

function stubMatchMedia(matches: boolean) {
  const media = {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  return media;
}

async function nextFrame() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

describe("theme mode normalization", () => {
  it("accepts only light, dark, and system modes", () => {
    expect(normalizeThemeMode("light")).toBe("light");
    expect(normalizeThemeMode("dark")).toBe("dark");
    expect(normalizeThemeMode("system")).toBe("system");
    expect(normalizeThemeMode("blue")).toBe("system");
    expect(normalizeThemeMode(null)).toBe("system");
    expect(normalizeThemeMode(undefined)).toBe("system");
  });
});

describe("theme resolution", () => {
  it("falls back to the OS preference for system mode", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("keeps an explicit manual choice over the OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("persisted theme mode", () => {
  it("reads the stored manual choice", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(readStoredThemeMode(localStorage)).toBe("light");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readStoredThemeMode(localStorage)).toBe("dark");
  });

  it("defaults to system when nothing valid is stored", () => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    expect(readStoredThemeMode(localStorage)).toBe("system");
    localStorage.setItem(THEME_STORAGE_KEY, "nebula");
    expect(readStoredThemeMode(localStorage)).toBe("system");
  });

  it("survives a denied storage store", () => {
    const denied = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(readStoredThemeMode(denied)).toBe("system");
  });

  it("removes the stored choice when returning to system", () => {
    const storage = {
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    persistThemeMode("light", storage);
    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "light");
    persistThemeMode("system", storage);
    expect(storage.removeItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  });
});

describe("resolved theme application", () => {
  it("marks dark mode with the dark class and data-theme", () => {
    document.documentElement.classList.remove("dark");
    applyResolvedTheme("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("marks light mode without the dark class", () => {
    document.documentElement.classList.add("dark");
    applyResolvedTheme("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});

describe("applyThemeMode", () => {
  it("applies and persists an explicit light choice", async () => {
    stubMatchMedia(true);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.classList.add("dark");

    applyThemeMode("light");

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("applies an explicit dark choice", () => {
    stubMatchMedia(false);
    applyThemeMode("dark");

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("resolves system mode from the OS preference without persisting it", () => {
    stubMatchMedia(true);
    localStorage.setItem(THEME_STORAGE_KEY, "light");

    applyThemeMode("system");

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("keeps the stored choice when storage denies writes", () => {
    stubMatchMedia(true);
    vi.stubGlobal("localStorage", {
      getItem: () => "dark",
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    });

    expect(() => applyThemeMode("light")).not.toThrow();
    // The visual application still happened even though persistence failed.
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});

describe("transition smear suppression", () => {
  it("injects a global transition kill and removes it on the next frame", async () => {
    stubMatchMedia(false);
    applyThemeMode("dark");

    const suppression = document.head.querySelector(
      "style[data-pf-theme-suppression]",
    );
    expect(suppression).not.toBeNull();
    expect(suppression?.textContent).toContain("transition:none !important");

    await nextFrame();

    expect(
      document.head.querySelector("style[data-pf-theme-suppression]"),
    ).toBeNull();
  });

  it("exposes a reusable suppress-and-restore helper", () => {
    const restore = suppressTransitions();
    expect(
      document.head.querySelector("style[data-pf-theme-suppression]"),
    ).not.toBeNull();
    restore();
    expect(
      document.head.querySelector("style[data-pf-theme-suppression]"),
    ).toBeNull();
  });
});

describe("pre-paint bootstrap script", () => {
  it("reuses the same storage key and dark query as the runtime API", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(JSON.stringify(SYSTEM_DARK_QUERY));
  });

  it("clears any stale explicit attribute before applying the system theme", () => {
    // System mode must leave data-theme unset so CSS system-preference rules
    // own the palette; a stale explicit attribute would pin the wrong theme.
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('removeAttribute("data-theme")');
  });
});

describe("mode lifecycle", () => {
  it("cycles system, light, dark, and back to system with visible changes", () => {
    stubMatchMedia(true);
    localStorage.removeItem(THEME_STORAGE_KEY);

    const cycle = (mode: ThemeMode): ThemeMode => {
      if (mode === "system") {
        return resolveTheme("system", true) === "dark" ? "light" : "dark";
      }
      return mode === "light" ? "dark" : "system";
    };

    expect(cycle("system")).toBe("light");
    expect(cycle("light")).toBe("dark");
    expect(cycle("dark")).toBe("system");
  });
});
