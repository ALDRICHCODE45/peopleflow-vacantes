import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// VAF-02 RED: the application route and its feature shell do not exist yet, so
// every contract below fails until `postular/page.tsx` and the shell land.
const routeDir = join(process.cwd(), "src/app/(public)/vacantes/[jobId]/postular");
const routeFile = join(routeDir, "page.tsx");

/** Exact wire-only fixture the shared detail loader already knows. */
const jobId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const wireJob = {
  id: jobId,
  title: "Ingeniera Frontend",
  description: "Construye la experiencia de vacantes.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "MXN",
  company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f", name: "Acme" },
};

const NEXT_NOT_FOUND = new Error("NEXT_NOT_FOUND");
const paramsFor = (id: string) => Promise.resolve({ jobId: id });
const load = async (file: string) => await import(/* @vite-ignore */ `${routeDir}/${file}`);

const readRoute = (): string => {
  if (!existsSync(routeFile)) throw new Error("absent route: postular/page.tsx is not implemented");
  return readFileSync(routeFile, "utf8");
};

/** Resolve a route-relative or `@/`-aliased specifier to an existing source file. */
const resolveLocal = (specifier: string): string => {
  const base = specifier.startsWith("@/")
    ? join(process.cwd(), "src", specifier.slice(2))
    : resolve(routeDir, specifier);
  const found = [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx")].find(existsSync);
  if (found === undefined) throw new Error(`absent feature module: ${specifier}`);
  return found;
};

/** Read one named feature module the route imports, wherever the application flow places it. */
const importedSource = (name: string): string => {
  const match = readRoute().match(
    new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`),
  );
  if (match === null) throw new Error(`route must import { ${name} }`);
  return readFileSync(resolveLocal(match[1]), "utf8");
};

/** Read the feature shell the route imports, wherever the application flow places it. */
const shellSource = (): string => importedSource("VacancyApplicationShell");

/** Read the static vacancy summary the route slots into the client wizard rail. */
const summarySource = (): string => importedSource("VacancyApplicationSummary");

const okFetch = () =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => wireJob });
const errorFetch = (status: number) =>
  vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: "upstream" }) });

/** Any Tailwind palette utility is a raw color; only semantic tokens are allowed. */
const RAW_COLOR_UTILITY =
  /(?:^|\s|[a-z-]+:)(?:text|bg|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)-\d{2,3}(?:\s|$)/;

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NEXT_NOT_FOUND;
  },
}));
vi.mock("../../../../../lib/api/server", async () => ({
  requestJson: (await import("../../../../../lib/api/requestJson")).requestJson,
}));
vi.mock("../../../../../lib/env/server", () => ({
  serverEnv: {
    apiBaseUrl: "http://127.0.0.1:8080",
    siteUrl: "http://127.0.0.1:3000",
    apiTimeoutMs: 8000,
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/vacantes/[jobId]/postular route boundaries", () => {
  it("stays a dynamic nodejs server component reusing the request-scoped detail scope", () => {
    const source = readRoute();
    expect(source).toMatch(/runtime\s*=\s*"nodejs"/);
    expect(source).toMatch(/dynamic\s*=\s*"force-dynamic"/);
    expect(source).toMatch(
      /import\s*\{[^}]*createVacanteDetailScope[^}]*\}\s*from\s*["']\.\.\/page-data["']/,
    );
    expect(source).toMatch(/React\.cache\(\s*createVacanteDetailScope\s*\)/);
    expect(source).toMatch(/\bnotFound\(\)/);
    expect(source).toMatch(/kind\s*===\s*"unavailable"/);
    expect(source).toMatch(/throw\s+new\s+Error\(/);
    // Enrichment is attached only at the render boundary, never in page-data.
    expect(source).toMatch(/<VacancyApplicationShell[^>]*job=\{enrichJob\(result\.job\)\}/);
    // The static vacancy summary is a server-composed slot handed to the client wizard.
    expect(source).toMatch(/vacancySummary=\{<VacancyApplicationSummary\b/);
    expect(source).toMatch(/vacancySummary=\{<VacancyApplicationSummary[^>]*job=\{enrichJob\(result\.job\)\}[^>]*\/>\}/);
    expect(source).toMatch(/from\s*["'][^"']*vacancy-application-summary["']/);
    expect(source).not.toMatch(
      /["']use client["']|requestJson|QueryClientProvider|HydrationBoundary/,
    );
  });

  it("advertises the noindex form canonical and the Postularme title", async () => {
    vi.stubGlobal("fetch", okFetch());
    const { generateMetadata } = await load("page");
    const metadata = await generateMetadata({ params: paramsFor(jobId) });
    expect(metadata.title).toBe(`Postularme · ${wireJob.title}`);
    expect(metadata.alternates?.canonical).toBe(
      `http://127.0.0.1:3000/vacantes/${jobId}/postular`,
    );
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("short-circuits malformed ids with zero fetches and then notFound()", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const Page = (await load("page")).default;
    await expect(Page({ params: paramsFor("nope") })).rejects.toThrow(NEXT_NOT_FOUND);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a backend 404 to notFound() and a retryable failure to a real error", async () => {
    const Page = (await load("page")).default;
    vi.stubGlobal("fetch", errorFetch(404));
    await expect(Page({ params: paramsFor(jobId) })).rejects.toThrow(NEXT_NOT_FOUND);
    vi.stubGlobal("fetch", errorFetch(500));
    const thrown = await Page({ params: paramsFor(jobId) }).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBe(NEXT_NOT_FOUND);
  });

  it("renders the shell for a found vacancy from one GET-only data read", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const Page = (await load("page")).default;
    const { container } = render(await Page({ params: paramsFor(jobId) }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0][1] ?? {}) as RequestInit;
    expect(init.method ?? "GET").toBe("GET");
    expect(init.body ?? null).toBeNull();

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Postularme");
    expect(container).toHaveTextContent(wireJob.title);
    expect(container).toHaveTextContent(wireJob.company.name);
    expect(screen.getByRole("link", { name: /volver a la vacante/i })).toHaveAttribute(
      "href",
      `/vacantes/${jobId}`,
    );

    // The shell header carries no implementation-status or no-send disclosure.
    const header = container.querySelector("[data-pf-application-header]");
    expect(header).not.toBeNull();
    expect(header!.querySelector('[role="note"]')).toBeNull();
    const shellText = container.textContent ?? "";
    expect(shellText).not.toMatch(/demostraci[óo]n/i);
    expect(shellText).not.toMatch(/no se env[íi]a/i);
    expect(shellText).not.toMatch(/no se guarda/i);
    expect(container.querySelector("[data-pf-application-form-host]")).not.toBeNull();
  });
});

