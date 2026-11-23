import { mapDocumentFailure, type DocumentFailure } from "../failure";
import { itemWriteSchema, type ItemWrite } from "../model";

/**
 * Browser side of the binary routes under `/api/company/job-drafts/…` (upload and replace). `fetch` has no upload progress, so this uses
 * `XMLHttpRequest`. The answer is the contract's `201 {item, scope}`, or the allowlisted error envelope mapped by `mapDocumentFailure`
 * (Spanish copy, per-field messages, `reload`, `uncertain`).
 */
export type UploadResult = { ok: true; data: ItemWrite } | DocumentFailure;
type Target = { draftId: string; participationId: string | null; file: File; name?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal };
const base = ({ draftId, participationId }: Target) => `/api/company/job-drafts/${draftId}${participationId ? `/participations/${participationId}` : ""}/documents`;

function send(url: string, body: FormData, headers: Record<string, string>, target: Target): Promise<UploadResult> {
  return new Promise(resolve => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.setRequestHeader("accept", "application/json");
    request.upload.onprogress = event => { if (event.lengthComputable && event.total > 0) target.onProgress?.(event.loaded / event.total); };
    request.onerror = () => resolve(mapDocumentFailure({ error: { kind: "network" } }));
    request.ontimeout = () => resolve(mapDocumentFailure({ error: { kind: "timeout" } }));
    request.onabort = () => resolve(mapDocumentFailure({ error: { kind: "network" } }));
    request.onload = () => {
      let json: unknown;
      try { json = JSON.parse(request.responseText); } catch { json = undefined; }
      if (request.status === 201) {
        const parsed = itemWriteSchema.safeParse(json);
        resolve(parsed.success ? { ok: true, data: parsed.data } : mapDocumentFailure({ error: { kind: "invalid_response" } }));
      } else resolve(mapDocumentFailure({ error: { kind: "status", status: request.status }, envelope: json }));
    };
    target.signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(body);
  });
}

/** `POST P/documents`: the same `idempotencyKey` for the same intent makes a retry safe (the backend replays the first answer). */
export function uploadDocumentFile(input: Target & { idempotencyKey: string }): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", input.file);
  if (input.name) form.append("name", input.name);
  return send(base(input), form, { "idempotency-key": input.idempotencyKey }, input);
}

/** `POST P/documents/{doc}/versions`: `expectedVersion` is the version the person saw; a stale one answers 409 `document_version_conflict`. */
export function replaceDocumentFile(input: Target & { documentId: string; expectedVersion: number }): Promise<UploadResult> {
  const form = new FormData();
  form.append("expected_version", String(input.expectedVersion));
  form.append("file", input.file);
  if (input.name) form.append("name", input.name);
  return send(`${base(input)}/${input.documentId}/versions`, form, {}, input);
}
