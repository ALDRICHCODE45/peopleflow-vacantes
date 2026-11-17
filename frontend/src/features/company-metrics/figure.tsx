import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A count or rate that opens its records (rule 16): a link with an accessible name such as «Ver las 5 entregas tarde»
 * when `href` is set, plain text otherwise (a 0, or the detail page not yet available). `repeat` marks a second copy of
 * a figure already linked on the card: still clickable, but neither a second tab stop nor a second announcement.
 */
export function Figure({ href, label, className, repeat, children }: { href: string | null; label: string; className?: string; repeat?: boolean; children: ReactNode }) {
  if (!href) return <span className={className}>{children}</span>;
  return <Link href={href} aria-label={repeat ? undefined : label} {...(repeat ? { tabIndex: -1, "aria-hidden": true } : {})}
    className={cn("rounded-sm underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring", className)}>
    {children}
  </Link>;
}
