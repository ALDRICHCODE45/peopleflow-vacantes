import { z } from "zod";

/**
 * `placement-vacancy-documents-v1` (backend branch `feat/placement-vacancy-documents-backend`, slices P1–P7b). Pure schemas (no
 * `server-only`): shared by the server client, the actions, the BFF routes and the later Documentos tab. Every object is `.strict()`
 * and every enum is closed exactly as the contract's «Closed enums» table: an unlisted key or value is a contract violation and fails
 * the whole read (deployment order step 4: a new `format` needs the frontend first).
 */
/** D8: 10 MB per file. The UI takes the live value from `scope.limits.max_bytes`; this one only feeds the BFF cap and its 413 envelope. */
export const MAX_DOCUMENT_BYTES = 10_485_760;
/** Request cap = file + multipart overhead (contract «Formats, size and inspection»): `10 485 760 + 65 536`. */
export const DOCUMENT_REQUEST_CAP_BYTES = MAX_DOCUMENT_BYTES + 65_536;

const id = z.string().uuid();
const text = z.string().min(1);
const timestamp = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().safe();
const positive = z.number().int().positive().safe();
const person = z.object({ id, name: text }).strict();

export const documentFormatSchema = z.enum(["pdf", "docx", "xlsx", "jpg", "png"]);
export type DocumentFormat = z.infer<typeof documentFormatSchema>;
export const DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
] as const;

export const formatDescriptorSchema = z.object({
  format: documentFormatSchema, extensions: z.array(z.string().regex(/^\.[a-z0-9]+$/)).min(1), content_type: text,
}).strict();
export type FormatDescriptor = z.infer<typeof formatDescriptorSchema>;

export const scopeActionSchema = z.enum(["upload", "link"]);
export const itemActionSchema = z.enum(["download", "replace", "delete"]);
export const linkActionSchema = z.enum(["download", "unlink"]);
export const uploadBlockedReasonSchema = z.enum(["limit_reached"]);
export const linkStateSchema = z.enum(["available", "removed", "inaccessible"]);
export type ScopeAction = z.infer<typeof scopeActionSchema>;
export type ItemAction = z.infer<typeof itemActionSchema>;
export type LinkAction = z.infer<typeof linkActionSchema>;
export type LinkState = z.infer<typeof linkStateSchema>;

/** The same object in `GET P/documents` and in every write response; the UI never derives permissions from role, state or counts. */
export const scopeSchema = z.object({
  can_manage: z.boolean(),
  allowed_actions: z.array(scopeActionSchema),
  upload_blocked_reason: uploadBlockedReasonSchema.nullable(),
  limits: z.object({ max_bytes: positive, max_documents: positive, max_versions: positive, formats: z.array(formatDescriptorSchema) }).strict(),
  counts: z.object({ documents: count, links: count }).strict(),
}).strict();
export type Scope = z.infer<typeof scopeSchema>;

/** `participation_id` is always present: `null` for the vacancy scope. */
export const itemSchema = z.object({
  id, participation_id: id.nullable(), name: text, format: documentFormatSchema, content_type: text, size: positive, version: positive, version_count: positive,
  created_at: timestamp, created_by: person, updated_at: timestamp, updated_by: person,
  allowed_actions: z.array(itemActionSchema),
}).strict();
export type DocumentItem = z.infer<typeof itemSchema>;

/** `source` describes the PINNED version; `sequence` 0 is the original process. */
export const linkSourceSchema = z.object({
  document_id: id, process_id: id, sequence: count, participation_id: id.nullable(), name: text, format: documentFormatSchema, size: positive,
  version: positive, version_count: positive, uploaded_at: timestamp, uploaded_by: person, has_newer_version: z.boolean(),
}).strict();
export type LinkSource = z.infer<typeof linkSourceSchema>;

const linkShape = {
  id, state: linkStateSchema, linked_at: timestamp, linked_by: person, allowed_actions: z.array(linkActionSchema), source: linkSourceSchema.nullable(),
};
/** `source` is `null` exactly when the state is `removed` or `inaccessible` (contract «GET P/documents»). */
const sourceMatchesState = (link: { state: LinkState; source: unknown }) => (link.state === "available") === (link.source !== null);
const sourceRule = { message: "An available link carries its source; a removed or inaccessible one does not.", path: ["source"] };
export const linkSchema = z.object(linkShape).strict().refine(sourceMatchesState, sourceRule);
export type DocumentLink = z.infer<typeof linkSchema>;

