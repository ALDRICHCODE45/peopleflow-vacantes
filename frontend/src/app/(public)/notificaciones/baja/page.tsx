import type { Metadata } from "next";
import { UNSUBSCRIBE_PAGE_TITLE } from "@/features/notifications/unsubscribe-copy";
import { UnsubscribePage } from "@/features/notifications/ui/unsubscribe-page";

/**
 * Email unsubscribe landing (`unsubscribe_url`, contract v2 Q3/Q4). The token rides in the query: the middleware sends
 * the page with `Referrer-Policy: no-referrer` and `no-store`, and it is never indexed or cached.
 */
export const metadata: Metadata = {
  title: UNSUBSCRIBE_PAGE_TITLE,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await searchParams;
  return UnsubscribePage({ token: typeof token === "string" ? token : null });
}
