import { expect, it } from "vitest";
import { languageCatalogSchema } from "./model";
it("decodes the strict catalog with opaque codes and Spanish names", () => {
  const catalog = { items: [{ code: "local:mixteco", name: "Mixteco" }, { code: "nah", name: "Náhuatl" }] };
  expect(languageCatalogSchema.parse(catalog)).toEqual(catalog);
  for (const value of [[], { items: [{ code: "", name: "Idioma" }] }, { items: [{ code: "es", name: "" }] }, { ...catalog, extra: true }, { items: [{ code: "es", name: "Español", id: "es" }] }, { items: [catalog.items[0], catalog.items[0]] }]) expect(languageCatalogSchema.safeParse(value).success).toBe(false);
});
