import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routeDir = join(process.cwd(), "src/app/(public)/vacantes/[jobId]");

const routeSource = (file: string) =>
    readFileSync(join(routeDir, file), "utf8");

const loadRoute = async (file: string) =>
    (await import(/* @vite-ignore */ `${routeDir}/${file}`)).default;

afterEach(() => cleanup());

describe("/vacantes/[jobId] route boundaries", () => {
    it("keeps the page a dynamic server component with a local not-found mapping", () => {
        const source = routeSource("page.tsx");
        expect(source).toMatch(/dynamic\s*=\s*"force-dynamic"/);
        expect(source).toMatch(/runtime\s*=\s*"nodejs"/);
        expect(source).toMatch(/notFound\(\)/);
        expect(source).not.toMatch(
            /requestJson|use client|QueryClientProvider|HydrationBoundary|zustand/i,
        );
    });

    it("renders the branded not-found state with a path back to the list", async () => {
        const NotFound = await loadRoute("not-found");
        render(<NotFound />);
        expect(
            screen.getByText("Esta vacante no está disponible"),
        ).toBeVisible();
        const back = screen.getByRole("link", { name: /volver a vacantes/i });
        expect(back).toHaveAttribute("href", "/vacantes");
    });

    it("promotes the branded not-found heading to a single clear h1", async () => {
        const NotFound = await loadRoute("not-found");
        render(<NotFound />);
        // The not-found heading itself must be the only level-1 heading; the
        // not-found page replaces the detail route, so no other h1 is rendered.
        const heading = screen.getByRole("heading", {
            level: 1,
            name: "Esta vacante no está disponible",
        });
        expect(heading).toBeVisible();
        expect(heading.tagName).toBe("H1");
        expect(
            screen.queryByRole("heading", {
                level: 2,
                name: "Esta vacante no está disponible",
            }),
        ).toBeNull();
        expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
        const back = screen.getByRole("link", { name: /volver a vacantes/i });
        expect(back).toHaveAttribute("href", "/vacantes");
    });

    it("uses a client error boundary whose retry stays distinct from not-found", async () => {
        expect(routeSource("error.tsx")).toMatch(/['"]use client['"]/);
        const ErrorBoundary = await loadRoute("error");
        const reset = vi.fn();
        render(<ErrorBoundary error={new Error("upstream")} reset={reset} />);
        expect(screen.getByRole("alert")).toBeVisible();
        fireEvent.click(
            screen.getByRole("button", { name: /intentar de nuevo/i }),
        );
        expect(reset).toHaveBeenCalledOnce();
        // Retryable service/schema failures are never presented as not found.
        expect(
            screen.queryByText("Esta vacante no está disponible"),
        ).toBeNull();
        const back = screen.getByRole("link", { name: /vacantes/i });
        expect(back).toHaveAttribute("href", "/vacantes");
    });

    it("promotes the detail error boundary heading to a single clear h1", async () => {
        const ErrorBoundary = await loadRoute("error");
        const reset = vi.fn();
        render(<ErrorBoundary error={new Error("upstream")} reset={reset} />);
        // The error heading itself must be the only level-1 heading; the route
        // boundary replaces the detail page, so no other h1 is rendered.
        const heading = screen.getByRole("heading", {
            level: 1,
            name: "No se pudo cargar la vacante",
        });
        expect(heading).toBeVisible();
        expect(heading.tagName).toBe("H1");
        expect(
            screen.queryByRole("heading", {
                level: 2,
                name: "No se pudo cargar la vacante",
            }),
        ).toBeNull();
        expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
        // Retryable errors remain distinct from the branded not-found copy.
        expect(
            screen.queryByText("Esta vacante no está disponible"),
        ).toBeNull();
        const back = screen.getByRole("link", { name: /vacantes/i });
        expect(back).toHaveAttribute("href", "/vacantes");
        fireEvent.click(
            screen.getByRole("button", { name: /intentar de nuevo/i }),
        );
        expect(reset).toHaveBeenCalledOnce();
    });
});

vi.mock("../../../../lib/api/server", async () => ({
    requestJson: (await import("../../../../lib/api/requestJson")).requestJson,
}));
vi.mock("../../../../lib/env/server", () => ({
    serverEnv: {
        apiBaseUrl: "http://127.0.0.1:8080",
        siteUrl: "http://127.0.0.1:3000",
        apiTimeoutMs: 8000,
    },
}));

describe("/vacantes/[jobId] page-data unit (Task 5.2)", () => {
    const jobId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
    const job = {
        id: jobId,
        title: "Ingeniera Frontend",
        description: "Construye la experiencia de vacantes.",
        work_mode: "remote",
        employment_type: "full_time",
        seniority: "senior",
        salary_currency: "MXN",
        company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f", name: "Acme" },
    };
    const fetchJson = { ok: true, status: 200, json: async () => job };
    it("short-circuits malformed UUIDs with zero data/API/query calls", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const pageData = await import(
            /* @vite-ignore */ `${routeDir}/page-data`
        );
        await expect(
            pageData.createVacanteDetailScope().read("nope"),
        ).resolves.toEqual({ kind: "notFound" });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it("dedupes metadata/page reads around one fresh request-scoped client", async () => {
        const fetchMock = vi.fn().mockResolvedValue(fetchJson);
        vi.stubGlobal("fetch", fetchMock);
        const pageData = await import(
            /* @vite-ignore */ `${routeDir}/page-data`
        );
        const scope = pageData.createVacanteDetailScope();
        const [page, metadata] = await Promise.all([
            scope.read(jobId),
            scope.metadata(jobId),
        ]);
        expect(page).toEqual({ kind: "found", job });
        expect(metadata).toEqual(page);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await pageData.createVacanteDetailScope().read(jobId);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
