/** Wire fixtures copied from `placement-vacancy-documents-v1` (the P7b overview example is pinned by a backend handler test). */
export const ids = {
  draft: "0193c000-0000-7000-8000-000000000001",
  participation: "0193c0bb-0000-7000-8000-000000000021",
  participation2: "0193c0bb-0000-7000-8000-000000000022",
  document: "0193c0aa-0000-7000-8000-000000000011",
  document2: "0193c0aa-0000-7000-8000-000000000012",
  link: "0193c0ee-0000-7000-8000-000000000051",
  link2: "0193c0ee-0000-7000-8000-000000000052",
  source: "0193c0ff-0000-7000-8000-000000000061",
  sourceProcess: "0193bfff-0000-7000-8000-000000000001",
  ana: "0193c0cc-0000-7000-8000-000000000031",
  luis: "0193c0cc-0000-7000-8000-000000000032",
  marta: "0193c0dd-0000-7000-8000-000000000041",
  zoe: "0193c0dd-0000-7000-8000-000000000042",
  idemToken: "6f1c1a56-0f3e-4a8e-9d5b-3b5d2f0c9a11",
} as const;

export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const ana = { id: ids.ana, name: "Ana López" };
export const luis = { id: ids.luis, name: "Luis Ortega" };

export const formatsWire = () => [
  { format: "pdf", extensions: [".pdf"], content_type: "application/pdf" },
  { format: "docx", extensions: [".docx"], content_type: DOCX },
  { format: "xlsx", extensions: [".xlsx"], content_type: XLSX },
  { format: "jpg", extensions: [".jpg", ".jpeg"], content_type: "image/jpeg" },
  { format: "png", extensions: [".png"], content_type: "image/png" },
];
export const scopeWire = (over: Record<string, unknown> = {}) => ({
  can_manage: true, allowed_actions: ["upload", "link"], upload_blocked_reason: null,
  limits: { max_bytes: 10485760, max_documents: 50, max_versions: 25, formats: formatsWire() },
  counts: { documents: 3, links: 1 },
  ...over,
});
export const itemWire = (over: Record<string, unknown> = {}) => ({
  id: ids.document, participation_id: null, name: "Contrato marco", format: "pdf", content_type: "application/pdf",
  size: 183204, version: 2, version_count: 2,
  created_at: "2026-11-20T15:02:11.482910Z", created_by: ana, updated_at: "2026-11-22T09:40:03.100200Z", updated_by: luis,
  allowed_actions: ["download", "replace", "delete"],
  ...over,
});
export const sourceWire = (over: Record<string, unknown> = {}) => ({
  document_id: ids.source, process_id: ids.sourceProcess, sequence: 0, participation_id: null, name: "Contrato original",
  format: "docx", size: 91200, version: 1, version_count: 3, uploaded_at: "2026-10-03T12:00:00.000000Z", uploaded_by: ana,
  has_newer_version: true,
  ...over,
});
export const linkWire = (over: Record<string, unknown> = {}) => ({
  id: ids.link, state: "available", linked_at: "2026-11-22T10:00:00.000000Z", linked_by: ana,
  allowed_actions: ["download", "unlink"], source: sourceWire(),
  ...over,
});
export const removedLinkWire = () => linkWire({ id: ids.link2, state: "removed", allowed_actions: ["unlink"], source: null });
export const inaccessibleLinkWire = () => linkWire({ id: ids.link2, state: "inaccessible", allowed_actions: ["unlink"], source: null });

export const listWire = () => ({ items: [itemWire()], links: [linkWire(), removedLinkWire()], scope: scopeWire() });

export const versionsWire = () => ({
  document_id: ids.document, name: "Contrato marco",
  versions: [
    { version: 2, format: "pdf", content_type: "application/pdf", size: 183204, uploaded_at: "2026-11-22T09:40:03.100200Z", uploaded_by: luis, is_current: true },
    { version: 1, format: "docx", content_type: DOCX, size: 90112, uploaded_at: "2026-11-20T15:02:11.482910Z", uploaded_by: ana, is_current: false },
  ],
});

export const sourcesWire = () => ({
  can_link: true,
  sources: [{
    process_id: ids.sourceProcess, sequence: 0, participation_id: null,
    documents: [{ id: ids.source, name: "Contrato original", format: "docx", size: 91200, version: 1, version_count: 1, updated_at: "2026-10-03T12:00:00.000000Z", already_linked: false }],
  }],
});

const marta = { kind: "manual", id: ids.marta, full_name: "Marta Ruiz" };
const zoe = { kind: "organic", id: ids.zoe, full_name: "Zoe Zapata" };
export const participationOwnerWire = () => ({ kind: "participation", participation_id: ids.participation, candidate: marta, discarded: false });

/** «GET V/document-overview» example, key for key. */
export const overviewWire = () => ({
  vacancy: { id: ids.draft, title: "Analista contable", publication: "published", process: "active", kind: "replacement", visibility: "private" },
  scope: scopeWire({ counts: { documents: 1, links: 1 } }),
  items: [
    itemWire({ participation_id: ids.participation, name: "Contrato firmado", owner: participationOwnerWire() }),
    itemWire({
      id: ids.document2, name: "Contrato marco", format: "docx", content_type: DOCX, size: 91200, version: 1, version_count: 1,
      updated_at: "2026-11-20T15:02:11.482910Z", updated_by: ana, owner: { kind: "vacancy" },
    }),
  ],
  links: [
    { ...linkWire(), owner: { kind: "vacancy" } },
    { ...removedLinkWire(), linked_at: "2026-11-21T08:30:00.000000Z", owner: participationOwnerWire() },
  ],
  participations: [
    { participation_id: ids.participation, candidate: marta, discarded: false, stage: { kind: "placement", name: "Placement" }, scope_allowed_actions: ["upload", "link"], upload_blocked_reason: null },
    { participation_id: ids.participation2, candidate: zoe, discarded: true, stage: { kind: "screening", name: "Screening" }, scope_allowed_actions: [], upload_blocked_reason: "limit_reached" },
  ],
  truncated: false,
});
