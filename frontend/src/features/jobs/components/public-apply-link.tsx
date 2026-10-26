"use client";

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { useIdentity } from "@/features/identity/identity-session";
import { buttonVariants } from "@/components/ui/button";
import { vacancyApplicationHref } from "../application/application-draft";

/** Initial/SSR HTML keeps the discoverable apply URL; identity is client-only. */
export function PublicApplyLink({ jobId }: { jobId: string }) {
  const { status, result } = useIdentity();
  if (status !== "loading" && status !== "unauthenticated" && result?.ok && result.data.role === "recruiter") return <div className="flex flex-col gap-3">
    <p className="text-sm text-muted-foreground">Las postulaciones son para cuentas de candidato</p>
    <Link href="/empresa/dashboard" className={buttonVariants({ className: "min-h-10" })}>Ir a mi panel</Link>
  </div>;
  return <Link href={vacancyApplicationHref(jobId)} className={buttonVariants({ className: "h-12 w-full" })}>Postularme<ArrowRightIcon aria-hidden="true" data-icon="inline-end" /></Link>;
}