export const documentListSchema = z.object({ items: z.array(itemSchema), links: z.array(linkSchema), scope: scopeSchema }).strict();
export type DocumentList = z.infer<typeof documentListSchema>;

export const versionHistorySchema = z.object({
  document_id: id, name: text,
  versions: z.array(z.object({
    version: positive, format: documentFormatSchema, content_type: text, size: positive, uploaded_at: timestamp, uploaded_by: person, is_current: z.boolean(),
  }).strict()),
}).strict();
export type VersionHistory = z.infer<typeof versionHistorySchema>;

export const sourcesSchema = z.object({
  can_link: z.boolean(),
  sources: z.array(z.object({
    process_id: id, sequence: count, participation_id: id.nullable(),
    documents: z.array(z.object({
      id, name: text, format: documentFormatSchema, size: positive, version: positive, version_count: positive, updated_at: timestamp, already_linked: z.boolean(),
    }).strict()),
  }).strict()),
}).strict();
export type DocumentSources = z.infer<typeof sourcesSchema>;

/** Upload and replace answer 201 `{item, scope}`; link creation 201 `{link, scope}`; deleting a document or a link 200 `{scope}`. */
export const itemWriteSchema = z.object({ item: itemSchema, scope: scopeSchema }).strict();
export const linkWriteSchema = z.object({ link: linkSchema, scope: scopeSchema }).strict();
export const scopeWriteSchema = z.object({ scope: scopeSchema }).strict();
export type ItemWrite = z.infer<typeof itemWriteSchema>;
export type LinkWrite = z.infer<typeof linkWriteSchema>;
export type ScopeWrite = z.infer<typeof scopeWriteSchema>;

/** `POST P/document-links` body: one JSON object, no unknown key; `version` is optional and 1–999 999 999. */
export const createLinkBodySchema = z.object({ source_document_id: id, version: z.number().int().min(1).max(999_999_999).optional() }).strict();
export type CreateLinkBody = z.infer<typeof createLinkBodySchema>;

const candidateSchema = z.object({ kind: z.enum(["manual", "organic"]), id, full_name: text }).strict();
const owner = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("vacancy") }).strict(),
  z.object({ kind: z.literal("participation"), participation_id: id, candidate: candidateSchema, discarded: z.boolean() }).strict(),
]);
export type DocumentOwner = z.infer<typeof owner>;

/** The row of the scope's own list plus `owner`; for an item, `participation_id` and `owner.participation_id` agree. */
const overviewItemSchema = itemSchema.extend({ owner }).strict().refine(
  item => item.owner.kind === "vacancy" ? item.participation_id === null : item.participation_id === item.owner.participation_id,
  { message: "participation_id and owner disagree.", path: ["owner"] },
);
const overviewLinkSchema = z.object({ ...linkShape, owner }).strict().refine(sourceMatchesState, sourceRule);
export type OverviewItem = z.infer<typeof overviewItemSchema>;
export type OverviewLink = z.infer<typeof overviewLinkSchema>;

/** Lifecycle vocabulary of `GET V/lifecycle`; `publication`, `process` and `visibility` are `null` for a draft that never published, `title` while it has none. */
export const overviewSchema = z.object({
  vacancy: z.object({
    id, title: text.nullable(), publication: z.enum(["published", "paused", "closed"]).nullable(), process: z.enum(["active", "finished"]).nullable(),
    kind: z.enum(["original", "replacement"]), visibility: z.enum(["public", "private"]).nullable(),
  }).strict(),
  scope: scopeSchema,
  items: z.array(overviewItemSchema),
  links: z.array(overviewLinkSchema),
  participations: z.array(z.object({
    participation_id: id, candidate: candidateSchema, discarded: z.boolean(),
    /** Kind and name of the stage the participation sits in (or was discarded from); the kind is the pipeline's, not closed by the contract. */
    stage: z.object({ kind: text, name: text }).strict(),
    scope_allowed_actions: z.array(scopeActionSchema), upload_blocked_reason: uploadBlockedReasonSchema.nullable(),
  }).strict()),
  /** `true` when more than 2000 rows matched: the newest were kept; narrow with `participation_id`. */
  truncated: z.boolean(),
}).strict();
export type DocumentOverview = z.infer<typeof overviewSchema>;
