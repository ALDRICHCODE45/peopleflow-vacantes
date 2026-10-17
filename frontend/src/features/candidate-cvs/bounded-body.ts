import "server-only";
export class BodyTooLarge extends Error {}
/** Count actual bytes before retaining a chunk; Content-Length is only an early rejection. */
export async function readBoundedBody(body: ReadableStream<Uint8Array> | null, max: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) throw new Error("Missing body");
  const reader = body.getReader();
  const buffer = new Uint8Array(max);
  let bytes = 0;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("Aborted"));
    if (signal?.aborted) onAbort(); else signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      if (value.byteLength > max - bytes) throw new BodyTooLarge();
      buffer.set(value, bytes);
      bytes += value.byteLength;
    }
    return buffer.subarray(0, bytes);
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
export async function boundedJson(response: Response, max: number, signal?: AbortSignal): Promise<unknown> {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(response.body, max, signal)));
}
