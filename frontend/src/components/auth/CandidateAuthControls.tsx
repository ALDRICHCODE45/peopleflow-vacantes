"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SessionProvider, signIn, signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";

function ManagedCandidateLogin() {
  const { data: session, status } = useSession();
  const params = useSearchParams();
  const statusId = React.useId();
  const [pending, setPending] = React.useState(false);
  const lock = React.useRef(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const expired = Boolean(session?.error);
  const authenticated = status === "authenticated" && !expired;
  const error = actionError ?? (expired ? "Tu sesión venció. Volvé a ingresar." : params.has("error") ? "No pudimos completar el acceso. Intentá nuevamente." : null);
  async function start(logout = false) {
    if (lock.current || status === "loading") return;
    lock.current = true; setPending(true); setActionError(null);
    try {
      if (logout) await signOut({ callbackUrl: "/api/auth/cognito/logout?to=candidato" });
      // Hosted UI owns registration. No screen_hint: support depends on the
      // configured Cognito hosted UI generation; both buttons use the same flow.
      else await signIn("cognito", { callbackUrl: "/candidato/ingresar" });
    } catch {
      const message = logout ? "No pudimos cerrar la sesión. Intentá nuevamente." : "No pudimos iniciar el acceso. Intentá nuevamente.";
      setActionError(message);
      notifyActionResult({ key: "candidate-login", type: "error", title: logout ? "No pudimos cerrar la sesión" : "No pudimos iniciar el acceso", description: message, reference: { at: new Date().toISOString() } });
    } finally { lock.current = false; setPending(false); }
  }
  return <div className="mt-8 flex flex-col gap-5" aria-busy={pending || status === "loading"}>
    {error && !actionError && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {authenticated ? <Button nativeButton={false} role="link" render={<Link href="/candidato/ingresar" />} className="min-h-10">Ir a mi cuenta</Button> : <>
      <p className="text-sm text-muted-foreground">Ingresa con tu email y contraseña. Puedes crear tu acceso en la pantalla segura de Cognito.</p>
      <Button type="button" className="min-h-10" aria-describedby={actionError ? statusId : undefined} onClick={() => void start()} disabled={pending || status === "loading"}>{pending && <Spinner aria-hidden="true" />}Ingresar</Button>
      <Button type="button" variant="outline" className="min-h-10" aria-describedby={actionError ? statusId : undefined} onClick={() => void start()} disabled={pending || status === "loading"}>Crear cuenta</Button>
    </>}
    {(authenticated || expired) && <Button type="button" variant="outline" className="min-h-10" aria-describedby={actionError ? statusId : undefined} disabled={pending} onClick={() => void start(true)}>Cerrar sesión</Button>}
    <ActionStatusSlot>{actionError && <ActionStatus id={statusId} tone="error" text={actionError} />}</ActionStatusSlot>
  </div>;
}
export function CandidateAuthControls() {
  return <SessionProvider refetchInterval={60} refetchOnWindowFocus><ManagedCandidateLogin /></SessionProvider>;
}
