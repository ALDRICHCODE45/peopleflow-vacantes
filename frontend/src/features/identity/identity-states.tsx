"use client";

import * as React from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { IconShieldLock } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { cn } from "@/lib/utils";

/** Unknown destination: reserve the shell's inset area without inventing its content. */
export function IdentityCheck({ area }: { area?: "candidate" | "employer" }) {
  return <section aria-busy="true" aria-label="Tu cuenta" className={cn(
    "flex min-h-64 w-full flex-1 items-center justify-center",
    area === "candidate" && "min-h-svh md:min-h-[calc(100svh-var(--spacing)*6)]",
    area === "employer" && "min-h-svh md:min-h-[calc(100svh-var(--spacing)*4)]",
  )}>
    <Spinner aria-hidden="true" role="presentation" />
    <span role="status" className="sr-only">Verificando tu cuenta</span>
  </section>;
}

export function IdentitySkeleton() {
  return <section aria-busy="true" aria-label="Tu cuenta">
    <span role="status" className="sr-only">Cargando tu cuenta</span>
    {/* Skeleton mirrors the known onboarding entry; unknown guarded routes use IdentityCheck. */}
    <Card aria-hidden="true">
      <CardHeader className="border-b">
        <CardTitle className="flex flex-col gap-1.5"><Skeleton className="size-9" /><Skeleton className="h-8 w-96 max-w-full" /></CardTitle>
        <CardDescription><Skeleton className="h-10 w-full" /></CardDescription>
      </CardHeader>
      <CardContent><FieldGroup><Field><Skeleton className="w-32"><FieldLabel>&nbsp;</FieldLabel></Skeleton><Skeleton><Input disabled tabIndex={-1} className="invisible min-h-10" /></Skeleton></Field></FieldGroup></CardContent>
      <CardFooter className="border-t"><ActionBar status={null}><Skeleton><Button type="button" disabled tabIndex={-1} className="invisible h-auto min-h-10 max-w-full whitespace-normal">Crear mi cuenta de candidato</Button></Skeleton></ActionBar></CardFooter>
    </Card>
  </section>;
}

export function LogoutButton({ area }: { area: "candidate" | "employer" }) {
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  async function logout() {
    if (pending) return;
    setPending(true); setFailed(false);
    try { await signOut({ callbackUrl: area === "candidate" ? "/api/auth/cognito/logout?to=candidato" : "/api/auth/cognito/logout" }); }
    catch {
      setFailed(true);
      notifyActionResult({ key: "identity-logout", type: "error", title: "No pudimos cerrar la sesión", description: "Tu sesión puede seguir activa. Vuelve a intentarlo.", reference: { at: new Date().toISOString() } });
    } finally { setPending(false); }
  }
  return <ActionBar status={failed ? <ActionStatus id="identity-logout-status" tone="error" text="No se cerró la sesión. Intenta nuevamente." /> : null}>
    <Button type="button" variant="outline" className="min-h-10" disabled={pending} aria-describedby={failed ? "identity-logout-status" : undefined} onClick={() => void logout()}>{pending && <Spinner aria-hidden="true" />}Cerrar sesión</Button>
  </ActionBar>;
}

export function RoleBlocked({ kind, area = "candidate" }: { kind: "recruiter" | "candidate" | "no-company" | "account-exists"; area?: "candidate" | "employer" }) {
  const title = kind === "recruiter" ? "Esta cuenta es de empresa" : kind === "account-exists" ? "Esta cuenta ya es de empresa" : kind === "candidate" ? "Esta cuenta es de candidato" : "Esta cuenta todavía no tiene acceso a empresa";
  const href = kind === "candidate" ? "/candidato/dashboard" : kind === "no-company" ? "/candidato/login" : "/empresa/login";
  const label = kind === "candidate" ? "Ir a mi área de candidato" : kind === "no-company" ? "Ir a candidatos" : "Ir a empresa";
  return <Empty className="px-4 py-8 sm:p-12">
    <EmptyHeader><EmptyMedia variant="icon"><IconShieldLock aria-hidden="true" /></EmptyMedia><EmptyTitle><h2>{title}</h2></EmptyTitle>
      <EmptyDescription>Una cuenta tiene un solo rol. Para usar otra área necesitas una cuenta con otro email.</EmptyDescription></EmptyHeader>
    <EmptyContent><Button nativeButton={false} role="link" className="h-auto min-h-10 max-w-full whitespace-normal" render={<Link href={href} />}>{label}</Button><LogoutButton area={area} /></EmptyContent>
  </Empty>;
}

export function IdentityError({ retry }: { retry: () => void }) {
  const statusId = React.useId();
  return <Empty className="px-4 py-8 sm:p-12"><EmptyHeader><EmptyTitle><h2>No pudimos cargar tu cuenta</h2></EmptyTitle><EmptyDescription>Puedes volver a comprobar tu acceso sin crear una cuenta.</EmptyDescription></EmptyHeader><EmptyContent>
    <ActionBar status={<ActionStatus id={statusId} tone="error" text="No confirmamos tu acceso." />}><Button type="button" className="min-h-10" aria-describedby={statusId} onClick={retry}>Reintentar</Button></ActionBar>
  </EmptyContent></Empty>;
}
