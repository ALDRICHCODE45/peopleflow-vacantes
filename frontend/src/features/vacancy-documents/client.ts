import "server-only";

import type { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { decodeDocumentEnvelope, type DocumentEnvelope } from "./failure";
import {
  createLinkBodySchema, documentListSchema, linkWriteSchema, overviewSchema, scopeWriteSchema, sourcesSchema, versionHistorySchema,
  type CreateLinkBody, type DocumentList, type DocumentOverview, type DocumentSources, type LinkWrite, type ScopeWrite, type VersionHistory,
} from "./model";
import { backendScopePath, isId, type DocumentScope } from "./paths";

/**
 * Server-only JSON client of `placement-vacancy-documents-v1` (the binary upload, replace and download go through the BFF routes).
 * Every call takes the same scope pair `{ draftId, participationId? }`: no `participationId` is the vacancy scope. Ids are validated
 * before any request; an error keeps its envelope only when the code and `data` are in the contract (`decodeDocumentEnvelope`).
 */
export type DocumentsFailure = {
  ok: false;
  error: { kind: "missing_token" | "invalid_request" | "invalid_response" | "not_found" | "status" | "network" | "timeout"; retryable: boolean; status?: number };
  envelope?: DocumentEnvelope;
};
export type DocumentsResult<T> = { ok: true; data: T } | DocumentsFailure;
type Input = DocumentScope & { token: string };

const invalid = (kind: "missing_token" | "invalid_request"): DocumentsFailure => ({ ok: false, error: { kind, retryable: false } });

async function call<T>(
  input: Input, suffix: string, options: { method: "GET" | "POST" | "DELETE"; expectedStatus: number; schema: z.ZodType<T>; body?: unknown; query?: string },
): Promise<DocumentsResult<T>> {
  if (typeof input?.token !== "string" || !input.token.trim()) return invalid("missing_token");
  const scope = backendScopePath(input);
  if (scope === null) return invalid("invalid_request");
  const { serverEnv } = await import("@/lib/env/server");
  const url = new URL(`${scope}${suffix}${options.query ?? ""}`, serverEnv.apiBaseUrl).toString();
  const result = await requestJson<T, DocumentEnvelope | undefined>(url, {
    method: options.method, redirect: "error", expectedStatus: options.expectedStatus, headers: { authorization: `Bearer ${input.token.trim()}` },
    ...(options.body === undefined ? {} : { body: options.body }),
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192, decoder: value => options.schema.parse(value), errorDecoder: decodeDocumentEnvelope,
  });
  return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error, ...(result.envelope ? { envelope: result.envelope } : {}) };
}

/** `GET P/documents`: every file document and every link of the scope, with the scope flags. */
export const listDocuments = (input: Input): Promise<DocumentsResult<DocumentList>> =>
  call(input, "/documents", { method: "GET", expectedStatus: 200, schema: documentListSchema });

/**
 * `GET V/document-overview` (vacancy only): the vacancy header, the vacancy scope, the documents and links of the vacancy and of every
 * participation with their `owner`, and the participations. `participationId` narrows the rows only (the contract wants the lower-case
 * dashed spelling, so it is normalized here); an invalid one is never sent.
 */
export function getDocumentOverview(input: Input): Promise<DocumentsResult<DocumentOverview>> {
  const { participationId, ...vacancy } = input;
  if (participationId !== undefined && !isId(participationId)) return Promise.resolve(invalid("invalid_request"));
  return call(vacancy, "/document-overview", {
    method: "GET", expectedStatus: 200, schema: overviewSchema,
    ...(participationId === undefined ? {} : { query: `?participation_id=${participationId.toLowerCase()}` }),
  });
}

/** `GET P/documents/{doc}/versions`: every version, newest first. */
export function getDocumentVersions(input: Input & { documentId: string }): Promise<DocumentsResult<VersionHistory>> {
  if (!isId(input?.documentId)) return Promise.resolve(invalid("invalid_request"));
  return call(input, `/documents/${input.documentId}/versions`, { method: "GET", expectedStatus: 200, schema: versionHistorySchema });
}

/** `DELETE P/documents/{doc}`: 200 `{scope}` (the freed slot may bring `upload` back). No `If-Match`: a repeated delete is a plain 404. */
export function deleteDocument(input: Input & { documentId: string }): Promise<DocumentsResult<ScopeWrite>> {
  if (!isId(input?.documentId)) return Promise.resolve(invalid("invalid_request"));
  return call(input, `/documents/${input.documentId}`, { method: "DELETE", expectedStatus: 200, schema: scopeWriteSchema });
}

/** `GET P/document-sources`: documents of the earlier processes (vacancy) or ancestor participations, with `already_linked`. */
export const getDocumentSources = (input: Input): Promise<DocumentsResult<DocumentSources>> =>
  call(input, "/document-sources", { method: "GET", expectedStatus: 200, schema: sourcesSchema });

/** `POST P/document-links`: one link per source document, pinned to `version` (default: the source's current). 201 `{link, scope}`. */
export function createDocumentLink(input: Input & { body: CreateLinkBody }): Promise<DocumentsResult<LinkWrite>> {
  const body = createLinkBodySchema.safeParse(input?.body);
  if (!body.success) return Promise.resolve(invalid("invalid_request"));
  return call(input, "/document-links", { method: "POST", expectedStatus: 201, schema: linkWriteSchema, body: body.data });
}

/** `DELETE P/document-links/{link}`: 200 `{scope}`; the source is untouched. */
export function deleteDocumentLink(input: Input & { linkId: string }): Promise<DocumentsResult<ScopeWrite>> {
  if (!isId(input?.linkId)) return Promise.resolve(invalid("invalid_request"));
  return call(input, `/document-links/${input.linkId}`, { method: "DELETE", expectedStatus: 200, schema: scopeWriteSchema });
}