describe("VacancyApplicationShell feature contract", () => {
  it("stays a server header wrapper with no client behavior", () => {
    const source = shellSource();
    expect(source).toMatch(/data-pf-application-header/);
    expect(source).toMatch(/\{\s*children\s*\}/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/);
    expect(source).not.toMatch(/(?:bg|text|border|ring|from|to|via)-primary-\d/);
    expect(source).not.toMatch(RAW_COLOR_UTILITY);
    expect(source).not.toMatch(/["']use client["']/);
    expect(source).not.toMatch(
      /\bfetch\(|requestJson|next\/navigation|useRouter|useSearchParams|useParams|localStorage|sessionStorage|indexedDB|document\.cookie|<form\b|onSubmit|setTimeout|setInterval|Math\.random|Date\.now/,
    );
  });

  it("keeps the static vacancy summary server-composed from local primitives", () => {
    const source = summarySource();
    for (const primitive of ["card", "avatar", "badge", "separator"]) {
      expect(source).toMatch(new RegExp(`components/ui/${primitive}["']`));
    }
    expect(source).toMatch(/Resumen de la vacante/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/);
    expect(source).not.toMatch(/(?:bg|text|border|ring|from|to|via)-primary-\d/);
    expect(source).not.toMatch(RAW_COLOR_UTILITY);
    expect(source).not.toMatch(/["']use client["']/);
    expect(source).not.toMatch(
      /\bfetch\(|requestJson|next\/navigation|useRouter|useSearchParams|useParams|localStorage|sessionStorage|indexedDB|document\.cookie|<form\b|onSubmit|setTimeout|setInterval|Math\.random|Date\.now/,
    );
  });

  it("renders a responsive shell with a semantic aside and no raw color utility", async () => {
    vi.stubGlobal("fetch", okFetch());
    const Page = (await load("page")).default;
    const { container } = render(await Page({ params: paramsFor(jobId) }));

    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside!.className).toMatch(/lg:sticky/);
    expect(aside!.className).not.toMatch(/(?:^|\s)sticky(?:\s|$)/);

    const responsive = [...container.querySelectorAll<HTMLElement>("[class]")].find(
      (node) =>
        /(?:^|\s)grid(?:\s|$)/.test(node.className) &&
        /lg:grid-cols-\[/.test(node.className),
    );
    expect(responsive).toBeDefined();
    expect(responsive!.className).not.toMatch(/(?:^|\s)grid-cols-\d/);

    const classes = [...container.querySelectorAll("*")]
      .map((node) => node.getAttribute("class") ?? "")
      .join(" ");
    expect(classes).toMatch(/text-muted-foreground/);
    expect(classes).toMatch(/bg-card|bg-muted|bg-background|border-border/);
    expect(classes).not.toMatch(RAW_COLOR_UTILITY);
    expect(container.querySelector("[data-pf-application-form-host]")).not.toBeNull();
  });
});
