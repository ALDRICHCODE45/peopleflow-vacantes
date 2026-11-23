import { downloadDocument } from "@/features/vacancy-documents/route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET V/participations/{pid}/documents/{doc}/file`: the current version, streamed as an attachment. */
export async function GET(_request: Request, context: { params: Promise<{ draftId: string; participationId: string; documentId: string }> }): Promise<Response> {
  return downloadDocument(await context.params);
}
