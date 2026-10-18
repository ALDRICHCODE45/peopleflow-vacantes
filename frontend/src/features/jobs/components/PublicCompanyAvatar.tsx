"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { PublicJobItem } from "../types";
import { companyInitials } from "./prototype-ui";

/** The same quiet company tile for logos, missing images and failed image loads. */
export function PublicCompanyAvatar({ company, detail = false }: { company: PublicJobItem["company"]; detail?: boolean }) {
  return <Avatar className={detail ? "size-16 rounded-2xl after:rounded-2xl" : "size-12 rounded-xl after:rounded-xl"} aria-hidden="true">
    {company.logo_url !== null && <AvatarImage className="rounded-[inherit] object-contain" src={company.logo_url} referrerPolicy="no-referrer" loading="lazy" alt="" />}
    <AvatarFallback className="pf-public-accent rounded-[inherit] border border-border bg-background font-semibold text-primary">{companyInitials(company.name)}</AvatarFallback>
  </Avatar>;
}
