"use client";

import { ShareMenu } from "./share-menu";

/** Detail-card share menu: copy, WhatsApp, mail, LinkedIn and the system sheet; the copy outcome shows below the trigger. */
export function PublicShareButton({ title, company }: { title: string; company?: string | undefined }) {
  return <ShareMenu title={title} company={company} visibleStatus />;
}
