/** Keep the transport deadline alive until the consumer finishes or cancels. */
export function deadlineStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, clearDeadline: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let cleanup = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const abort = () => {
        controller.error(new Error("Download timed out"));
        cleanup();
        void reader.cancel().catch(() => {});
      };
      cleanup = () => { clearDeadline(); signal.removeEventListener("abort", abort); };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (signal.aborted) return;
        if (done) { cleanup(); controller.close(); }
        else controller.enqueue(value);
      } catch (error) {
        cleanup();
        if (!signal.aborted) controller.error(error);
      }
    },
    cancel(reason) { cleanup(); return reader.cancel(reason); },
  });
}
