import type { IncomingMessage, ServerResponse } from "node:http";

export declare const INDUSTRIES: readonly { id: string; label_es: string; label_en: string; sort_order: number }[];

export declare function createEmbeddedAuthAccounts(options?: {
  cognitoOrigin?: string;
  issuer?: string;
  fetchImpl?: typeof fetch;
}): {
  /** Claims the request synchronously (true) and answers it asynchronously; false leaves it to the caller. */
  handle(request: IncomingMessage, response: ServerResponse, url: URL): boolean;
  reset(): void;
};
