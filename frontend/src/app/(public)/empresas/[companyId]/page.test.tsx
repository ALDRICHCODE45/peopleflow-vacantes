import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PROTOTYPE_COMPANY_ID, PROTOTYPE_COMPANY_SOURCE_NAME } from "../../../../features/company-profile/model";
import { ACME_PROTOTYPE_PROFILE } from "../../../../features/company-profile/prototype-companies";

const routeDir = join(process.cwd(), "src/app/(public)/empresas/[companyId]");
const featureDir = join(process.cwd(), "src/features/company-profile");
const routeSource = (file: string) => readFileSync(join(routeDir, file), "utf8");
const featureSource = (file: string) => readFileSync(join(featureDir, file), "utf8");
const load = async (file: string) => await import(/* @vite-ignore */ `${routeDir}/${file}`);
const paramsFor = (companyId: string) => Promise.resolve({ companyId });
/** The framework not-found signal, stubbed so the page contract is observable. */
const NEXT_NOT_FOUND = new Error("NEXT_NOT_FOUND");

vi.mock("next/navigation", () => ({ notFound: () => { throw NEXT_NOT_FOUND; } }));
vi.mock("../../../../lib/env/server", () => ({
  serverEnv: { apiBaseUrl: "http://127.0.0.1:8080", siteUrl: "http://127.0.0.1:3000", apiTimeoutMs: 8000 },
}));

afterEach(() => cleanup());

describe("/empresas/[companyId] metadata", () => {
  it("advertises one indexable canonical URL per company and none for unknowns", async () => {
    const { generateMetadata } = await load("page.tsx");
    const expected = {
      title: `${ACME_PROTOTYPE_PROFILE.name} · Perfil de empresa`,
      description: ACME_PROTOTYPE_PROFILE.tagline,
      alternates: { canonical: `http://127.0.0.1:3000/empresas/${PROTOTYPE_COMPANY_ID}` },
      robots: { index: true, follow: true },
    };
    expect(await generateMetadata({ params: paramsFor(PROTOTYPE_COMPANY_ID) })).toEqual(expected);
    // The name reference is an alias: both spellings advertise the id URL.
    expect(await generateMetadata({ params: paramsFor(PROTOTYPE_COMPANY_SOURCE_NAME) })).toEqual(expected);
    // Unknown companies use the framework not-found document, which Next itself
    // marks `noindex`; emitting robots metadata here would duplicate that tag.
    expect(await generateMetadata({ params: paramsFor("no-existe") })).toEqual({});
  });
});

describe("/empresas/[companyId] page behavior", () => {
  it("routes an unknown company to notFound()", async () => {
    const Page = (await load("page.tsx")).default;
    await expect(Page({ params: paramsFor("no-existe") })).rejects.toThrow(NEXT_NOT_FOUND);
  });

  it("renders the careers view for the canonical prototype company", async () => {
    const Page = (await load("page.tsx")).default;
    render(await Page({ params: paramsFor(PROTOTYPE_COMPANY_ID) }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(ACME_PROTOTYPE_PROFILE.name);
    expect(screen.getByRole("heading", { level: 2, name: "Vacantes" })).toBeVisible();
  });
});

describe("/empresas/[companyId] route-local not found", () => {
  it("renders one H1 and exactly one path back to the vacancy board", async () => {
    const NotFound = (await load("not-found")).default;
    const { container } = render(<NotFound />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
    expect(container.querySelectorAll("h2")).toHaveLength(0);
    expect(Array.from(container.querySelectorAll("a")).map((anchor) => [anchor.getAttribute("href"), anchor.textContent])).toEqual([["/vacantes", expect.stringMatching(/vacantes/iu)]]);
  });
});

describe("/empresas/[companyId] source boundaries", () => {
  it("keeps the route and view server-only with no transport or client state", () => {
    const pageSource = routeSource("page.tsx");
    const viewSource = featureSource("company-careers-view.tsx");
    for (const source of [pageSource, viewSource, routeSource("not-found.tsx")]) {
      expect(source).not.toMatch(/['"]use client['"]|use cache|requestJson|\bfetch\(|enrichJob|getJob|listJobs|QueryClient|HydrationBoundary|useState|useEffect|useParams|localStorage/);
    }
    expect(pageSource).toMatch(/params:\s*Promise<\{\s*companyId: string\s*\}>/);
    expect(pageSource).toMatch(/await params/u);
    expect(pageSource).toMatch(/findCompanyProfile\(/);
    expect(pageSource).toMatch(/\bnotFound\(\)/);
    expect(pageSource).toMatch(/export async function generateMetadata/);
    expect(pageSource).toMatch(/dynamic\s*=\s*"force-dynamic"/);
    // The cover stays a native img until the asset migration slice owns the
    // remote image configuration an optimized loader would need.
    expect(viewSource).toMatch(/<img\b/);
    expect(viewSource).not.toMatch(/from\s+["']next\/image["']/);
  });
});
