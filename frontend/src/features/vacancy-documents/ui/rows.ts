import type { DocumentOwner, DocumentOverview, OverviewItem, OverviewLink } from "../model";

/** One table row: an own file (`item`) or a link to a document of the original process (`link`), both with the owner `document-overview` gives. */
export type DocRow =
  | { kind: "item"; id: string; at: string; owner: DocumentOwner; item: OverviewItem }
  | { kind: "link"; id: string; at: string; owner: DocumentOwner; link: OverviewLink };

export type ScopeFilter = "all" | "vacancy" | "candidates";
export type Filters = { scope: ScopeFilter; participationId: string | null; search: string };
export const NO_FILTERS: Filters = { scope: "all", participationId: null, search: "" };

/** S13: choosing a candidate sets the scope to «Candidatos»; «Vacante» clears the candidate (the selector does not apply to it). */
export const chooseCandidate = (filters: Filters, participationId: string | null): Filters =>
  ({ ...filters, participationId, scope: participationId ? "candidates" : filters.scope });
export const chooseScope = (filters: Filters, scope: ScopeFilter): Filters =>
  ({ ...filters, scope, participationId: scope === "vacancy" ? null : filters.participationId });

/** Newest first (items by `updated_at`, links by `linked_at`), then id descending: the backend's order, kept after a local update. */
export function buildRows(overview: Pick<DocumentOverview, "items" | "links">): DocRow[] {
  const rows: DocRow[] = [
    ...overview.items.map((item): DocRow => ({ kind: "item", id: item.id, at: item.updated_at, owner: item.owner, item })),
    ...overview.links.map((link): DocRow => ({ kind: "link", id: link.id, at: link.linked_at, owner: link.owner, link })),
  ];
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : -1));
}

const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const rowName = (row: DocRow): string | null => row.kind === "item" ? row.item.name : row.link.source?.name ?? null;

export function filterRows(rows: DocRow[], { scope, search }: Pick<Filters, "scope" | "search">): DocRow[] {
  const needle = plain(search.trim());
  return rows.filter(row => {
    if (scope === "vacancy" && row.owner.kind !== "vacancy") return false;
    if (scope === "candidates" && row.owner.kind !== "participation") return false;
    if (!needle) return true;
    const name = rowName(row);
    return name !== null && plain(name).includes(needle);
  });
}

/** `Vacante` comes from `scope.counts`; the candidate side is only known from the rows, so it is `null` when the read is narrowed or truncated. */
export function scopeCounts(overview: DocumentOverview, rows: DocRow[], narrowed: boolean): { all: number | null; vacancy: number; candidates: number | null } {
  const vacancy = overview.scope.counts.documents + overview.scope.counts.links;
  if (narrowed || overview.truncated) return { all: null, vacancy, candidates: null };
  const candidates = rows.filter(row => row.owner.kind === "participation").length;
  return { all: vacancy + candidates, vacancy, candidates };
}
