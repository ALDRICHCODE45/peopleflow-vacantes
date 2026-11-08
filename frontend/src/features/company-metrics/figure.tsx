import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A count or rate that opens its records (rule 16): a link with an accessible name such as «Ver las 5 entregas tarde»
 * when `href` is set, plain text otherwise (a 0, or the detail page not yet available).
 */
export function Figure({ href, label, className, children }: { href: string | null; label: string; className?: string; children: ReactNode }) {
  if (!href) return <span className={className}>{children}</span>;
  return <Link href={href} aria-label={label}
    className={cn("rounded-sm underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring", className)}>
    {children}
  </Link>;
}
