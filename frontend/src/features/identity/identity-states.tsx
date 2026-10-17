"use client";

import * as React from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { IconShieldLock } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";

export function IdentitySkeleton() {
  return <section className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6" aria-busy="true" aria-label="Tu cuenta">
    <span role="status" className="sr-only">Cargando tu cuenta</span>
    <Skeleton aria-hidden="true" className="h-8 w-64 max-w-full" />
    <Skeleton aria-hidden="true" className="h-16 w-full" />
    <Skeleton aria-hidden="true" className="h-40 w-full" />
    <Skeleton aria-hidden="true" className="h-10 w-48 max-w-full self-end" />
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
