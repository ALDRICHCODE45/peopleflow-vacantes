import { downloadDocumentLink } from "@/features/vacancy-documents/route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET V/participations/{pid}/document-links/{link}/file`: the pinned version of a link, streamed as an attachment. */
export async function GET(_request: Request, context: { params: Promise<{ draftId: string; participationId: string; linkId: string }> }): Promise<Response> {
  return downloadDocumentLink(await context.params);
}
