import { createRequire } from "node:module";
import { expect, it } from "vitest";
import nextConfig from "../../../../../../../next.config";

// Next compiles `source` with its bundled path-to-regexp; the test uses the same engine.
const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (source: string) => RegExp;
};
const id = "123e4567-e89b-42d3-a456-426614174000";

/**
 * Regression: `/configuracion` → `/configuracion/columnas` used to be a page-level `redirect()`. During a client navigation that
 * reaches the router as a redirect error and `RedirectBoundary` issues a second `router.replace` after the render; a click on the
 * «Documentos» tab in that window left the app router rendering a different number of hooks («Rendered more hooks than during the
 * previous render», «Application error»). The redirect must be an HTTP one that the router resolves in a single action.
 */
async function rules() {
  return (await nextConfig.redirects?.()) ?? [];
}

it("redirects the configuration tab to its first module with a server redirect", async () => {
  const found = (await rules()).find(r => pathToRegexp(r.source).test(`/empresa/vacantes/${id}/configuracion`));
  expect(found).toMatchObject({ destination: "/empresa/vacantes/:jobId/configuracion/columnas", permanent: false });
});

it("matches only a canonical vacancy id and exactly the configuration root", async () => {
  const all = await rules();
  const matches = (path: string) => all.some(r => pathToRegexp(r.source).test(path));
  expect(matches(`/empresa/vacantes/${id.toUpperCase()}/configuracion`)).toBe(true);
  for (const path of [
    `/empresa/vacantes/${id}/configuracion/columnas`,
    `/empresa/vacantes/${id}/configuracion/equipo`,
    `/empresa/vacantes/${id}/documentos`,
    "/empresa/vacantes/bad/configuracion",
    "/empresa/vacantes/backend-developer-senior/configuracion",
  ]) expect(matches(path), path).toBe(false);
});
