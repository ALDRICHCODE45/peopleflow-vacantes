"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { IconLogin } from "@tabler/icons-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/company-dashboard/ui/sidebar";
import { candidateAuthHref } from "@/features/identity/return-to";
import { useCandidateViewer } from "./candidate-viewer";

function useAuthHref(pending: boolean) {
  const pathname = usePathname();
  const search = useSearchParams()?.toString();
  return candidateAuthHref(pending ? "ingresar" : "login", `${pathname ?? "/vacantes"}${search ? `?${search}` : ""}`);
}

export function CandidateVisitorFooter({ pending = false }: { pending?: boolean }) {
  const href = useAuthHref(pending);
  const { state, isMobile } = useSidebar();
  if (state === "collapsed" && !isMobile) return <SidebarMenu><SidebarMenuItem>
    <SidebarMenuButton tooltip={pending ? "Completa tu cuenta" : "Iniciar sesión"} render={<Link href={href} aria-label={pending ? "Completa tu cuenta" : "Iniciar sesión"} />}>
      <IconLogin aria-hidden="true" />
    </SidebarMenuButton>
  </SidebarMenuItem></SidebarMenu>;
  return <Card size="sm">
    <CardHeader><CardTitle><h2 className="text-sm font-semibold leading-snug">Guarda tu búsqueda y sigue tus postulaciones</h2></CardTitle></CardHeader>
    {/* Auth alternatives belong to the content; the footer holds the company path. */}
    <CardContent className="flex flex-col gap-2">
      <Link href={href} className={buttonVariants({ className: "min-h-10" })}>{pending ? "Completa tu cuenta" : "Crear cuenta"}</Link>
      {!pending && <Link href={href} className={cn(buttonVariants({ variant: "outline", className: "min-h-10" }))}>Iniciar sesión</Link>}
    </CardContent>
    <CardFooter><Link href="/empresa/login" className="inline-flex min-h-10 items-center rounded-sm text-xs text-muted-foreground underline underline-offset-4 outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50">¿Eres empresa? Publica vacantes</Link></CardFooter>
  </Card>;
}

export function CandidateFooterSkeleton() {
  const { state, isMobile } = useSidebar();
  if (state === "collapsed" && !isMobile) return <div aria-busy="true"><span role="status" className="sr-only">Cargando cuenta</span><Skeleton aria-hidden="true" className="mx-auto size-10 rounded-lg" /></div>;
  return <Card size="sm" aria-busy="true">
    <span role="status" className="sr-only">Cargando cuenta</span>
    <CardHeader><CardTitle><Skeleton aria-hidden="true" className="h-10 w-full" /></CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-2"><Skeleton aria-hidden="true" className="h-10 w-full" /><Skeleton aria-hidden="true" className="h-10 w-full" /></CardContent>
    <CardFooter><Skeleton aria-hidden="true" className="h-10 w-full" /></CardFooter>
  </Card>;
}

function MobileAuthLink({ pending }: { pending: boolean }) {
  const href = useAuthHref(pending);
  return <Link href={href} className={cn(buttonVariants({ variant: "outline", className: "min-h-10 md:hidden" }))}>Ingresar</Link>;
}

export function CandidateMobileLogin() {
  const viewer = useCandidateViewer();
  return viewer === "visitor" || viewer === "pending" ? <MobileAuthLink pending={viewer === "pending"} /> : null;
}
