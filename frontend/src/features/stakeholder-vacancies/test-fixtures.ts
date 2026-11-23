/** Wire fixtures of `GET /v2/me/company/stakeholder/vacancies` (placement-vacancy-documents P7c, L8): the two rows of the envelope, key for key. */
export const ids = {
  closed: "0193c000-0000-7000-8000-000000000001",
  draft: "0193c000-0000-7000-8000-000000000002",
  active: "0193c000-0000-7000-8000-000000000003",
  paused: "0193c000-0000-7000-8000-000000000004",
  replacement: "0193c000-0000-7000-8000-000000000005",
} as const;

export const closedRow = (over: Record<string, unknown> = {}) => ({
  id: ids.closed, title: "Analista contable", publication: "closed", process: "finished", kind: "original", visibility: "public",
  close_reason: "filled", coverage: { covered: 2, required: 2 }, documents_count: 7, ...over,
});
export const draftRow = (over: Record<string, unknown> = {}) => ({
  id: ids.draft, title: null, publication: null, process: null, kind: "original", visibility: null,
  close_reason: null, coverage: null, documents_count: 1, ...over,
});
export const activeRow = (over: Record<string, unknown> = {}) => ({
  id: ids.active, title: "Desarrollador(a) backend", publication: "published", process: "active", kind: "original", visibility: "public",
  close_reason: null, coverage: { covered: 0, required: 3 }, documents_count: 0, ...over,
});
export const pausedRow = (over: Record<string, unknown> = {}) => ({
  id: ids.paused, title: "Diseñador(a) UX", publication: "paused", process: "active", kind: "original", visibility: "public",
  close_reason: null, coverage: null, documents_count: 2, ...over,
});
export const replacementRow = (over: Record<string, unknown> = {}) => ({
  id: ids.replacement, title: "Auxiliar administrativo", publication: "published", process: "active", kind: "replacement", visibility: "private",
  close_reason: null, coverage: { covered: 0, required: 1 }, documents_count: 3, ...over,
});

/** The envelope of L8: a closed vacancy and a never-published draft, no next page. */
export const listWire = () => ({ items: [closedRow(), draftRow()], next_cursor: null });
