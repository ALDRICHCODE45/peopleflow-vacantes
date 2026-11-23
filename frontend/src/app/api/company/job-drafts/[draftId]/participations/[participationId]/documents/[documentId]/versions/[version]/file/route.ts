import { downloadDocumentVersion } from "@/features/vacancy-documents/route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET V/participations/{pid}/documents/{doc}/versions/{n}/file`: one numbered version, streamed as an attachment. */
export async function GET(request: Request, context: { params: Promise<{ draftId: string; participationId: string; documentId: string; version: string }> }): Promise<Response> {
  return downloadDocumentVersion(await context.params, request);
}
