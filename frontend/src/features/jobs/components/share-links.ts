/** Channel the shared link carries so applications and visits can be told apart from a direct visit. */
export const SHARED_ORIGIN = "compartido";

/** Absolute, hash-free URL with `origen=compartido` (any other `origen` is replaced). `href` may be a path when `base` is given. */
export function shareUrl(href: string, base?: string): string {
  const url = new URL(href, base);
  url.hash = "";
  url.searchParams.set("origen", SHARED_ORIGIN);
  // `set` keeps an existing `origen` position; move the tag last so shared links read the same everywhere.
  const params = [...url.searchParams].filter(([key]) => key !== "origen");
  url.search = "";
  for (const [key, value] of params) url.searchParams.append(key, value);
  url.searchParams.append("origen", SHARED_ORIGIN);
  return url.toString();
}

export type ShareInput = { title: string; company?: string | undefined; url: string; intro?: string | undefined };

/** «Analista — Acme»: what the message and the mail subject call the shared page. */
export function shareHeadline({ title, company }: Pick<ShareInput, "title" | "company">): string {
  return company ? `${title} — ${company}` : title;
}

export function shareLinks(input: ShareInput) {
  const headline = shareHeadline(input);
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${headline} — ${input.url}`)}`,
    email: `mailto:?subject=${encodeURIComponent(headline)}&body=${encodeURIComponent(`${input.intro ?? "Mira esta vacante"}: ${headline}\n\n${input.url}`)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(input.url)}`,
  };
}
