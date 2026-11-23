import { replaceDocument } from "@/features/vacancy-documents/route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `POST V/participations/{pid}/documents/{doc}/versions`: streamed multipart replace (`expected_version`, `file`, optional `name`). */
export async function POST(request: Request, context: { params: Promise<{ draftId: string; participationId: string; documentId: string }> }): Promise<Response> {
  return replaceDocument(request, await context.params);
}
