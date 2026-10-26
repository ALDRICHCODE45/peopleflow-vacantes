const MAX_RETURN_TO_LENGTH = 4096;
const INTERNAL_ORIGIN = "https://return-to.invalid";

/** Untrusted `next` is a path, never a URL. Keep its original query encoding. */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_RETURN_TO_LENGTH) return null;
  // Whitespace is only refused in the raw value: a decoded `%20` in a search
  // query is legitimate, a literal space or tab is not.
  if (!value.startsWith("/") || /\s/u.test(value)) return null;
  let decoded = value;
  // Recheck nested escaping as well as URL dot-segment normalization. Bounded
  // decoding fails closed rather than permitting an encoded authority or loop.
  for (let depth = 0; depth < 8; depth++) {
    if (decoded.startsWith("//") || /[\\\p{Cc}\p{Cf}]/u.test(decoded)) return null;
    const url = new URL(decoded, INTERNAL_ORIGIN);
    // `/..//host` normalizes to an authority-like `//host` pathname.
    if (url.origin !== INTERNAL_ORIGIN || url.pathname.startsWith("//") || /^\/api(?:\/|$)/i.test(url.pathname)
      || /^\/candidato\/(?:login|ingresar)(?:\/|$)/i.test(url.pathname)) return null;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return value;
      decoded = next;
    } catch { return null; }
  }
  return null;
}

/** Auth routes themselves are trusted constants; only `next` is untrusted. */
export function candidateAuthHref(route: "login" | "ingresar", next: string | null | undefined): string {
  const safe = safeReturnTo(next);
  return `/candidato/${route}${safe ? `?next=${encodeURIComponent(safe)}` : ""}`;
}
