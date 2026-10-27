const RESERVED_SLUGS = new Set([
  "admin", "api", "empresa", "empresas", "vacantes", "candidato", "login", "nuevo",
  "nueva", "peopleflow", "soporte", "ayuda",
]);

export function validateSlug(slug: string): null | "invalid" | "reserved" {
  if (slug.length < 3 || slug.length > 60 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "invalid";
  return RESERVED_SLUGS.has(slug) ? "reserved" : null;
}

export function slugFromName(name: string): string {
  const slug = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (slug.length <= 60) return slug;
  const cut = slug.slice(0, 60);
  if (slug[60] === "-") return cut;
  const boundary = cut.lastIndexOf("-");
  return boundary > 0 ? cut.slice(0, boundary) : cut;
}
