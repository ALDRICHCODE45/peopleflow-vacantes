import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// VAF-02 RED: the application route and its feature shell do not exist yet, so
// every contract below fails until `postular/page.tsx` and the shell land.
const routeDir = join(process.cwd(), "src/app/(candidato)/vacantes/[jobId]/postular");
const routeFile = join(routeDir, "page.tsx");

/** Exact wire-only fixture the shared detail loader already knows. */
const jobId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const wireJob = legacyDetail;

import { legacyDetail, vacancyDetail } from "../../../../../features/jobs/api/public-fixtures";

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

const okFetch = () =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => wireJob });
const errorFetch = (status: number) =>
  vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: "upstream" }) });

/** Any Tailwind palette utility is a raw color; only semantic tokens are allowed. */
const RAW_COLOR_UTILITY =
  /(?:^|\s|[a-z-]+:)(?:text|bg|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)-\d{2,3}(?:\s|$)/;

vi.mock("@/features/candidate-applications/wizard", () => ({ CandidateApplicationWizard: () => <h2>Datos de candidato</h2> }));

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
  it.each(["paused", "closed"])("renders the %s detail StateCard instead of a wizard", async availability => {
    const data = { id: jobId, title: "Backend Go", company: { id: jobId, name: "Acme" }, availability };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 410, json: async () => ({ error: "Unavailable", code: "vacancy_unavailable", data }) }));
    const route = await load("page.tsx");
    render(await route.default({ params: paramsFor(jobId) }));
    expect(screen.getByRole("heading", { name: availability === "paused" ? "Vacante pausada" : "Vacante cerrada" }).closest('[data-slot="card"]')).not.toBeNull();
    expect(screen.queryByText("Datos de candidato")).toBeNull();
    expect(await route.generateMetadata({ params: paramsFor(jobId) })).toEqual({ title: data.title, robots: { index: false, follow: true } });
  });
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
    expect(source).toContain('<CandidateApplicationWizard job={result.job}');
    // Legacy catalog rows never reach a wizard: there is no endpoint that accepts them.
    expect(source).not.toMatch(/VacancyApplicationWizard|legacyApplicationJob|prototype-candidate/);
    expect(source).not.toMatch(
      /["']use client["']|requestJson|QueryClientProvider|HydrationBoundary/,
    );
  });

  it("advertises the noindex form canonical and the Postularme title for vacancy-source ids", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => vacancyDetail }));
    const { generateMetadata } = await load("page");
    const metadata = await generateMetadata({ params: paramsFor(vacancyDetail.id) });
    expect(metadata.title).toBe(`Postularme · ${vacancyDetail.title}`);
    expect(metadata.alternates?.canonical).toBe(
      `http://127.0.0.1:3000/vacantes/${vacancyDetail.id}/postular`,
    );
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("keeps a legacy vacancy out of the index under its own title", async () => {
    vi.stubGlobal("fetch", okFetch());
    const { generateMetadata } = await load("page");
    expect(await generateMetadata({ params: paramsFor(jobId) })).toEqual({ title: wireJob.title, robots: { index: false, follow: true } });
  });

  it("short-circuits malformed ids with zero fetches and then notFound()", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const Page = (await load("page")).default;
    await expect(Page({ params: paramsFor("nope") })).rejects.toThrow(NEXT_NOT_FOUND);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the real candidate wizard and noindex metadata for vacancy-source ids", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => vacancyDetail }));
    const { default: Page, generateMetadata } = await load("page");
    render(await Page({ params: paramsFor(vacancyDetail.id) }));
    expect(screen.getByRole("heading", { name: "Datos de candidato" })).toBeVisible();
    expect(await generateMetadata({ params: paramsFor(vacancyDetail.id) })).toMatchObject({ title: `Postularme · ${vacancyDetail.title}`, robots: { index: false, follow: false } });
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

  it("tells a legacy vacancy does not take online applications, from one GET-only read and without prototype data", async () => {
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
    expect(headings[0]).toHaveTextContent("Esta vacante no recibe postulaciones en línea");
    expect(headings[0].closest('[data-slot="card"]')).not.toBeNull();
    expect(container).toHaveTextContent(`${wireJob.title} · ${wireJob.company.name}`);
    expect(container).toHaveTextContent("Por ahora no puedes postularte a esta vacante desde PeopleFlow.");
    expect(screen.getByRole("link", { name: "Ver otras vacantes" })).toHaveAttribute("href", "/vacantes");
    expect(screen.getByRole("link", { name: "Volver a la vacante" })).toHaveAttribute("href", `/vacantes/${jobId}`);
    // No form, no wizard, no prototype candidate.
    expect(container.querySelector("form, input, [data-pf-application-form-host]")).toBeNull();
    expect(container).not.toHaveTextContent(/Ximena|Paso 1 de|Iniciar sesión para enviar|Postularme/);
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
});
