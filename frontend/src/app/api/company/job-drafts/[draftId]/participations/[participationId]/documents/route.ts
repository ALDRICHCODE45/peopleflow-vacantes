import { uploadDocument } from "@/features/vacancy-documents/route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `POST V/participations/{pid}/documents`: streamed multipart upload (cap 10 485 760 + 65 536 bytes), optional `Idempotency-Key` forwarded. */
export async function POST(request: Request, context: { params: Promise<{ draftId: string; participationId: string }> }): Promise<Response> {
  return uploadDocument(request, await context.params);
}
