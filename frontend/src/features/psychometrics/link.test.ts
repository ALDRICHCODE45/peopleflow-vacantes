import { expect, it } from "vitest";
import { candidateUrl } from "./link";
it.each(["https://peopleflow.mx", "https://peopleflow.mx/ignored?query=1#fragment", "http://localhost:3000"]) ("composes the frontend-owned route from the app origin %s", origin => expect(candidateUrl(origin, "opaque_token-123")).toBe(`${new URL(origin).origin}/evaluacion/opaque_token-123`));
it.each(["a/b+c=", "a?b#c", "opaque%token"]) ("encodes opaque tokens as one path segment (%#)", token => expect(candidateUrl("https://peopleflow.mx", token)).toBe(`https://peopleflow.mx/evaluacion/${encodeURIComponent(token)}`));
it.each(["", ".", "..", " ", "a\nb"]) ("rejects invalid token without exposing it (%#)", token => expect(() => candidateUrl("https://peopleflow.mx", token)).toThrow(/^Invalid assessment link$/));
it.each(["not an origin", "javascript:alert(1)", "https://user:password@example.test"]) ("rejects invalid origins without reflecting input (%#)", origin => expect(() => candidateUrl(origin, "opaque")).toThrow(/^Invalid assessment link$/));
