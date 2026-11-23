"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import {
  createDocumentLink, deleteDocument, deleteDocumentLink, getDocumentOverview, getDocumentSources, getDocumentVersions, listDocuments, type DocumentsResult,
} from "./client";
import { mapDocumentFailure, type DocumentFailure } from "./failure";
import type { DocumentList, DocumentOverview, DocumentSources, LinkWrite, ScopeWrite, VersionHistory } from "./model";

/**
 * Server actions for the JSON side of `placement-vacancy-documents-v1`. The binary upload, replace and download are NOT here: they go
 * through the route handlers under `/api/company/job-drafts/…` (a Server Action body cannot carry 10 MB). Every failure is the Spanish
 * `DocumentFailure`; the backend text never reaches the browser.
 */
export type DocumentActionResult<T> = { ok: true; data: T } | DocumentFailure;
/** `participationId` absent = the vacancy scope. */
type Scope = { draftId: string; participationId?: string };

async function run<T>(call: (token: string) => Promise<DocumentsResult<T>>): Promise<DocumentActionResult<T>> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return mapDocumentFailure({ error: { kind: "missing_token" } });
    const result = await call(token);
    return result.ok ? result : mapDocumentFailure(result);
  } catch {
    return mapDocumentFailure({ error: { kind: "network" } });
  }
}

export async function listVacancyDocumentsAction(draftId: string): Promise<DocumentActionResult<DocumentList>> {
  return run(token => listDocuments({ token, draftId }));
}
export async function listParticipationDocumentsAction(draftId: string, participationId: string): Promise<DocumentActionResult<DocumentList>> {
  return run(token => listDocuments({ token, draftId, participationId }));
}
/** `GET V/document-overview`; `participationId` narrows the rows only (the header, the scope and the participations stay complete). */
export async function loadDocumentOverviewAction(draftId: string, participationId?: string): Promise<DocumentActionResult<DocumentOverview>> {
  return run(token => getDocumentOverview({ token, draftId, ...(participationId === undefined ? {} : { participationId }) }));
}
export async function listDocumentVersionsAction(input: Scope & { documentId: string }): Promise<DocumentActionResult<VersionHistory>> {
  return run(token => getDocumentVersions({ ...scopeOf(input), token, documentId: input?.documentId }));
}
export async function deleteDocumentAction(input: Scope & { documentId: string }): Promise<DocumentActionResult<ScopeWrite>> {
  return run(token => deleteDocument({ ...scopeOf(input), token, documentId: input?.documentId }));
}
export async function listDocumentSourcesAction(input: Scope): Promise<DocumentActionResult<DocumentSources>> {
  return run(token => getDocumentSources({ ...scopeOf(input), token }));
}
/** One call per ticked source document; `version` pins an older version (default: the source's current). */
export async function createDocumentLinkAction(input: Scope & { sourceDocumentId: string; version?: number }): Promise<DocumentActionResult<LinkWrite>> {
  return run(token => createDocumentLink({
    ...scopeOf(input), token, body: { source_document_id: input?.sourceDocumentId, ...(input?.version === undefined ? {} : { version: input.version }) },
  }));
}
export async function deleteDocumentLinkAction(input: Scope & { linkId: string }): Promise<DocumentActionResult<ScopeWrite>> {
  return run(token => deleteDocumentLink({ ...scopeOf(input), token, linkId: input?.linkId }));
}

/** Only the two scope keys cross into the client call. */
function scopeOf(input: Scope): Scope {
  return { draftId: input?.draftId, ...(input?.participationId === undefined ? {} : { participationId: input.participationId }) };
}
