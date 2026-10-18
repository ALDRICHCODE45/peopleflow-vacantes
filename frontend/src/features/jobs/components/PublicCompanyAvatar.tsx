"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { PublicJobItem } from "../types";
import { companyInitials } from "./prototype-ui";

const COMPANY_TONES = [
  "bg-primary/12 text-foreground ring-1 ring-primary/40",
  "bg-status-info/10 text-status-info",
  "bg-status-success/10 text-status-success",
  "bg-status-review/10 text-status-review",
] as const;

function companyTone(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return COMPANY_TONES[hash % COMPANY_TONES.length];
}

/** Base UI owns image loading/error state; both public views keep the same fallback. */
export function PublicCompanyAvatar({ company, detail = false }: { company: PublicJobItem["company"]; detail?: boolean }) {
  return <Avatar className={detail ? "size-10" : "size-12"} aria-hidden="true">
    {company.logo_url !== null && <AvatarImage src={company.logo_url} referrerPolicy="no-referrer" loading="lazy" alt="" />}
    <AvatarFallback className={companyTone(company.id)}>{companyInitials(company.name)}</AvatarFallback>
  </Avatar>;
}
